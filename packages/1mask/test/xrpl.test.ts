import type { DappRequest, Family, Network } from "@clip-wallet/core";
import type { Wallet } from "@wallet-standard/base";
import { describe, expect, it } from "vitest";
import { createXrplDispatcher, type XrplRouterInternals } from "../src/background/xrpl.js";
import { ClipXrplWallet, XRPL_FEATURES, installXrpl, xrplChains } from "../src/inpage/xrpl.js";
import type { InpageTransport } from "../src/inpage/transport.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { ProviderRpcError } from "../src/shared/errors.js";
import { xrplAllowlist, xrplChainId } from "../src/shared/xrpl.js";

const asset = (id: string) => ({ key: "xrp", symbol: "XRP", name: "XRP", decimals: 6, networkId: id });
const net = (id: string, family: Family = "xrpl"): Network => ({ id, family, name: id, nativeAsset: asset(id), testnet: id !== "xrpl:0", rpcUrls: [], explorerUrl: "" });
const NETS = [net("xrpl:1"), net("xrpl:0"), net("solana:devnet", "solana")];
const ME = "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3";
const PUB = "031d68bc1a142e6766b2bdfb006ccfe135ef2e0e2e94abb5cf5c9ab6104776fbae";
const OTHER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const TX = { TransactionType: "Payment", Account: ME, Destination: OTHER, Amount: "1" };

/** Router stand-in: one connected origin with one account; records approvals. */
function internals(o: { permitted?: boolean } = {}) {
  let permitted = o.permitted ?? true;
  const approved: DappRequest[] = [];
  const r: XrplRouterInternals = {
    permitted: async () => permitted,
    requirePermission: async () => {
      if (!permitted) throw new ProviderRpcError(4100, "not connected");
    },
    accounts: async () => (permitted ? [{ address: ME, publicKey: PUB }] : []),
    connect: async () => {
      permitted = true;
      return [{ address: ME, publicKey: PUB }];
    },
    approve: async (req) => {
      approved.push(req);
      return req.method === "xrpl:signTransaction" ? { signed_tx_blob: "AB" } : { tx_hash: "H", tx_json: {} };
    },
    makeReq: (origin, family, n, method, params) => ({ id: "1", origin, via: "injected", family, networkId: n.id, method, params }),
    requireNetwork: (_f, _o, chain) => {
      const n = NETS.find((x) => x.family === "xrpl" && x.id === (chain ?? "xrpl:1"));
      if (!n) throw new ProviderRpcError(4901, "no such chain");
      return n;
    },
    revoke: async () => {
      permitted = false;
    },
  };
  return { r, approved };
}

describe("XLS-72d background dispatcher", () => {
  it("allowlists only the XLS-72d methods and maps network aliases", () => {
    expect([...xrplAllowlist()].sort()).toEqual(["1mask_getAccounts", "standard:connect", "standard:disconnect", "xrpl:signAndSubmitTransaction", "xrpl:signTransaction"].sort());
    expect(xrplChainId("xrpl:testnet")).toBe("xrpl:1");
    expect(xrplChainId("xrpl:21337")).toBe("xrpl:21337");
    expect(xrplChainId("eip155:1")).toBeUndefined();
  });

  it("connects, then approves a sign request with the network and signer checked", async () => {
    const { r, approved } = internals({ permitted: false });
    const d = createXrplDispatcher(r);
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: TX, account: ME, network: "xrpl:1" }, "xrpl:1")).rejects.toMatchObject({ code: 4100 });
    expect(await d.dispatch("https://dapp.example", "1mask_getAccounts", undefined, undefined)).toEqual([]);
    expect(await d.dispatch("https://dapp.example", "standard:connect", undefined, undefined)).toEqual([{ address: ME, publicKey: PUB }]);
    expect(await d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: TX, account: ME, network: "xrpl:testnet", options: { autofill: true } }, "xrpl:1")).toEqual({ signed_tx_blob: "AB" });
    expect(approved[0]).toMatchObject({ family: "xrpl", networkId: "xrpl:1", method: "xrpl:signTransaction", params: { tx_json: TX, account: ME, network: "xrpl:1", options: { autofill: true } } });
    await d.dispatch("https://dapp.example", "xrpl:signAndSubmitTransaction", { tx_json: TX, account: ME, network: "xrpl:0" }, "xrpl:0");
    expect(approved[1]).toMatchObject({ networkId: "xrpl:0", method: "xrpl:signAndSubmitTransaction" });
  });

  it("refuses other accounts, mixed networks, unknown networks and other methods", async () => {
    const { r, approved } = internals();
    const d = createXrplDispatcher(r);
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: TX, account: OTHER, network: "xrpl:1" }, undefined)).rejects.toMatchObject({ code: 4100 });
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: { ...TX, Account: OTHER }, account: ME }, undefined)).rejects.toMatchObject({ code: 4100 });
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: TX, account: ME, network: "xrpl:0" }, "xrpl:1")).rejects.toMatchObject({ code: -32602 });
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { tx_json: TX, account: ME, network: "xrpl:21337" }, undefined)).rejects.toMatchObject({ code: 4901 });
    await expect(d.dispatch("https://dapp.example", "xrpl:signTransaction", { account: ME }, undefined)).rejects.toMatchObject({ code: -32602 });
    await expect(d.dispatch("https://dapp.example", "xrpl:signMessage", {}, undefined)).rejects.toMatchObject({ code: 4200 });
    expect(approved).toEqual([]);
    expect(await d.dispatch("https://dapp.example", "standard:disconnect", undefined, undefined)).toBeNull();
  });
});

/** Transport stand-in that answers like the background would. */
function transport() {
  const sent: { family: Family; method: string; params?: unknown; chain?: string }[] = [];
  let listener: ((f: Family, e: string, d: unknown) => void) | undefined;
  const t: InpageTransport = {
    request: async (family, method, params, chain) => {
      sent.push({ family, method, params, chain });
      if (method === "standard:connect" || method === "1mask_getAccounts") return [{ address: ME, publicKey: PUB }];
      if (method === "xrpl:signTransaction") return { signed_tx_blob: "BLOB", extra: 1 };
      if (method === "xrpl:signAndSubmitTransaction") return { tx_hash: "HASH", tx_json: { validated: true } };
      return null;
    },
    onEvent: (l) => {
      listener = l as typeof listener;
      return () => (listener = undefined);
    },
  } as InpageTransport;
  return { t, sent, emit: (e: string, d: unknown) => listener?.("xrpl", e, d) };
}

describe("XLS-72d in-page wallet", () => {
  it("registers under the wallet's own identity with the XLS-72d features and chains", () => {
    const registered: Wallet[] = [];
    const win = {} as Window;
    const { t } = transport();
    const out = installXrpl(win, DEFAULT_IDENTITY, NETS, t, { register: (w) => void registered.push(w) })!;
    expect(registered).toEqual([out.wallet]);
    expect(out.wallet.name).toBe(DEFAULT_IDENTITY.name);
    expect(out.wallet.chains).toEqual(["xrpl:1", "xrpl:0"]);
    expect(Object.keys(out.wallet.features).sort()).toEqual([...XRPL_FEATURES].sort());
    expect((win as unknown as { clipwallet: { xrpl: unknown } }).clipwallet.xrpl).toBe(out.wallet);
    out.stop();
    expect(installXrpl({} as Window, DEFAULT_IDENTITY, [net("solana:devnet", "solana")], t, { register: () => {} })).toBeUndefined();
    expect(xrplChains(NETS)).toEqual(["xrpl:1", "xrpl:0"]);
  });

  it("connects, signs with the connected account and maps aliases to the CAIP-2 chain", async () => {
    const { t, sent } = transport();
    const w = new ClipXrplWallet({ ...DEFAULT_IDENTITY, name: "Kit Wallet" }, NETS, t);
    const { accounts } = await w.features["standard:connect"].connect();
    expect(accounts.map((a) => a.address)).toEqual([ME]);
    expect(w.name).toBe("Kit Wallet");
    const signed = await w.features["xrpl:signTransaction"].signTransaction({ tx_json: TX, account: accounts[0]!, network: "xrpl:testnet", options: { autofill: true } });
    expect(signed).toEqual({ signed_tx_blob: "BLOB" });
    expect(sent.at(-1)).toEqual({ family: "xrpl", method: "xrpl:signTransaction", params: { tx_json: TX, account: ME, network: "xrpl:1", options: { autofill: true } }, chain: "xrpl:1" });
    expect(await w.features["xrpl:signAndSubmitTransaction"].signAndSubmitTransaction({ tx_json: TX, account: accounts[0]!, network: "xrpl:0" })).toEqual({ tx_hash: "HASH", tx_json: { validated: true } });
  });

  it("refuses accounts that aren't connected and networks it doesn't have", async () => {
    const { t, emit } = transport();
    const w = new ClipXrplWallet(DEFAULT_IDENTITY, NETS, t);
    const stranger = { address: OTHER, publicKey: new Uint8Array(), chains: ["xrpl:1"], features: [] } as never;
    await expect(w.features["xrpl:signTransaction"].signTransaction({ tx_json: TX, account: stranger, network: "xrpl:1" })).rejects.toMatchObject({ code: 4100 });
    const { accounts } = await w.features["standard:connect"].connect();
    await expect(w.features["xrpl:signTransaction"].signTransaction({ tx_json: TX, account: accounts[0]!, network: "xrpl:21337" })).rejects.toMatchObject({ code: 4901 });
    await expect(w.features["xrpl:signTransaction"].signTransaction({ tx_json: TX, account: accounts[0]!, network: "xrpl:2" })).rejects.toMatchObject({ code: 4901 });
    const changes: unknown[] = [];
    w.features["standard:events"].on("change", (c) => changes.push(c));
    emit("disconnect", undefined);
    expect(w.accounts).toEqual([]);
    expect(changes).toHaveLength(1);
  });
});
