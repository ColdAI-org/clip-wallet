/**
 * A MobileWallet for screen tests: the real WalletEngine and in-process client over a fake vault and a stub
 * EVM module (packages/engine/test/fixtures.ts). No keys: the "phrase" is twelve placeholder tokens.
 */
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { WalletEngine, MemoryKV, createEngineClient } from "@clip-wallet/engine";
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

export function testWallet(): MobileWallet & { vault: FakeVault } {
  const events = new Events();
  const vault = new PhraseVault();
  const env = makeEnv((id) => events.emit({ type: "approval", id }));
  env.broadcast = () => events.emit({ type: "change" });
  const engine = new WalletEngine(makeDeps(vault), new MemoryKV(), env);
  engine.start();
  const client = createEngineClient(engine, { subscribe: (cb) => events.on((e) => e.type !== "approval" && cb()) });
  return {
    vault,
    engine,
    client,
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
