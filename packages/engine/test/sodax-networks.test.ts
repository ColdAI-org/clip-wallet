// SODAX swaps (docs/features/sodax-swaps.md) only reach networks the wallet carries: every spoke in the features
// package must be one of the EVM mainnets in chains-evm, never a test network and never Hedera's EVM.
import { describe, expect, it } from "vitest";
import { EVM_NETWORKS, HEDERA_EVM_NETWORKS } from "@clip-wallet/chains-evm";
import { SODAX_SPOKES } from "@clip-wallet/features";

describe("SODAX spokes", () => {
  it("are EVM mainnets the wallet carries", () => {
    const ids = Object.keys(SODAX_SPOKES).map(Number);
    expect(ids.length).toBeGreaterThan(0);
    for (const chainId of ids) {
      const n = EVM_NETWORKS.find((x) => x.chainId === chainId);
      expect(n, `chain ${chainId}`).toBeDefined();
      expect(n!.testnet, n!.name).toBe(false);
      expect(HEDERA_EVM_NETWORKS.some((x) => x.chainId === chainId)).toBe(false);
    }
  });
});
