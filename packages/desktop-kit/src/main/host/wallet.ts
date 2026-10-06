/**
 * The desktop "background": builds the vault and the shared @clip-wallet/engine in the main process, on Node
 * storage, crypto, timers and fetch. This folder is the only place in apps/desktop allowed to import
 * @clip-wallet/vault (tools/harness/check.mjs), like apps/extension/src/background and apps/mobile/src/background.
 *
 * Renderers never get the engine: they send zod-checked messages over IPC (ipc.ts → handle()) and receive
 * "changed" events. Dapps never reach it either: 1Mask requests come through browser/onemask-relay.ts with the
 * origin set from the browser process.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { ClipVault, hashSignablePayload } from "@clip-wallet/vault";
import { ClipError } from "@clip-wallet/core";
import { WalletEngine, b64url, fromB64url, publicNetworks, type KV } from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import { createFeatureHost, createFeatures } from "@clip-wallet/engine/features";
import { EngineHardware, type EngineKeystone, type EngineLedger } from "@clip-wallet/engine/hardware";
import { createSocial } from "@clip-wallet/engine/social";
import { HardwareKeyring, KeystoneBridge, type HardwareStorage } from "@clip-wallet/hardware/core";
import type { KeystoneSigner, LedgerSigner, TransportFactory } from "@clip-wallet/hardware";
import { COINGECKO_IDS } from "@clip-wallet/features";
import { RecipientLog, SecurityService } from "@clip-wallet/security";
import type { Notifier } from "@clip-wallet/social";
import type { RouterPort } from "@clip-wallet/1mask/background";
import { LINK_LOCKED_OK, LinkRequest, isLinkRequest, withRemoteSigner, type LinkService } from "@clip-wallet/link";
import { DESKTOP } from "../../shared/app-config";
import { FileKV, SafeVaultStorage, storagePaths, type SafeStorageLike, type StorageProtection } from "../storage";
import { TouchIdPrf } from "../biometric";
import { createDesktopLink } from "./link";

/** Vault backstop; the engine arms the user's (shorter) auto-lock. */
const VAULT_MAX_IDLE_MS = 60 * 60 * 1000;

export interface DesktopHostEnv {
  userData: string;
  platform: NodeJS.Platform;
  safe: SafeStorageLike;
  touchId: { can(): boolean; prompt(reason: string): Promise<void> };
  /** A request is waiting: show the approval window. */
  openApproval(id: string): void;
  /** Wallet window at a route (engine.openRoute / openFullTab). */
  openRoute(route: string): void;
  /** Screens re-fetch. */
  broadcast(): void;
  /** The vault locked (auto-lock, sleep): windows refresh, the approval window closes. */
  locked(): void;
  /** Ledger over WebHID in a renderer (hid.ts). */
  hidTransport: TransportFactory;
  notifier: Notifier;
  systemLanguages(): readonly string[];
  /** System browser for https pages that should leave the app (on-ramp widgets). */
  openExternal(url: string): Promise<void>;
  /** Reown project id (CLIP_WC_PROJECT_ID at build time); unset = WalletConnect says it isn't switched on. */
  wcProjectId?: string;
  /** Extra verified dapp domains (dev: the local test dapp). */
  knownDapps?: Record<string, string>;
  /** Linked devices changed (pairing progress, a device came online, sync ran). */
  linkChanged(): void;
  /** "Clip Desktop (macOS, …)": how paired devices name this one. */
  platformLabel: string;
}

/** @walletconnect/core storage (IKeyValueStorage) over the app's KV, so nothing lands in the working directory. */
function walletConnectStorage(kv: KV) {
  const INDEX = "wc/keys";
  const keys = async () => (await kv.get<string[]>(INDEX)) ?? [];
  return {
    getKeys: keys,
    getEntries: async () => Promise.all((await keys()).map(async (k) => [k, await kv.get(`wc/${k}`)] as [string, unknown])),
    getItem: async <T>(k: string) => kv.get<T>(`wc/${k}`),
    setItem: async <T>(k: string, v: T) => {
      await kv.set(`wc/${k}`, v);
      const list = await keys();
      if (!list.includes(k)) await kv.set(INDEX, [...list, k]);
    },
    removeItem: async (k: string) => {
      await kv.remove(`wc/${k}`);
      await kv.set(INDEX, (await keys()).filter((x) => x !== k));
    },
  };
}

export interface DesktopWallet {
  engine: WalletEngine;
  kv: KV;
  /** Linked devices: extension signer over native messaging, phone as signer, sync, handoff (host/link.ts). */
  link: LinkService;
  /** One untrusted message from a wallet renderer (engine, features, social, security or hardware). */
  handle(msg: { type: string } & Record<string, unknown>): Promise<unknown>;
  /** Touch ID: the main process runs the PRF and finishes the vault's ceremony itself. */
  bioEnroll(ceremonyId: string, prfInput: string, reason: string): Promise<{ credentialId: string }>;
  bioEvaluate(ceremonyId: string, credentialId: string, prfInput: string, reason: string): Promise<void>;
  biometrics: { available: boolean; label: string };
  protection: StorageProtection;
  walletConnectEnabled: boolean;
  pairWalletConnect(uri: string): Promise<void>;
  attachDappPort(port: RouterPort, origin: string): void;
  isKnownScam(origin: string): boolean;
  checkSite(origin: string): Promise<{ safe: boolean; reasons: string[] }>;
  featured(): Promise<{ name: string; url: string; description?: string }[]>;
  connectedOrigins(): Promise<string[]>;
  lock(): Promise<void>;
  locale(): Promise<string | undefined>;
  browserNetworks: ReturnType<typeof publicNetworks>;
  dispose(): void;
}

export function createDesktopWallet(env: DesktopHostEnv): DesktopWallet {
  const paths = storagePaths(env.userData);
  const kv = new FileKV(paths.app);
  const vaultStorage = new SafeVaultStorage(paths.vault, env.safe, env.platform);
  const vault = new ClipVault({ storage: vaultStorage, autoLockMs: VAULT_MAX_IDLE_MS });

  let engine!: WalletEngine;
  const deps = createEngineDependencies({
    config: DESKTOP.config,
    vault,
    hashPayload: hashSignablePayload,
    currency: async () => (await engine.prefs()).displayCurrency,
    walletConnect: { projectId: env.wcProjectId, url: DESKTOP.siteUrl, iconUrl: DESKTOP.iconUrl, coreOptions: { storage: walletConnectStorage(kv) } },
    kv,
    ...(env.knownDapps ? { knownDapps: env.knownDapps } : {}),
  });

  // Linked devices. Built before the engine: while a phone is chosen as the signer, the built-in browser's 1Mask
  // requests go there (withRemoteSigner wraps the dapp connector); requests from a paired extension are served by
  // this engine (signerHost) and show in this app's approval window.
  const link = createDesktopLink({
    kv,
    vault,
    engine: () => engine,
    ...(DESKTOP.config.services.linkRelayUrl ? { relayUrl: DESKTOP.config.services.linkRelayUrl } : {}),
    ...(DESKTOP.config.services.backupUrl ? { syncUrl: DESKTOP.config.services.backupUrl } : {}),
    onChange: () => {
      env.broadcast();
      env.linkChanged();
    },
    platformLabel: env.platformLabel,
  });
  deps.dapps = withRemoteSigner(deps.dapps, link);

  /* auto-lock: a timer while unlocked; the OS lock / sleep also locks (index.ts powerMonitor) */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lockNow = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    await engine.lock();
    env.locked();
  };
  const arm = (minutes: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void lockNow(), minutes * 60_000);
  };

  engine = new WalletEngine(deps, kv, {
    walletName: DESKTOP.config.name,
    openApproval: (id) => env.openApproval(id),
    openRoute: (route) => env.openRoute(route),
    broadcast: () => env.broadcast(),
    armAutoLock: arm,
    fetch: globalThis.fetch.bind(globalThis),
    randomUUID: () => randomUUID(),
    // Touch ID runs in this process (biometric.ts); the ceremony metadata is only a formality here.
    passkey: () => ({ rpId: null, rpName: DESKTOP.config.name, mode: "native", bridgeUrl: "" }),
  });
  engine.start();

  const featureHost = () =>
    createFeatureHost({
      networks: deps.networks,
      assets: deps.assets,
      kv,
      ctx: (id) => engine.featureCtx(id),
      balances: () => engine.featureBalances(),
      enqueue: (request, appName) => engine.enqueueWalletRequest(request, appName),
      decode: (request) => engine.decodeForFeatures(request),
      usd: (key) => deps.prices.usd(key),
    });
  const features = createFeatures(featureHost(), { testnet: !DESKTOP.config.mainnet, tradeLinkBase: DESKTOP.tradeLinkBase });
  engine.attachFeatures(features);

  /* hardware: LedgerSigner over the WebHID relay; Keystone over the camera in the approval / wallet window */
  const hwStorage: HardwareStorage = { get: (k) => kv.get<string>(k), set: (k, v) => kv.set(k, v) };
  const bitcoinNetwork = DESKTOP.config.mainnet ? "mainnet" : "testnet";
  const keystoneBridge = new KeystoneBridge(() => env.broadcast());
  let hwMod: Promise<typeof import("@clip-wallet/hardware")> | undefined;
  const loadHw = () => (hwMod ??= import("@clip-wallet/hardware"));
  let ledgerP: Promise<LedgerSigner> | undefined;
  let keystoneP: Promise<KeystoneSigner> | undefined;
  const led = () => (ledgerP ??= loadHw().then((m) => new m.LedgerSigner({ bitcoinNetwork, transport: env.hidTransport, deviceName: "Ledger" })));
  const key = () => (keystoneP ??= loadHw().then((m) => new m.KeystoneSigner({ channel: keystoneBridge, storage: hwStorage, bitcoinNetwork })));
  const ledger: EngineLedger = {
    kind: "ledger",
    listAccounts: async (...a) => (await led()).listAccounts(...a),
    sign: async (...a) => (await led()).sign(...a),
    close: async () => (ledgerP ? (await ledgerP).close() : undefined),
  };
  const keystone: EngineKeystone = {
    kind: "keystone",
    listAccounts: async (...a) => (await key()).listAccounts(...a),
    sign: async (...a) => (await key()).sign(...a),
    importSync: async (ur) => (await key()).importSync(ur),
    forget: async (fp) => (await key()).forget(fp),
  };
  const hardware = new EngineHardware({
    keyring: new HardwareKeyring({ signers: { ledger, keystone }, storage: hwStorage }),
    ledger,
    keystone: { signer: keystone, bridge: keystoneBridge },
    kv,
  });
  engine.attachHardware(hardware);

  /* contacts, handles, notifications, Discover */
  const social = createSocial({
    networks: deps.networks,
    assets: deps.assets,
    chains: deps.chains,
    kv,
    vault,
    ctx: (id) => engine.featureCtx(id),
    enqueue: async (request, appName) => ({ id: (await engine.enqueueWalletRequest(request, appName)).id }),
    approvals: async () => engine.socialApprovals(),
    prices: deps.prices,
    notifier: env.notifier,
    deviceLanguages: env.systemLanguages,
    walletName: DESKTOP.config.name,
    coingeckoIds: COINGECKO_IDS,
    ...(DESKTOP.config.services.clipHandles ? { handles: DESKTOP.config.services.clipHandles } : {}),
  });
  engine.attachSocial(social);

  /* scam lists, address poisoning, new contracts: same checks as the extension and the phone */
  const recipients = new RecipientLog(kv);
  const security = new SecurityService(
    {
      ...featureHost(),
      nfts: () => engine.securityNfts(),
      history: () => recipients.list(),
      addressBook: async () =>
        (await social.contacts.list()).flatMap((c) => c.addresses.map((a) => ({ address: a.address, name: c.name, family: a.family }))),
    },
    { testnet: !DESKTOP.config.mainnet, threat: { openLists: true, refreshHours: 24 } },
  );
  engine.attachSecurity(security, recipients);
  void security.start().catch(() => undefined);
  // Notifications: a foreground poll every 5 minutes while the app runs (no push server).
  const poll = setInterval(() => void social.poll().catch(() => undefined), 5 * 60_000);

  /* Touch ID in the vault's passkey slot */
  const bio = new TouchIdPrf({
    platform: env.platform,
    canPromptTouchID: env.touchId.can,
    promptTouchID: env.touchId.prompt,
    safe: env.safe,
    kv,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
  });
  /** Ceremonies the main process already finished; the renderer's own passkeyFinish for them is a no-op. */
  const hostFinished = new Set<string>();
  const finishCeremony = async (ceremonyId: string, run: () => Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }>) => {
    hostFinished.add(ceremonyId);
    let r: { credentialId: Uint8Array; prfOutput: Uint8Array };
    try {
      r = await run();
    } catch (e) {
      await engine.handle({ type: "passkeyFinish", result: { id: ceremonyId, error: "cancelled" } }).catch(() => undefined);
      throw e;
    }
    const prfOutput = b64url(r.prfOutput);
    r.prfOutput.fill(0);
    await engine.handle({ type: "passkeyFinish", result: { id: ceremonyId, credentialId: b64url(r.credentialId), prfOutput } });
    return b64url(r.credentialId);
  };

  const handle = async (msg: { type: string } & Record<string, unknown>): Promise<unknown> => {
    if (msg.type.startsWith("hw")) return hardware.handleUntrusted(msg);
    if (isLinkRequest(msg)) {
      const m = LinkRequest.safeParse(msg);
      if (!m.success) throw new ClipError("Something went wrong. Please try again.", "bus/invalid");
      if (!LINK_LOCKED_OK.has(m.data.type) && (await vault.status()) !== "unlocked") throw new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked");
      if (m.data.type === "linkHandoffCreate") {
        // Only the sites this wallet actually connected travel with the page (as the extension does).
        const origin = new URL(m.data.url).origin;
        const families = (await Promise.all(engine.families.map(async (f) => ((await engine.permissions.has(origin, f)) ? f : null)))).filter((f): f is NonNullable<typeof f> => !!f);
        return link.handle({ ...m.data, families });
      }
      return link.handle(m.data);
    }
    if (msg.type === "passkeyFinish") {
      const id = (msg.result as { id?: unknown } | undefined)?.id;
      if (typeof id === "string" && hostFinished.delete(id)) return undefined;
    }
    return engine.handleUntrusted(msg);
  };

  return {
    engine,
    kv,
    link,
    handle,
    async bioEnroll(ceremonyId, prfInput, reason) {
      return { credentialId: await finishCeremony(ceremonyId, () => bio.enroll(fromB64url(prfInput), reason)) };
    },
    async bioEvaluate(ceremonyId, credentialId, prfInput, reason) {
      const cred = fromB64url(credentialId);
      await finishCeremony(ceremonyId, async () => ({ credentialId: cred, prfOutput: await bio.evaluate(cred, fromB64url(prfInput), reason) }));
    },
    get biometrics() {
      return { available: bio.available, label: bio.label };
    },
    protection: vaultStorage.protection,
    walletConnectEnabled: deps.walletConnect.enabled,
    async pairWalletConnect(uri) {
      if (!uri.startsWith("wc:")) throw new ClipError("That isn't a connection code.", "walletconnect/bad-uri");
      await engine.handleUntrusted({ type: "pairWalletConnect", uri });
    },
    attachDappPort: (port, origin) => engine.attachDappPort(port, origin),
    isKnownScam: (origin) => engine.isKnownScam(origin),
    async checkSite(origin) {
      const v = await security.threat.checkSite(origin);
      return { safe: v.safe, reasons: v.warnings.filter((w) => w.level === "danger").map((w) => w.message) };
    },
    async featured() {
      try {
        if ((await vault.status()) !== "unlocked") return [];
        const list = (await engine.handleUntrusted({ type: "featFeatured" })) as { name: string; url: string; description?: string }[];
        return list.filter((d) => typeof d.url === "string" && d.url.startsWith("https://")).slice(0, 12);
      } catch {
        return [];
      }
    },
    connectedOrigins: () => engine.permissions.origins(),
    lock: lockNow,
    locale: async () => (await engine.prefs()).locale,
    browserNetworks: publicNetworks(deps.networks),
    dispose() {
      clearInterval(poll);
      if (timer) clearTimeout(timer);
    },
  };
}
