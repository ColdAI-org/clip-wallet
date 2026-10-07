import { describe, expect, it } from "vitest";
import { FAMILIES, type Family } from "@clip-wallet/core";
import config from "./clip.config";
import { FAST_ARGON2 } from "./helpers";
import { MemoryKV } from "../src/shared/storage";
import { createDependencies } from "../src/background/wiring";

/**
 * A chain module's `derivationPath()` is what kit hosts, docs and hardware flows read as "where this family's
 * keys live". It must name the path the vault really derives the account at (testnet defaults), or a wallet
 * restored elsewhere from that path would show a different account. Regression: chains-hedera said
 * m/44'/60'/0'/0/i (the EVM path) while the vault derives Hedera ECDSA keys at m/44'/3030'/0'/0/i.
 */
describe("chain module derivation paths match the vault's accounts", () => {
  it("for every family and the first indexes", async () => {
    const deps = createDependencies({ kv: new MemoryKV(), mocks: false, config, iconUrl: "x", currency: async () => "USD", vaultOptions: FAST_ARGON2 });
    await deps.loadChains();
    await deps.vault.create("a long test password");
    const families = Object.keys(deps.chains).sort() as Family[];
    expect(families).toHaveLength(FAMILIES.length);
    for (const family of families) {
      const mod = deps.chains[family]!;
      for (const i of [0, 1]) {
        const account = await deps.vault.deriveAccount(family, i);
        // The vault prefixes Starknet's key-grinding scheme ("argent-x:m/…"); the BIP-32 path is the module's.
        const expected = account.derivationPath.replace(/^[a-z-]+:/, "");
        expect({ family, i, path: mod.derivationPath(i) }).toEqual({ family, i, path: expected });
      }
    }
  });

  it("Hedera: m/44'/3030'/0'/0/i, not the EVM path", async () => {
    const { createHederaModule } = await import("@clip-wallet/chains-hedera");
    const hedera = createHederaModule();
    expect(hedera.derivationPath(0)).toBe("m/44'/3030'/0'/0/0");
    expect(hedera.derivationPath(5)).toBe("m/44'/3030'/0'/0/5");
    expect(hedera.derivationPath(5)).not.toBe("m/44'/60'/0'/0/5");
  });
});
