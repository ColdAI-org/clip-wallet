import type { AssetRef, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { NATIVE_ASSET_ADDRESS, auxiliaryFundsFor, settleSourceNetworks } from "../src/index.js";

const net = (chainId: number): Network => ({
  id: `eip155:${chainId}`,
  family: "evm",
  name: String(chainId),
  chainId,
  nativeAsset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: `eip155:${chainId}` },
  testnet: true,
  rpcUrls: [],
  explorerUrl: "",
});
const NETS = [net(11155111), net(84532), net(296)];
const a = (key: string, networkId: string, address?: string, extra: Partial<AssetRef> = {}): AssetRef => ({ key, symbol: key.toUpperCase(), name: key, decimals: 6, networkId, ...(address ? { address } : {}), ...extra });
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ASSETS = [
  a("eth", "eip155:11155111"),
  a("usdc", "eip155:11155111", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
  a("eth", "eip155:84532"),
  a("usdc", "eip155:84532", USDC_BASE),
  a("usdc.e", "eip155:84532", "0x00000000000000000000000000000000000000e1", { bridged: true }),
  a("hbar", "eip155:296"),
];

describe("ERC-7682 auxiliaryFunds from settle on Hedera", () => {
  it("advertises a network's assets that share a key with another deposit network (native as the EIP-7528 address)", () => {
    const out = auxiliaryFundsFor({ networkIds: ["eip155:84532", "eip155:11155111", "eip155:296", "eip155:1"], networks: NETS, assets: ASSETS, sources: ["eip155:11155111"] });
    expect(out["eip155:84532"]).toEqual({ supported: true, assets: [NATIVE_ASSET_ADDRESS, USDC_BASE] });
    // The deposit network itself has no OTHER source; HBAR exists nowhere else; unknown chains get nothing.
    expect(out["eip155:11155111"]).toBeUndefined();
    expect(out["eip155:296"]).toBeUndefined();
    expect(out["eip155:1"]).toBeUndefined();
  });

  it("is off without sources (settle on Hedera switched off)", () => {
    expect(auxiliaryFundsFor({ networkIds: ["eip155:84532"], networks: NETS, assets: ASSETS, sources: [] })["eip155:84532"]).toBeUndefined();
  });

  it("the testnet order book takes deposits on Ethereum Sepolia; no mainnet deployment yet", () => {
    expect(settleSourceNetworks()).toEqual(["eip155:11155111"]);
    expect(settleSourceNetworks(true)).toEqual([]);
  });
});
