/**
 * The phone's "background": builds the vault (this folder is the only place in apps/mobile allowed to import
 * @clip-wallet/vault, like packages/extension-kit/src/background) and the shared @clip-wallet/engine on React Native
 * storage, crypto, timers and fetch. Screens talk to it only through the WalletClient (createEngineClient) and
 * the few mobile-only calls exported here (biometric/passkey unlock, browser bridge, deep links).
 */
import { AppState, type AppStateStatus } from "react-native";
import { randomUUID } from "expo-crypto";
import { ClipVault, hashSignablePayload } from "@clip-wallet/vault";
import {
  WalletEngine,
  createEngineClient,
  createEngineFeaturesClient,
  createEnginePluginsClient,
  createEngineSecurityClient,
  publicNetworks,
  type KV,
  type PrfProvider,
} from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import { createFeatureHost, createFeatures } from "@clip-wallet/engine/features";
import { EngineHardware, createEngineHardwareClient, type EngineKeystone, type EngineLedger } from "@clip-wallet/engine/hardware";
import { HardwareKeyring, KeystoneBridge, type HardwareStorage, type KeystoneSigner, type LedgerSigner } from "@clip-wallet/hardware/core";
import type { FeaturesClient, FullHardwareClient, PasskeyPrfFactory, PluginsClient, SecurityClient, SocialClient, WalletClient } from "@clip-wallet/ui";
import { PluginBackend } from "@clip-wallet/names";
import { createMobilePlugins, type MobilePlugins } from "../plugins/host";
import { createWebViewChannels, type WebViewChannels } from "../plugins/channels";
import { gunzipCapped } from "../plugins/gunzip";
import * as WebBrowser from "expo-web-browser";
import * as LocalAuthentication from "expo-local-authentication";
import { createSocial } from "@clip-wallet/engine/social";
import { RecipientLog, SecurityService } from "@clip-wallet/security";
import { COINGECKO_IDS } from "@clip-wallet/features";
import { createEngineSocialClient } from "@clip-wallet/engine";
import { expoNotifier, requestNotificationPermission } from "./notifications";
import { setBackgroundPoll, syncBackgroundTask } from "./background-task";
import { deviceLanguages } from "../i18n/device";
import * as Linking from "expo-linking";
import { ClipError } from "@clip-wallet/core";
import { APP } from "../env";
import { pickArgon2id, selfTest, type Argon2Choice } from "./argon2";
import { appKV, secureVaultStorage } from "./storage";
import { biometricInfo, deviceKeyPrf, forgetDeviceKey, type BiometricInfo } from "./device-key";
import { nativePasskeyPrf, passkeysConfigured } from "./passkey";
import { Events } from "./events";
import { ledgerBle, type LedgerBle } from "./ledger-ble";
import { createMobileLink } from "./link";
import type { LinkService } from "@clip-wallet/link";
import type { LinkClient } from "@clip-wallet/ui";

/** Vault backstop; the engine arms the user's (shorter) auto-lock. */
const VAULT_MAX_IDLE_MS = 60 * 60 * 1000;
const UNLOCK_METHODS = "clip-mobile/unlock-methods";

type UnlockKind = "device" | "passkey";
interface UnlockMethod {
  id: string;
  kind: UnlockKind;
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function unhex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface MobileWallet {
  engine: WalletEngine;
  client: WalletClient;
  /** Staking, swaps, buy, Secure Trade and featured apps (same services as the extension). */
  features: FeaturesClient;
  /** Ledger (Bluetooth) and Keystone (camera) accounts. */
  hardware: FullHardwareClient;
  /** Picking and reopening a Ledger over Bluetooth. */
  ledger: Pick<LedgerBle, "prepare" | "scan" | "select" | "selected" | "forget">;
  /** Real passkeys for the passkey backup ceremony (runCeremony); null when this build has no passkey domain. */
  passkeyPrf: PasskeyPrfFactory | null;
  /** Opens an https page (on-ramp widgets) in the in-app browser sheet (SFSafariViewController / Custom Tabs). */
  openSheet(url: string): Promise<void>;
  /**
   * Face ID / Touch ID / fingerprint (or the device passcode) before showing something sensitive. Resolves
   * false when the device has no biometrics set up (the password check still applies); throws when cancelled.
   */
  confirmPresence(reason: string, cancelLabel?: string): Promise<boolean>;
  /** Contacts, Clip handles, notifications and Discover (same services as the extension). */
  social: SocialClient;
  /** Settings → Security: app permissions (revoke), spam cleanup, scam protection (same service as the extension). */
  security: SecurityClient;
  /** Clip Plugins (Advanced mode + the Plugins switch); null when this build has none. */
  plugins: PluginsClient | null;
  /** The hidden plugin sandboxes the app root renders (PluginSandboxes); null without plugins. */
  pluginSandboxes: WebViewChannels | null;
  /** Settings → Linked devices: this phone as the signer for a paired browser, sync, moving a wallet, handoffs. */
  link: LinkClient;
  linkService: LinkService;
  /** One notification check now (foreground timer; the background task calls the same). */
  pollNotifications(): Promise<unknown>;
  events: Events;
  argon2: Argon2Choice & { selfTest: Promise<boolean> };
  walletConnectEnabled: boolean;
  channel: string;
  browserNetworks: ReturnType<typeof publicNetworks>;
  biometrics(): Promise<BiometricInfo & { enrolled: boolean }>;
  enableBiometrics(password: string): Promise<void>;
  unlockWithBiometrics(): Promise<void>;
  passkeys(): Promise<{ configured: boolean; enrolled: boolean }>;
  enablePasskey(password: string): Promise<void>;
  unlockWithPasskey(): Promise<void>;
  removeUnlockMethods(): Promise<void>;
}

export function createMobileWallet(opts: { kv?: KV } = {}): MobileWallet {
  const kv = opts.kv ?? appKV();
  const events = new Events();
  const argon2 = pickArgon2id();
  const argonCheck = selfTest(argon2.fn).catch(() => false);

  const guardedArgon2: typeof argon2.fn = async (i) => {
    if (!(await argonCheck)) throw new ClipError("This device's password hashing failed a self-check, so the wallet stays closed. Please update the app.", "vault/kdf-selftest");
    return argon2.fn(i);
  };

  const vault = new ClipVault({ storage: secureVaultStorage(), argon2id: guardedArgon2, autoLockMs: VAULT_MAX_IDLE_MS });

  let engine!: WalletEngine;
  // Clip Plugins: built after the engine; the name resolver asks them last (built-in names always win).
  let plugins: MobilePlugins | undefined;
  const deps = createEngineDependencies({
    config: APP.config,
    vault,
    hashPayload: hashSignablePayload,
    currency: async () => (await engine.prefs()).displayCurrency,
    walletConnect: { projectId: APP.wcProjectId, url: APP.siteUrl, iconUrl: APP.iconUrl },
    // CoinGecko prices cached in app storage (no partner key on mobile builds yet).
    kv,
    extraNames: [new PluginBackend((n) => plugins?.resolveName(n) ?? Promise.resolve(null), () => plugins?.suffixes() ?? [])],
  });

  /* auto-lock: a JS timer while open, plus a wall-clock check when the app comes back from the background */
  let lockAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (minutes: number) => {
    lockAt = Date.now() + minutes * 60_000;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void engine.lock().then(() => events.emit({ type: "locked" })), minutes * 60_000);
  };
  AppState.addEventListener("change", (s: AppStateStatus) => {
    if (s === "active" && lockAt && Date.now() >= lockAt) void engine.lock().then(() => events.emit({ type: "locked" }));
  });

  engine = new WalletEngine(deps, kv, {
    walletName: APP.config.name,
    openApproval: (id) => events.emit({ type: "approval", id }),
    broadcast: () => events.emit({ type: "change" }),
    armAutoLock: arm,
    fetch: globalThis.fetch.bind(globalThis),
    randomUUID: () => randomUUID(),
    // Passkey backup/restore ceremonies run here with react-native-passkey (needs a webcredentials domain).
    passkey: () => ({ rpId: APP.passkeyRpId ?? null, rpName: APP.config.name, mode: "native", bridgeUrl: "" }),
    // Google / Apple sign-in for backups: ASWebAuthenticationSession / Custom Tabs, back to a universal link.
    ...(APP.backupReturnUrl
      ? {
          identity: {
            returnUrl: APP.backupReturnUrl,
            async launchWebAuthFlow(url: string) {
              const r = await WebBrowser.openAuthSessionAsync(url, APP.backupReturnUrl!);
              return r.type === "success" ? r.url : undefined;
            },
          },
        }
      : {}),
  });
  engine.start();
  engine.attachFeatures(
    createFeatures(
      createFeatureHost({
        networks: deps.networks,
        assets: deps.assets,
        kv,
        ctx: (id) => engine.featureCtx(id),
        balances: () => engine.featureBalances(),
        enqueue: (request, appName) => engine.enqueueWalletRequest(request, appName),
        decode: (request) => engine.decodeForFeatures(request),
        usd: (key) => deps.prices.usd(key),
      }),
      // Partner keys (swap/on-ramp) are build secrets; none are set for mobile yet, so those show as "not switched on".
      // Secure Trade links open this app: a universal link once a domain is associated, else clipwallet://trade#offer=….
      { testnet: !APP.config.mainnet, tradeLinkBase: APP.tradeLinkBase },
    ),
  );

  /* hardware: device code loads on first use (like the extension's lazyHardware) */
  const hwStorage: HardwareStorage = { get: (k) => kv.get<string>(k), set: (k, v) => kv.set(k, v) };
  const ble = ledgerBle(kv);
  const bitcoinNetwork = APP.config.mainnet ? "mainnet" : "testnet";
  const keystoneBridge = new KeystoneBridge(() => events.emit({ type: "change" }));
  let hwMod: Promise<typeof import("@clip-wallet/hardware")> | undefined;
  const loadHw = () => (hwMod ??= import("@clip-wallet/hardware"));
  let ledgerP: Promise<LedgerSigner> | undefined;
  let keystoneP: Promise<KeystoneSigner> | undefined;
  const led = () => (ledgerP ??= loadHw().then((m) => new m.LedgerSigner({ bitcoinNetwork, transport: ble.transport, deviceName: "Ledger" })));
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
  const engineHardware = new EngineHardware({
    keyring: new HardwareKeyring({ signers: { ledger, keystone }, storage: hwStorage }),
    ledger,
    keystone: { signer: keystone, bridge: keystoneBridge },
    kv,
  });
  engine.attachHardware(engineHardware);
  void deps.walletConnect.warmUp();

  // Contacts (sealed by the vault's app-data key), Clip handles, local notifications and Discover.
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
    notifier: expoNotifier(),
    deviceLanguages,
    walletName: APP.config.name,
    coingeckoIds: COINGECKO_IDS,
    ...(APP.config.services.clipHandles ? { handles: APP.config.services.clipHandles } : {}),
  });
  engine.attachSocial(social);

  // Scam lists, address poisoning (contacts + your own sends), new contracts on every approval; the same checks as
  // the extension. Open phishing lists are downloads only; Blockaid isn't used on mobile builds (no key).
  const recipients = new RecipientLog(kv);
  const security = new SecurityService(
    {
      ...createFeatureHost({
        networks: deps.networks,
        assets: deps.assets,
        kv,
        ctx: (id) => engine.featureCtx(id),
        balances: () => engine.featureBalances(),
        enqueue: (request, appName) => engine.enqueueWalletRequest(request, appName),
        decode: (request) => engine.decodeForFeatures(request),
        usd: (key) => deps.prices.usd(key),
      }),
      nfts: () => engine.securityNfts(),
      history: () => recipients.list(),
      addressBook: async () =>
        (await social.contacts.list()).flatMap((c) => c.addresses.map((a) => ({ address: a.address, name: c.name, family: a.family }))),
    },
    { testnet: !APP.config.mainnet, threat: { openLists: true, refreshHours: 24 } },
  );
  engine.attachSecurity(security, recipients);
  void security.start().catch(() => undefined);

  // Clip Plugins: one hidden, network-less WebView per running plugin (src/plugins). Off unless Advanced mode and
  // Settings → Plugins are both on. Notifications only when the user has notifications on, labelled "(plugin)".
  const pluginSandboxes = createWebViewChannels();
  const notifier = expoNotifier();
  plugins = createMobilePlugins({
    kv,
    advanced: async () => (await engine.prefs()).advanced,
    channels: pluginSandboxes.factory,
    fetch: globalThis.fetch.bind(globalThis),
    gunzip: gunzipCapped,
    onNotify: (n) =>
      void social.notifications
        .settings()
        .then((st) => (st.enabled ? notifier.show({ id: `plugin-${randomUUID()}`, kind: "price", title: `${n.pluginName.slice(0, 60)} (plugin)`, body: n.text.slice(0, 300) }) : undefined))
        .catch(() => undefined),
  });
  engine.attachPlugins(plugins);
  const pollNotifications = () => social.poll();
  setBackgroundPoll(pollNotifications);
  void social.notifications.settings().then((st) => syncBackgroundTask(st.enabled), () => undefined);
  const socialClient = createEngineSocialClient(engine, {
    async requestNotificationPermission() {
      const ok = await requestNotificationPermission();
      if (ok) void syncBackgroundTask(true);
      return ok;
    },
  });

  const client = createEngineClient(engine, {
    subscribe: (cb) => events.on((e) => e.type !== "approval" && cb()),
  });

  const methods = async () => (await kv.get<UnlockMethod[]>(UNLOCK_METHODS)) ?? [];
  const live = async (kind: UnlockKind) => {
    const enrolled = new Set((await engine.listPasskeys()).map((p) => hex(p.credentialId)));
    return (await methods()).filter((m) => m.kind === kind && enrolled.has(m.id));
  };
  const enrol = async (kind: UnlockKind, password: string, prf: PrfProvider) => {
    const info = await engine.enrollPasskeyWith(password, prf);
    await kv.set(UNLOCK_METHODS, [...(await methods()).filter((m) => m.kind !== kind), { id: hex(info.credentialId), kind }]);
    // One of each kind: drop older enrolments of the same kind from the vault.
    for (const p of await engine.listPasskeys()) {
      const id = hex(p.credentialId);
      if (id !== hex(info.credentialId) && !(await methods()).some((m) => m.id === id)) await engine.removePasskey(p.credentialId);
    }
    events.emit({ type: "change" });
  };
  const unlockWith = async (kind: UnlockKind, prf: PrfProvider) => {
    const [m] = await live(kind);
    if (!m) throw new ClipError("That unlock method isn't set up. Use your password.", "unlock/not-enrolled");
    await engine.unlockWithPasskeyWith(prf, unhex(m.id));
    events.emit({ type: "change" });
  };

  const openSheet = async (url: string) => {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new ClipError("That link can't be opened.", "features/bad-url");
    await WebBrowser.openBrowserAsync(u.toString(), { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, dismissButtonStyle: "done", readerMode: false });
  };
  const features = createEngineFeaturesClient(engine, { openExternal: openSheet });
  const link = createMobileLink({
    kv,
    vault,
    engine,
    ...(APP.config.services.linkRelayUrl ? { relayUrl: APP.config.services.linkRelayUrl } : {}),
    ...(APP.config.services.backupUrl ? { syncUrl: APP.config.services.backupUrl } : {}),
    onChange: () => events.emit({ type: "change" }),
    openUrl: (url) => events.emit({ type: "open-url", url }),
  });

  return {
    link: link.client,
    linkService: link.service,
    engine,
    client,
    features,
    hardware: createEngineHardwareClient(engineHardware),
    ledger: ble,
    passkeyPrf: passkeysConfigured(APP.passkeyRpId) ? { create: (c) => nativePasskeyPrf(c.rpId ?? APP.passkeyRpId!, c.rpName) } : null,
    openSheet,
    async confirmPresence(reason, cancelLabel = "Cancel") {
      const info = await biometricInfo().catch(() => null);
      if (!info?.available) return false;
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel });
      if (!r.success) throw new ClipError("Cancelled. Nothing was shown.", "presence/cancelled");
      return true;
    },
    social: socialClient,
    security: createEngineSecurityClient(engine),
    plugins: createEnginePluginsClient(engine),
    pluginSandboxes,
    pollNotifications,
    events,
    argon2: { ...argon2, selfTest: argonCheck },
    walletConnectEnabled: deps.walletConnect.enabled,
    channel: `clip-${randomUUID()}`,
    browserNetworks: publicNetworks(deps.networks),
    async biometrics() {
      const info = await biometricInfo().catch(() => ({ available: false, label: "biometrics", reason: "Biometrics aren't available." }));
      return { ...info, enrolled: (await live("device")).length > 0 };
    },
    async enableBiometrics(password) {
      const info = await biometricInfo();
      if (!info.available) throw new ClipError(info.reason ?? "Biometrics aren't available.", "biometric/unavailable");
      await enrol("device", password, deviceKeyPrf(info.label));
    },
    async unlockWithBiometrics() {
      const info = await biometricInfo();
      await unlockWith("device", deviceKeyPrf(info.label));
    },
    async passkeys() {
      return { configured: passkeysConfigured(APP.passkeyRpId), enrolled: (await live("passkey")).length > 0 };
    },
    async enablePasskey(password) {
      if (!passkeysConfigured(APP.passkeyRpId)) throw new ClipError("Passkeys aren't set up in this build.", "passkey/unconfigured");
      await enrol("passkey", password, nativePasskeyPrf(APP.passkeyRpId, APP.config.name));
    },
    async unlockWithPasskey() {
      if (!passkeysConfigured(APP.passkeyRpId)) throw new ClipError("Passkeys aren't set up in this build.", "passkey/unconfigured");
      await unlockWith("passkey", nativePasskeyPrf(APP.passkeyRpId, APP.config.name));
    },
    async removeUnlockMethods() {
      for (const m of await methods()) if (m.kind === "device") await forgetDeviceKey(unhex(m.id));
      await kv.set(UNLOCK_METHODS, []);
      await engine.removePasskeys();
    },
  };
}
