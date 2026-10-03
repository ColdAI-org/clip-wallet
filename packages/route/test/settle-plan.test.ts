/** Settle on Hedera in the approval's Details: off without the switch or a deployment; one plain option per shortfall. */
import { describe, expect, it, vi } from "vitest";
import type { AssetRef, Network, TokenBalance } from "@clip-wallet/core";
import { settleClientFor, settleFundingOption } from "../src/settle-plan.js";
import type { ConnectorQuote, SettleOnHederaClient } from "../src/phase3.js";
import type { Shortfall } from "../src/types.js";

const USDC_HEDERA: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: "hedera:testnet", address: "0.0.429274" };
const USDC_BASE: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: "eip155:84532", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
const BASE: Network = { id: "eip155:84532", family: "evm", name: "Base Sepolia", nativeAsset: { ...USDC_BASE, key: "eth" }, testnet: true, rpcUrls: ["https://sepolia.base.org"], explorerUrl: "", chainId: 84532 };
const ME = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

const shortfall = (elsewhere: TokenBalance[]): Shortfall => ({ asset: USDC_HEDERA, need: "25000000", have: "12000000", missing: "13000000", sameAssetElsewhere: elsewhere, otherBalances: [] });

function fakeSettle(quotes: Partial<ConnectorQuote>[] | Error): SettleOnHederaClient & { quoteConnectors: ReturnType<typeof vi.fn> } {
  return {
    quoteConnectors: vi.fn(async () => {
      if (quotes instanceof Error) throw quotes;
      return quotes as ConnectorQuote[];
    }),
    createOrder: vi.fn(),
    getOrder: vi.fn(),
    listOrders: vi.fn(),
    getBond: vi.fn(),
    claimFromBond: vi.fn(),
  } as never;
}

describe("settle on Hedera in the plan", () => {
  it("is off unless switched on, and has no client while nothing is deployed", () => {
    expect(settleClientFor({ enabled: false, mainnet: false })).toBeNull();
    expect(settleClientFor({ enabled: true, mainnet: false })).toBeNull(); // SETTLE_DEPLOYMENTS is empty today
  });

  it("asks for a quote from the same asset on an EVM network and describes the best one", async () => {
    const settle = fakeSettle([{ title: "Get 13 USDC from Connector A", display: { deposit: "Pay 13.05 USDC on Base", fee: "Fee 0.05 USDC", receive: "", cover: "If it's late: 14 HBAR from its bond", time: "About 2 min", deadline: "" } }]);
    const opt = await settleFundingOption(settle, shortfall([{ asset: USDC_BASE, amount: "40000000" }]), ME, [BASE]);
    expect(opt).toEqual({ title: "Get 13 USDC from Connector A", detail: "Pay 13.05 USDC on Base · Fee 0.05 USDC · If it's late: 14 HBAR from its bond · About 2 min" });
    expect(settle.quoteConnectors).toHaveBeenCalledWith({
      from: { networkId: "eip155:84532", asset: USDC_BASE },
      to: { networkId: "hedera:testnet", asset: USDC_HEDERA, amount: "13000000", recipient: ME },
      user: ME,
    });
  });

  it("stays out of the way: no EVM source, no account, no quote or an error all give null", async () => {
    const settle = fakeSettle([]);
    expect(await settleFundingOption(settle, shortfall([]), ME, [BASE])).toBeNull();
    expect(await settleFundingOption(settle, shortfall([{ asset: USDC_BASE, amount: "1" }]), undefined, [BASE])).toBeNull();
    expect(await settleFundingOption(settle, shortfall([{ asset: USDC_BASE, amount: "1" }]), ME, [BASE])).toBeNull();
    expect(await settleFundingOption(fakeSettle(new Error("down")), shortfall([{ asset: USDC_BASE, amount: "1" }]), ME, [BASE])).toBeNull();
  });
});
