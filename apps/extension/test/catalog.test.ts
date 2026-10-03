import { describe, expect, it } from "vitest";
import { defineConfig, enabledFamilies } from "@clip-wallet/config";
import { walletAssets, walletNetworks } from "../src/shared/catalog";
import { RoutePlannerAdapter, ReferencePriceFeed } from "../src/background/real";
import config from "../clip.config";

describe("catalog (real chain packages)", () => {
  it("is testnet-only by default and follows clip.config networks", () => {
    const nets = walletNetworks(config);
    expect(nets.length).toBeGreaterThan(4);
    expect(nets.every((n) => n.testnet)).toBe(true);
    expect(new Set(nets.map((n) => n.family))).toEqual(new Set(enabledFamilies(config)));
    const onlyBase = walletNetworks(defineConfig({ name: "X", rdns: "com.x.wallet", networks: ["evm:84532", "hedera"] }));
    expect(onlyBase.map((n) => n.id)).toEqual(["eip155:84532", "hedera:testnet"]);
  });

  it("lists receivable assets including zero-balance USDC", () => {
    const assets = walletAssets(walletNetworks(config));
    expect(assets.some((a) => a.symbol === "USDC" && a.networkId === "eip155:84532")).toBe(true);
    expect(assets.some((a) => a.symbol === "USDC" && a.networkId === "hedera:testnet")).toBe(true);
  });
});

describe("RoutePlannerAdapter", () => {
  it("needs no funding when the balance is already where it's needed", async () => {
    const planner = new RoutePlannerAdapter(config, new ReferencePriceFeed(), async () => "USD");
    const usdc = { key: "usdc-testnet", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: "eip155:84532", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
    const plan = await planner.plan({
      request: { id: "1", origin: "https://x.example", via: "injected", family: "evm", networkId: "eip155:84532", method: "eth_sendTransaction", params: [] },
      decoded: { requestId: "1", title: "Pay 5 USDC", lines: [], balanceChanges: [{ asset: usdc, delta: "-5000000" }], simulated: true, blind: false, warnings: [], networkId: "eip155:84532" },
      balances: [{ asset: usdc, amount: "9000000" }],
      networks: walletNetworks(config),
    });
    expect(plan.steps.map((s) => s.kind)).toEqual(["action"]);
    expect(plan.problem).toBeUndefined();
    expect(plan.source).toBe("Your balance");
  });
});
