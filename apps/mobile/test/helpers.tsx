/**
 * A MobileWallet for screen tests: the real WalletEngine and in-process client over a fake vault and a stub
 * EVM module (packages/engine/test/fixtures.ts). No keys: the "phrase" is twelve placeholder tokens.
 */
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { WalletEngine, MemoryKV, createEngineClient, createEngineFeaturesClient, createEngineSocialClient } from "@clip-wallet/engine";
import { createSocial } from "@clip-wallet/engine/social";
import type { Notice } from "@clip-wallet/social";
import type { MobileWallet } from "../src/background/host";
import { Events } from "../src/background/events";
import { WalletProvider, type Route } from "../src/ui/context";
import { BASE_SEPOLIA, FakeVault, SEPOLIA, makeDeps, makeEnv } from "../../../packages/engine/test/fixtures";

export const WORDS = Array.from({ length: 12 }, (_, i) => `word${i + 1}`);

class PhraseVault extends FakeVault {
  override async revealPhrase(password: string) {
    await super.revealPhrase(password);
    return WORDS.join(" ");
  }
}

export function testWallet(): MobileWallet & { vault: FakeVault; notices: Notice[] } {
  const events = new Events();
  const vault = new PhraseVault();
  const env = makeEnv((id) => events.emit({ type: "approval", id }));
  env.broadcast = () => events.emit({ type: "change" });
  const deps = makeDeps(vault);
  const kv = new MemoryKV();
  const engine = new WalletEngine(deps, kv, env);
  engine.start();
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
  // Feature services with sample answers (the real ones call partner APIs).
  engine.attachFeatures({
    refine: (_r, d) => d,
    handle: (async (m: { type: string }) => {
      if (m.type === "featFeatured") return [{ name: "SaucerSwap", url: "https://www.saucerswap.finance/", domain: "saucerswap.finance", category: "swap", description: "Swap tokens and earn from liquidity.", family: "hedera" }];
      if (m.type === "featStakingOverview")
        return [{ assetKey: "ada", symbol: "ADA", name: "Cardano", wholeBalance: true, howItWorks: "", positions: [], unavailable: { code: "staking/coming-soon", message: "Staking ADA is coming soon." } }];
      throw new Error(`not in tests: ${m.type}`);
    }) as never,
  });
  const features = createEngineFeaturesClient(engine, { openExternal: async () => undefined });
  const social = createEngineSocialClient(engine, { requestNotificationPermission: async () => true });
  return {
    vault,
    engine,
    client,
    features,
    social,
    notices,
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
}

export function renderWith(wallet: MobileWallet, ui: ReactElement, initialRoute?: Route) {
  return render(
    <WalletProvider wallet={wallet} initialRoute={initialRoute}>
      {ui}
    </WalletProvider>,
  );
}
