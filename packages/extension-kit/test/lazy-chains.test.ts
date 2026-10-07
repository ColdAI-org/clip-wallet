import { describe, expect, it } from "vitest";
import config from "./clip.config";
import { MemoryKV } from "../src/shared/storage";
import { createDependencies, type LazyChainModule } from "../src/background/wiring";

describe("lazily loaded chain modules", () => {
  it("cover all 26 families; the lazy ones match their real module once loaded", async () => {
    const deps = createDependencies({ kv: new MemoryKV(), mocks: false, config, iconUrl: "x", currency: async () => "USD" });
    expect(Object.keys(deps.chains).sort()).toEqual(
      [
        "algorand", "antelope", "aptos", "bitcoin", "bitcoincash", "cardano", "cosmos", "evm", "fuel", "hedera", "icp", "initia", "multiversx",
        "near", "provenance", "solana", "stacks", "starknet", "stellar", "substrate", "sui", "tezos", "thorchain", "ton", "tron", "xrpl",
      ],
    );
    const lazy = Object.values(deps.chains).filter((m): m is LazyChainModule => "load" in m!);
    expect(lazy).toHaveLength(22);
    // Synchronous members refuse plainly until the module is loaded.
    expect(() => deps.chains.sui!.isAddress("0x1")).toThrow(/still loading/);
    await deps.loadChains();
    for (const m of lazy) {
      const real = await m.load();
      expect({ family: m.family, curve: m.curve }).toEqual({ family: real.family, curve: real.curve });
      expect(m.derivationPath(0)).toBe(real.derivationPath(0));
    }
    expect(deps.chains.sui!.isAddress(`0x${"ab".repeat(32)}`)).toBe(true);
  });
});
