/**
 * Internal audit 2026-10 (docs/audit/internal-audit-2026-10.md).
 *  1MASK-02  disconnecting one family of a site in the wallet revokes only that family.
 */
import { describe, expect, it } from "vitest";
import type { Network } from "@clip-wallet/core";
import { createMemoryPermissionStore } from "@clip-wallet/1mask/background";
import { OneMaskConnector } from "../src/adapters.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 18, networkId });
const NETWORKS: Network[] = [
  { id: "eip155:11155111", family: "evm", name: "Sepolia", chainId: 11155111, nativeAsset: asset("eth", "eip155:11155111"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", family: "solana", name: "Solana Devnet", nativeAsset: asset("sol", "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"), testnet: true, rpcUrls: [], explorerUrl: "" },
];

describe("audit: 1Mask disconnect", () => {
  it("1MASK-02: disconnecting a site's EVM connection leaves its Solana connection alone", async () => {
    const O = "https://dapp.example";
    const permissions = createMemoryPermissionStore([
      [O, "evm"],
      [O, "solana"],
    ]);
    const c = new OneMaskConnector(NETWORKS);
    c.start({ permissions, accountsFor: async () => [], isUnlocked: async () => true, preferredNetwork: () => undefined, cancel: () => undefined } as never);
    await c.disconnected(O, "evm");
    expect(await permissions.has(O, "evm")).toBe(false);
    expect(await permissions.has(O, "solana")).toBe(true);
  });
});
