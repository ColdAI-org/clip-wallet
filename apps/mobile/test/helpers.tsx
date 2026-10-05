/**
 * A MobileWallet for screen tests: the real WalletEngine and in-process client over a fake vault and a stub
 * EVM module (packages/engine/test/fixtures.ts). No keys: the "phrase" is twelve placeholder tokens.
 */
import { act, render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { WalletEngine, MemoryKV, createEngineClient, createEngineFeaturesClient, createEngineSecurityClient, createEnginePluginsClient, createEngineSocialClient, type EnginePlugins } from "@clip-wallet/engine";
import { EngineHardware, createEngineHardwareClient } from "@clip-wallet/engine/hardware";
import { createSocial } from "@clip-wallet/engine/social";
import type { Notice } from "@clip-wallet/social";
import type { MobileWallet } from "../src/background/host";
import { createLinkClient } from "@clip-wallet/ui";
import { Events } from "../src/background/events";
import { WalletProvider, type Route } from "../src/ui/context";
import { BASE_SEPOLIA, FakeVault, SEPOLIA, makeDeps, makeEnv } from "../../../packages/engine/test/fixtures";
import { fakeHardwareDeps } from "../../../packages/engine/test/hardware-fixtures";
import { FEATURE_ANSWERS, QUEUE } from "./feature-fixtures";
import { SECURITY_ANSWERS } from "./security-fixtures";

export const WORDS = Array.from({ length: 12 }, (_, i) => `word${i + 1}`);

class PhraseVault extends FakeVault {
  override async revealPhrase(password: string) {
    await super.revealPhrase(password);
    return WORDS.join(" ");
  }
}

export interface TestWallet extends MobileWallet {
  vault: FakeVault;
  /** Feature requests the screens made, in order (type + params). */
  featureCalls: { type: string; [k: string]: unknown }[];
  opened: string[];
  releaseLedger: () => void;
  ledgerPicked: { id: string; name: string } | null;
  /** Local notifications the social service showed. */
  notices: Notice[];
  /** sec* requests the Security screens made, in order. */
  securityCalls: { type: string; [k: string]: unknown }[];
  /** link* requests the Linked devices screens made, in order. */
  linkCalls: { type: string; [k: string]: unknown }[];
}

export interface TestWalletOptions {
  /** Answers for link* requests (Linked devices); default: nothing linked, sync available. */
  link?: Partial<Record<string, (m: Record<string, unknown>) => unknown>>;
  /** Answers for sec* requests (default: security-fixtures.ts). Return QUEUE to queue a wallet approval. */
  security?: Partial<Record<string, (m: Record<string, unknown>) => unknown>>;
  /** Clip Plugins on the engine (default: none, so the Plugins entry is hidden). */
  plugins?: (engine: WalletEngine, kv: MemoryKV) => EnginePlugins;
}

export function testWallet(answers: Partial<Record<string, (m: Record<string, unknown>) => unknown>> = {}, opts: TestWalletOptions = {}): TestWallet {
  const events = new Events();
  const vault = new PhraseVault();
  const env = makeEnv((id) => events.emit({ type: "approval", id }));
  env.broadcast = () => events.emit({ type: "change" });
  const deps = makeDeps(vault);
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, env);
  engine.start();
  const hw = fakeHardwareDeps(kv, () => events.emit({ type: "change" }));
  const engineHardware = new EngineHardware(hw.deps);
  engine.attachHardware(engineHardware);
  const featureCalls: TestWallet["featureCalls"] = [];
  const opened: string[] = [];
  // Social services with no network: Discover fails plainly, notices are collected.
  const notices: Notice[] = [];
  engine.attachSocial(
    createSocial({
      networks: deps.networks,
      assets: deps.assets,
      chains: deps.chains,
      kv,
      ctx: (id) => engine.featureCtx(id),
      enqueue: async (r, app) => ({ id: (await engine.enqueueWalletRequest(r, app)).id }),
      approvals: async () => engine.socialApprovals(),
      prices: deps.prices,
      notifier: { show: async (n) => void notices.push(n) },
      deviceLanguages: () => ["en-US"],
      walletName: "Clip Wallet",
      fetch: (async () => new Response("{}", { status: 503 })) as typeof fetch,
    }),
  );
  const client = createEngineClient(engine, { subscribe: (cb) => events.on((e) => e.type !== "approval" && cb()) });
  // Feature services with sample answers (the real ones call partner APIs). Wallet-built requests still go
  // through the engine's real approval queue (enqueueWalletRequest), like the real StakingService/Swap/Trade.
  engine.attachFeatures({
    refine: (_r, d) => d,
    handle: (async (m: { type: string; [k: string]: unknown }) => {
      featureCalls.push(m);
      const answer = answers[m.type] ?? FEATURE_ANSWERS[m.type];
      if (!answer) throw new Error(`not in tests: ${m.type}`);
      const out = await answer(m);
      if (out === QUEUE) {
        const { id } = await engine.enqueueWalletRequest({ id: `req-${featureCalls.length}`, origin: "wallet", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "personal_sign", params: ["0x68656c6c6f"] }, "Clip Wallet");
        return m.type === "featTradeCreate" ? { offerId: "offer-1", queued: { approvalId: id, steps: ["Sign the offer"] } } : { approvalId: id, steps: ["Approve"] };
      }
      return out;
    }) as never,
  });
  const features = createEngineFeaturesClient(engine, { openExternal: async (url) => void opened.push(url) });
  // Security service with sample answers (the real one scans RPCs/indexers). Revokes and cleanups queue a real
  // approval on the engine, like SecurityService does through host.enqueue.
  const securityCalls: TestWallet["securityCalls"] = [];
  engine.attachSecurity({
    refine: async (_r, d) => d,
    assessSite: async () => [],
    threat: { isKnownScam: () => false } as never,
    cleanup: { hidden: async () => new Set<string>() } as never,
    handle: (async (m: { type: string; [k: string]: unknown }) => {
      securityCalls.push(m);
      const answer = opts.security?.[m.type] ?? SECURITY_ANSWERS[m.type];
      if (!answer) throw new Error(`not in tests: ${m.type}`);
      const out = await answer(m);
      if (out === QUEUE) {
        const { id } = await engine.enqueueWalletRequest({ id: `sec-${securityCalls.length}`, origin: "wallet", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "personal_sign", params: ["0x68656c6c6f"] }, "Clip Wallet");
        return { queued: { approvalId: id, steps: ["Remove permission"] }, hidden: 0 };
      }
      return out;
    }) as never,
  });
  if (opts.plugins) engine.attachPlugins(opts.plugins(engine, kv));
  const social = createEngineSocialClient(engine, { requestNotificationPermission: async () => true });
  let ledgerPicked: TestWallet["ledgerPicked"] = null;
  const linkCalls: TestWallet["linkCalls"] = [];
  const linkDefaults: Record<string, (m: Record<string, unknown>) => unknown> = {
    linkStatus: () => ({ platform: "mobile", devices: [], sync: { available: true, enabled: false }, signer: { deviceId: null, online: false, waiting: [] }, pairings: [], handoffs: [], capabilities: { relay: true, desktop: false, sync: true } }),
  };
  const link = createLinkClient(async (m) => {
    linkCalls.push(m);
    const answer = opts.link?.[m.type] ?? linkDefaults[m.type];
    return answer ? answer(m) : undefined;
  });
  const wallet: TestWallet = {
    link,
    linkService: null as never,
    linkCalls,
    vault,
    featureCalls,
    opened,
    releaseLedger: hw.releaseLedger,
    get ledgerPicked() {
      return ledgerPicked;
    },
    engine,
    client,
    features,
    hardware: createEngineHardwareClient(engineHardware),
    ledger: {
      prepare: async () => undefined,
      scan: (onDevice) => {
        setTimeout(() => onDevice({ id: "AA:BB", name: "Nano X 1A2B" }), 0);
        return () => undefined;
      },
      select: async (d) => void (ledgerPicked = d),
      selected: async () => ledgerPicked,
      forget: async () => void (ledgerPicked = null),
    },
    passkeyPrf: null,
    openSheet: async (url) => void opened.push(url),
    confirmPresence: async () => true,
    social,
    notices,
    securityCalls,
    security: createEngineSecurityClient(engine),
    plugins: opts.plugins ? createEnginePluginsClient(engine) : null,
    pluginSandboxes: null,
    pollNotifications: async () => undefined,
    events,
    argon2: { kind: "native", fn: async () => new Uint8Array(32), selfTest: Promise.resolve(true) },
    walletConnectEnabled: false,
    channel: "test",
    browserNetworks: [SEPOLIA, BASE_SEPOLIA],
    biometrics: async () => ({ available: true, label: "Face ID", enrolled: false }),
    enableBiometrics: async () => undefined,
    unlockWithBiometrics: async () => undefined,
    passkeys: async () => ({ configured: false, enrolled: false }),
    enablePasskey: async () => undefined,
    unlockWithPasskey: async () => undefined,
    removeUnlockMethods: async () => undefined,
  };
  return wallet;
}


export function renderWith(wallet: MobileWallet, ui: ReactElement, initialRoute?: Route) {
  return render(
    <WalletProvider wallet={wallet} initialRoute={initialRoute}>
      {ui}
    </WalletProvider>,
  );
}

/** Lets pending engine promises resolve and React apply their state updates (inside act). */
export async function settle(times = 3) {
  for (let i = 0; i < times; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
}

/** findBy* that also flushes async state updates between tries (the engine answers through promises). */
export async function eventually<T>(get: () => T, tries = 150): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return get();
    } catch (e) {
      last = e;
      await settle(1);
    }
  }
  throw last;
}
