import type { Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { installOneMask } from "../src/inpage/index.js";
import { NETWORKS, makeHarness, tick } from "./helpers.js";

/** End to end after integration: inpage providers → content bridge → real router → handle(). */

const asset = (key: string, networkId: string) => ({ key, symbol: key, name: key, decimals: 6, networkId });
const net = (id: string, family: Family): Network => ({ id, family, name: id, nativeAsset: asset(family, id), testnet: true, rpcUrls: [], explorerUrl: "" });
const P2_NETS: Network[] = [
  ...NETWORKS,
  net("near:testnet", "near"),
  net("stellar:testnet", "stellar"),
  net("tezos:NetXsqzbfFenSTS", "tezos"),
  net("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", "algorand"),
];
const PUB = "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const P2_ACCOUNTS: Partial<Record<Family, { address: string; publicKey?: string }[]>> = {
  near: [{ address: PUB, publicKey: PUB }],
  stellar: [{ address: "GA6SXIZIKLJHCZI2KEOBEUUOFMM4JUPPM2UTWX6STAWT25JWIEUFIMFF", publicKey: PUB }],
  tezos: [{ address: "tz1XvkuUNDk8j2tG3RJaRUo4Xppcjc6FvK39", publicKey: PUB }],
  algorand: [{ address: "HNVCPPGOW2SC2YVDVDICU3YNONSTEFLXDXREHJR2YBEKDC2Z3IUZSC6YGI", publicKey: PUB }],
};

describe("NEAR, Stellar, Algorand through the router", () => {
  it("connects, signs, and refuses before connect", async () => {
    const h = makeHarness({
      networks: P2_NETS,
      accountsFor: (_o, f) => P2_ACCOUNTS[f] ?? [],
      handleImpl: (r) => {
        if (r.method === "near_signAndSendTransaction") return { transaction: { hash: "h" } };
        if (r.method === "stellar_signXDR") return { signedXDR: "SIGNED" };
        if (r.method === "algo_signTxn") return ["c2ln"];
        return true;
      },
    });
    const om = installOneMask({ networks: P2_NETS, channel: h.channel }, h.win);
    const { near, stellar, algorand } = om.p2!;

    await expect(near!.signAndSendTransaction({ receiverId: "x.testnet", actions: [] })).rejects.toMatchObject({ code: 4100 });
    expect((await near!.signIn({ networkId: "testnet" }))[0]!.accountId).toBe(PUB);
    await near!.signAndSendTransaction({ receiverId: "x.testnet", actions: [{ type: "Transfer", params: { deposit: "1" } }] });
    expect(h.handled.at(-1)).toMatchObject({ family: "near", networkId: "near:testnet", method: "near_signAndSendTransaction" });

    expect(await stellar!.getAddress()).toEqual({ address: P2_ACCOUNTS.stellar![0]!.address });
    expect(await stellar!.getNetwork()).toEqual({ network: "TESTNET", networkPassphrase: "Test SDF Network ; September 2015" });
    expect((await stellar!.signTransaction("AAAA")).signedTxXdr).toBe("SIGNED");

    await algorand!.enable({ genesisID: "testnet-v1.0" });
    expect(await algorand!.signTxns([{ txn: "AA" }])).toEqual(["c2ln"]);
    expect(h.handled.at(-1)).toMatchObject({ family: "algorand", networkId: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe", method: "algo_signTxn" });

    expect(h.handled.map((r) => r.method)).toEqual([
      "near:connect",
      "near_signAndSendTransaction",
      "stellar:connect",
      "stellar_signXDR",
      "algorand:connect",
      "algo_signTxn",
    ]);
    om.destroy();
    await tick();
  });

  it("routes Beacon relay messages to the configured peer", async () => {
    const seen: unknown[] = [];
    const h = makeHarness({
      networks: P2_NETS,
      tezosBeacon: { receive: async (origin, message) => (seen.push({ origin, message }), { replies: [] }), result: async () => [] },
    });
    await h.router.dispatch("https://dapp.example", { family: "tezos", method: "tezos:beacon", params: { message: { payload: "x" } } });
    expect(seen).toEqual([{ origin: "https://dapp.example", message: { payload: "x" } }]);
    await expect(h.router.dispatch("https://dapp.example", { family: "tezos", method: "tezos_send", params: { operations: [] } })).rejects.toMatchObject({ code: 4100 });
  });
});
