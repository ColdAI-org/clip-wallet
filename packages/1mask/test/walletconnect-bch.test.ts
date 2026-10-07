import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createWalletConnectWallet, mapProposalNamespaces, type WalletKitLike, type WcSessionLike } from "../src/walletconnect/index.js";
import { BTC_ADDR, NETWORKS, tick } from "./helpers.js";

/**
 * Bitcoin Cash over WalletConnect, wc2-bch-bcr (https://github.com/mainnet-pat/wc2-bch-bcr): namespace "bch", chains
 * "bch:bitcoincash" / "bch:bchtest" aliased to the wallet's bip122 BCH networks, session accounts "bch:<CashAddr>"
 * as Cashonize builds them. The public "abandon … about" BCH account 0, vault (mainnet) spelling.
 */
const BCH_MAIN = "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6";
const BCH_TEST = "bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x";
const CHIPNET = "bip122:00000000040ba9641ba98a37b2e5ceea";
const MAINNET = "bip122:000000000000000000651ef99cb9fcbe";
const BTC_TESTNET = "bip122:000000000933ea01ad0ee984209779ba";

const asset = (networkId: string) => ({ key: "bch", symbol: "BCH", name: "Bitcoin Cash", decimals: 8, networkId });
const BCH_NETS: Network[] = [
  { id: CHIPNET, family: "bitcoincash", name: "Bitcoin Cash Chipnet", nativeAsset: asset(CHIPNET), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: MAINNET, family: "bitcoincash", name: "Bitcoin Cash", nativeAsset: asset(MAINNET), testnet: false, rpcUrls: [], explorerUrl: "" },
];
const networks = [...NETWORKS, ...BCH_NETS];
const addressesFor = (_chain: string, family: Family): string[] => (family === "bitcoincash" ? [BCH_MAIN] : family === "bitcoin" ? [BTC_ADDR] : []);

const BCH_METHODS = ["bch_getAddresses", "bch_signTransaction", "bch_signMessage"];
const proposal = {
  requiredNamespaces: { bch: { chains: ["bch:bchtest"], methods: BCH_METHODS, events: ["addressesChanged"] } },
  optionalNamespaces: {
    bch: { chains: ["bch:bitcoincash", "bch:bchreg"], methods: BCH_METHODS, events: ["addressesChanged"] },
    bip122: { chains: [BTC_TESTNET], methods: ["signPsbt"], events: ["bip122_addressesChanged"] },
  },
};

describe("wc2-bch-bcr namespace mapping", () => {
  it("aliases bch:* chains to the BCH networks and spells session accounts per chain", () => {
    const m = mapProposalNamespaces(proposal, { networks, addressesFor });
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.namespaces.bch).toEqual({
      chains: ["bch:bchtest", "bch:bitcoincash"],
      accounts: [`bch:${BCH_TEST}`, `bch:${BCH_MAIN}`],
      methods: BCH_METHODS,
      events: ["addressesChanged"],
    });
    expect(m.unsupported.chains).toEqual(["bch:bchreg"]);
    // the Bitcoin bip122 namespace is untouched
    expect(m.namespaces.bip122).toEqual({ chains: [BTC_TESTNET], accounts: [`${BTC_TESTNET}:${BTC_ADDR}`], methods: ["signPsbt"], events: ["bip122_addressesChanged"] });
  });

  it("refuses bch chains the wallet doesn't have", () => {
    const m = mapProposalNamespaces(proposal, { networks: NETWORKS, addressesFor });
    expect(m).toMatchObject({ ok: false, reason: "UNSUPPORTED_CHAINS", unsupported: { chains: ["bch:bchtest"] } });
  });
});

function fakeKit() {
  const handlers = new Map<string, (a: any) => void>();
  const sessions: Record<string, WcSessionLike> = {};
  const calls: { name: string; args: any }[] = [];
  const rec = (name: string) => async (args: any) => void calls.push({ name, args });
  const kit: WalletKitLike = {
    pair: rec("pair"),
    approveSession: async (args) => (calls.push({ name: "approveSession", args }), { topic: "t1" }),
    rejectSession: rec("rejectSession"),
    respondSessionRequest: rec("respondSessionRequest"),
    disconnectSession: rec("disconnectSession"),
    getActiveSessions: () => sessions,
    emitSessionEvent: rec("emitSessionEvent"),
    updateSession: rec("updateSession"),
    approveSessionAuthenticate: rec("approveSessionAuthenticate"),
    rejectSessionAuthenticate: rec("rejectSessionAuthenticate"),
    formatAuthMessage: () => "",
    on: (e, l) => void handlers.set(e, l),
    off: (e) => void handlers.delete(e),
  };
  return { kit, sessions, calls, fire: async (e: string, a: any) => (handlers.get(e)!(a), tick(5)) };
}

const peer = { name: "TapSwap", description: "", url: "https://tapswap.example", icons: [] };

describe("wc2-bch-bcr sessions (fake WalletKit)", () => {
  async function setup() {
    const f = fakeKit();
    const handled: DappRequest[] = [];
    const summaries: { approvedChains: string[]; networks?: unknown }[] = [];
    const w = await createWalletConnectWallet({
      projectId: "test",
      metadata: { name: "Clip Wallet", description: "", url: "https://clip.example", icons: [] },
      networks,
      addressesFor,
      approveProposal: async (s) => (summaries.push(s as never), true),
      handle: async (req) => (handled.push(req), { signedTransaction: "02", signedTransactionHash: "ab" }),
      walletKitFactory: async () => f.kit,
    });
    await f.fire("session_proposal", { id: 3, params: { id: 3, proposer: { metadata: peer }, ...proposal } });
    const approved = f.calls.find((c) => c.name === "approveSession")!.args.namespaces;
    f.sessions.t1 = { topic: "t1", expiry: 0, peer: { metadata: peer }, namespaces: approved };
    return { w, f, handled, summaries, approved };
  }

  it("approves the session with bch accounts and names the networks on the connect screen", async () => {
    const { approved, summaries } = await setup();
    expect(approved.bch.accounts).toEqual([`bch:${BCH_TEST}`, `bch:${BCH_MAIN}`]);
    expect(summaries[0]!.approvedChains).toContain("bch:bchtest");
  });

  it("answers bch_getAddresses locally and forwards signing to chains-bitcoincash on the aliased network", async () => {
    const { f, handled } = await setup();
    await f.fire("session_request", { id: 10, topic: "t1", params: { chainId: "bch:bchtest", request: { method: "bch_getAddresses", params: {} } } });
    expect(f.calls.at(-1)).toMatchObject({ name: "respondSessionRequest", args: { response: { id: 10, result: [BCH_TEST] } } });
    expect(handled).toHaveLength(0);

    await f.fire("session_request", { id: 11, topic: "t1", params: { chainId: "bch:bchtest", request: { method: "bch_signTransaction", params: { transaction: "00" } } } });
    expect(handled[0]).toMatchObject({ family: "bitcoincash", networkId: CHIPNET, method: "bch_signTransaction", via: "walletconnect", origin: "https://tapswap.example.unverified.invalid" });
    expect(f.calls.at(-1)).toMatchObject({ args: { response: { id: 11, result: { signedTransaction: "02" } } } });

    await f.fire("session_request", { id: 12, topic: "t1", params: { chainId: "bch:bitcoincash", request: { method: "bch_signMessage", params: { message: "hi" } } } });
    expect(handled[1]).toMatchObject({ family: "bitcoincash", networkId: MAINNET });

    await f.fire("session_request", { id: 13, topic: "t1", params: { chainId: BTC_TESTNET, request: { method: "signPsbt", params: {} } } });
    expect(handled[2]).toMatchObject({ family: "bitcoin", networkId: BTC_TESTNET, method: "signPsbt" });
  });

  it("refuses a bch chain outside the session", async () => {
    const { f } = await setup();
    await f.fire("session_request", { id: 20, topic: "t1", params: { chainId: "bch:bchreg", request: { method: "bch_getAddresses", params: {} } } });
    expect(f.calls.at(-1)).toMatchObject({ args: { response: { id: 20, error: { code: 5100 } } } });
  });

  it("notifyAccountsChanged updates the session and emits addressesChanged with CashAddrs", async () => {
    const { w, f } = await setup();
    await w.notifyAccountsChanged();
    const upd = f.calls.find((c) => c.name === "updateSession")!;
    expect(upd.args.namespaces.bch.accounts).toEqual([`bch:${BCH_TEST}`, `bch:${BCH_MAIN}`]);
    const ev = f.calls.filter((c) => c.name === "emitSessionEvent").map((c) => c.args);
    expect(ev).toContainEqual({ topic: "t1", event: { name: "addressesChanged", data: [BCH_TEST] }, chainId: "bch:bchtest" });
    expect(ev).toContainEqual({ topic: "t1", event: { name: "addressesChanged", data: [BCH_MAIN] }, chainId: "bch:bitcoincash" });
    expect(ev).toContainEqual({ topic: "t1", event: { name: "bip122_addressesChanged", data: [`${BTC_TESTNET}:${BTC_ADDR}`] }, chainId: BTC_TESTNET });
  });
});
