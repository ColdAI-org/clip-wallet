import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createBitcoinCashDispatcher } from "../src/background/bitcoincash.js";
import { rpcError } from "../src/shared/errors.js";
import { bchAddressOn, bchNetworkForWcChain, bchWcChainFor } from "../src/shared/bitcoincash.js";

/** The public "abandon … about" BCH account 0 (chains-bitcoincash test/signatures.ts). */
const MAIN = "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6";
const TEST = "bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x";
const asset = (networkId: string) => ({ key: "bch", symbol: "BCH", name: "Bitcoin Cash", decimals: 8, networkId });
const CHIPNET: Network = { id: "bip122:00000000040ba9641ba98a37b2e5ceea", family: "bitcoincash", name: "Chipnet", nativeAsset: asset("x"), testnet: true, rpcUrls: [], explorerUrl: "" };
const MAINNET: Network = { id: "bip122:000000000000000000651ef99cb9fcbe", family: "bitcoincash", name: "Bitcoin Cash", nativeAsset: asset("y"), testnet: false, rpcUrls: [], explorerUrl: "" };

describe("Bitcoin Cash over WalletConnect (wc2-bch-bcr)", () => {
  it("re-spells CashAddr per network and maps the spec's chain ids", () => {
    expect(bchAddressOn(MAIN, CHIPNET.id)).toBe(TEST);
    expect(bchAddressOn(TEST, MAINNET.id)).toBe(MAIN);
    expect(bchAddressOn(MAIN.slice(0, -1) + "7", CHIPNET.id)).toBeUndefined();
    expect(bchNetworkForWcChain("bch:bchtest")).toBe(CHIPNET.id);
    expect(bchNetworkForWcChain("bch:bitcoincash")).toBe(MAINNET.id);
    expect(bchNetworkForWcChain("bch:bchreg")).toBeUndefined();
    expect(bchWcChainFor(CHIPNET.id)).toBe("bch:bchtest");
  });

  it("answers bch_getAddresses for the session's network and passes signing through after permission", async () => {
    let permitted = false;
    const approved: DappRequest[] = [];
    const d = createBitcoinCashDispatcher({
      permitted: async () => permitted,
      requirePermission: async () => {
        if (!permitted) throw rpcError.unauthorized();
      },
      accounts: async () => [{ address: MAIN }],
      approve: async (req) => (approved.push(req), { signedTransaction: "00", signedTransactionHash: "11" }),
      makeReq: (origin: string, family: Family, net: Network, method: string, params: unknown) => ({ id: "1", origin, via: "walletconnect" as const, family, networkId: net.id, method, params }),
      requireNetwork: (_f, _o, chain) => (chain === MAINNET.id ? MAINNET : CHIPNET),
    });
    await expect(d.dispatch("https://app", "bitcoincash", "bch_getAddresses", {}, "bch:bchtest")).rejects.toMatchObject({ code: 4100 });
    permitted = true;
    expect(await d.dispatch("https://app", "bitcoincash", "bch_getAddresses", {}, "bch:bchtest")).toEqual([TEST]);
    expect(await d.dispatch("https://app", "bitcoincash", "bch_getAddresses", {}, "bch:bitcoincash")).toEqual([MAIN]);
    await d.dispatch("https://app", "bitcoincash", "bch_signMessage", { message: "hi" }, "bch:bchtest");
    expect(approved[0]).toMatchObject({ family: "bitcoincash", networkId: CHIPNET.id, method: "bch_signMessage" });
    await expect(d.dispatch("https://app", "bitcoincash", "bch_sendTransaction", {}, "bch:bchtest")).rejects.toMatchObject({ code: 4200 });
  });
});
