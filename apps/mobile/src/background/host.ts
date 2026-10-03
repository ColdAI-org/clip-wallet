/**
 * The phone's "background": builds the vault (this folder is the only place in apps/mobile allowed to import
 * @clip-wallet/vault, like apps/extension/src/background) and the shared @clip-wallet/engine on React Native
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
  publicNetworks,
  type KV,
  type PrfProvider,
} from "@clip-wallet/engine";
import { createEngineDependencies } from "@clip-wallet/engine/wiring";
import { createFeatureHost, createFeatures } from "@clip-wallet/engine/features";
import type { FeaturesClient, WalletClient } from "@clip-wallet/ui";
import * as Linking from "expo-linking";
import { ClipError } from "@clip-wallet/core";
import { APP } from "../env";
import { pickArgon2id, selfTest, type Argon2Choice } from "./argon2";
import { appKV, secureVaultStorage } from "./storage";
import { biometricInfo, deviceKeyPrf, forgetDeviceKey, type BiometricInfo } from "./device-key";
import { nativePasskeyPrf, passkeysConfigured } from "./passkey";
import { Events } from "./events";

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
  const deps = createEngineDependencies({
    config: APP.config,
    vault,
    hashPayload: hashSignablePayload,
    currency: async () => (await engine.prefs()).displayCurrency,
    walletConnect: { projectId: APP.wcProjectId, url: APP.siteUrl, iconUrl: APP.iconUrl },
    // CoinGecko prices cached in app storage (no partner key on mobile builds yet).
    kv,
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
      { testnet: !APP.config.mainnet },
    ),
  );
  void deps.walletConnect.warmUp();

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

  const features = createEngineFeaturesClient(engine, { openExternal: async (url) => void (await Linking.openURL(url)) });

  return {
    engine,
    client,
    features,
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
