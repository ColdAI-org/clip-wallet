import { describe, expect, it } from "vitest";
import type { Family } from "@clip-wallet/core";
import { derivationPath as vaultPath } from "@clip-wallet/vault";
import config from "./clip.config";
import { MemoryKV } from "../src/shared/storage";
import { createDependencies } from "../src/background/wiring";

/**
 * A chain module's `derivationPath()` is what kit hosts, docs and hardware flows read as "where this family's
 * keys live". It must name the path the vault really derives at (testnet defaults), or a wallet restored
 * elsewhere from that path would show a different account. Regression: chains-hedera said m/44'/60'/0'/0/i
 * (the EVM path) while the vault derives Hedera ECDSA keys at m/44'/3030'/0'/0/i.
 */
describe("chain module derivation paths match the vault", () => {
  it("for every family and the first few indexes", async () => {
    const deps = createDependencies({ kv: new MemoryKV(), mocks: false, config, iconUrl: "x", currency: async () => "USD" });
    await deps.loadChains();
    const families = Object.keys(deps.chains).sort() as Family[];
    expect(families).toHaveLength(14);
    for (const family of families) {
      const mod = deps.chains[family]!;
      for (const i of [0, 1, 7]) {
        // The vault prefixes Starknet's key-grinding scheme ("argent-x:m/…"); the BIP-32 path is the module's.
        const expected = vaultPath(family, i).replace(/^[a-z-]+:/, "");
        expect({ family, i, path: mod.derivationPath(i) }).toEqual({ family, i, path: expected });
      }
    }
  });

  it("Hedera: m/44'/3030'/0'/0/i, not the EVM path", async () => {
    const { createHederaModule } = await import("@clip-wallet/chains-hedera");
    const hedera = createHederaModule();
    expect(hedera.derivationPath(0)).toBe("m/44'/3030'/0'/0/0");
    expect(hedera.derivationPath(5)).toBe("m/44'/3030'/0'/0/5");
    expect(hedera.derivationPath(5)).not.toBe(vaultPath("evm", 5));
  });
});
