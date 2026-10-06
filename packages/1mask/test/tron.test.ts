import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createMemoryPermissionStore } from "../src/background/index.js";
import { createTronDispatcher, tronInjectedAllowlist } from "../src/background/tron.js";
import { type TIP6963ProviderDetail, installTronProvider } from "../src/inpage/tron.js";
import type { EventListener, InpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ProviderRpcError } from "../src/shared/errors.js";
import type { ExposedAccount, OneMaskEvent } from "../src/shared/protocol.js";
import { TRON_INJECTED, tronChainIdOf, tronNetworkIdOf } from "../src/shared/tron-methods.js";
import { newWindow } from "./helpers.js";

const asset = (networkId: string) => ({ key: "trx", symbol: "TRX", name: "TRON", decimals: 6, networkId });
const net = (id: string, name: string, rpc: string): Network => ({ id, family: "tron", name, nativeAsset: asset(id), testnet: true, rpcUrls: [rpc], explorerUrl: "https://nile.tronscan.org" });
const NILE = net("tron:0xcd8690dc", "TRON Nile Testnet", "https://nile.trongrid.io");
const MAINNET = { ...net("tron:0x2b6653dc", "TRON", "https://api.trongrid.io"), testnet: false };
const NETWORKS: Network[] = [NILE, MAINNET];
const ME = "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH";
const PUB = "03ff21f8e64d3a3c0198edfbb7afdc79be959432e92e2f8a1984bb436a414b8edc";
const ORIGIN = "https://dapp.example";

/** Router stand-in lending the same closures createOneMaskRouter lends the dispatchers. */
function harness(handleImpl: (r: DappRequest) => unknown = () => ({ ok: true })) {
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const listeners = new Set<EventListener>();
  const accounts: ExposedAccount[] = [{ address: ME, publicKey: PUB }];
  const emit = (family: Family, event: OneMaskEvent, data?: unknown) => listeners.forEach((l) => l(family, event, data));
  const requireNetwork = (_f: Family, _o: string, chain: string | undefined) => {
    if (chain === undefined) return NILE;
    const n = NETWORKS.find((x) => x.id === chain);
    if (!n) throw new ProviderRpcError(4901, "Not connected to that network.");
    return n;
  };
  const d = createTronDispatcher({
    permitted: async (o, f) => !!(await permissions.has(o, f)),
    requirePermission: async (o, f) => {
      if (!(await permissions.has(o, f))) throw new ProviderRpcError(4100, "Connect first.");
    },
    accounts: async () => accounts,
    approve: async (req) => {
      handled.push(req);
      return handleImpl(req);
    },
    connect: async (o, f, n, method, params) => {
      handled.push({ id: "c", origin: o, via: "injected", family: f, networkId: n.id, method, params });
      await permissions.grant(o, f);
      emit(f, "accountsChanged", accounts);
      return accounts;
    },
    makeReq: (o, f, n, method, params) => ({ id: String(handled.length), origin: o, via: "injected", family: f, networkId: n.id, method, params }),
    requireNetwork,
    revoke: async (o, f) => {
      await permissions.revoke(o, f);
      emit(f, "accountsChanged", []);
      emit(f, "disconnect");
    },
  });
  const transport: InpageTransport & { calls: { method: string; params: unknown; chain?: string }[] } = {
    calls: [],
    async request(family, method, params, chain) {
      transport.calls.push({ method, params, ...(chain !== undefined ? { chain } : {}) });
      expect(family).toBe("tron");
      // The page→background hop is JSON (ports serialise).
      return JSON.parse(JSON.stringify((await d.dispatch(ORIGIN, method, params === undefined ? undefined : JSON.parse(JSON.stringify(params)), chain)) ?? null));
    },
    onEvent(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    destroy() {},
  };
  return { d, handled, permissions, transport };
}

describe("TRON background dispatcher", () => {
  it("allows only the TRON wire methods", async () => {
    expect([...tronInjectedAllowlist()].sort()).toEqual([TRON_INJECTED.accounts, TRON_INJECTED.connect, TRON_INJECTED.disconnect, "tron_signMessage", "tron_signTransaction"].sort());
    const { d } = harness();
    await expect(d.dispatch(ORIGIN, "tron_sendRawTransaction", {}, undefined)).rejects.toMatchObject({ code: 4200 });
    await expect(d.dispatch(ORIGIN, "tron_signAndSendTransaction", {}, undefined)).rejects.toMatchObject({ code: 4200 });
  });

  it("reads accounts silently, connects through an approval, signs only for connected accounts", async () => {
    const { d, handled } = harness();
    expect(await d.dispatch(ORIGIN, TRON_INJECTED.accounts, undefined, undefined)).toEqual([]);
    await expect(d.dispatch(ORIGIN, "tron_signMessage", { address: ME, message: "hi" }, NILE.id)).rejects.toMatchObject({ code: 4100 });
    expect(await d.dispatch(ORIGIN, TRON_INJECTED.connect, {}, NILE.id)).toEqual([{ address: ME, publicKey: PUB }]);
    expect(handled.map((h) => [h.method, h.networkId])).toEqual([[TRON_INJECTED.connect, NILE.id]]);
    await expect(d.dispatch(ORIGIN, "tron_signMessage", { address: "TSeJkUh4Qv67VNFwY8LaAxERygNdy6NQZK", message: "hi" }, NILE.id)).rejects.toMatchObject({ code: 4100 });
    await expect(d.dispatch(ORIGIN, "tron_signTransaction", { address: ME }, NILE.id)).rejects.toMatchObject({ code: -32602 });
    await expect(d.dispatch(ORIGIN, "tron_signMessage", { address: ME, message: "hi" }, "tron:0x94a9059e")).rejects.toMatchObject({ code: 4901 });
    await d.dispatch(ORIGIN, "tron_signTransaction", { address: ME, transaction: { raw_data_hex: "0a00" } }, MAINNET.id);
    expect(handled.at(-1)).toMatchObject({ family: "tron", networkId: MAINNET.id, method: "tron_signTransaction", origin: ORIGIN });
    expect(await d.dispatch(ORIGIN, TRON_INJECTED.disconnect, undefined, undefined)).toBeNull();
    expect(await d.dispatch(ORIGIN, TRON_INJECTED.accounts, undefined, undefined)).toEqual([]);
  });
});

describe("TRON injected provider (TIP-1193 + TIP-6963)", () => {
  const install = (handleImpl?: (r: DappRequest) => unknown, opts = {}) => {
    const win = newWindow();
    const h = harness(handleImpl);
    const seen: TIP6963ProviderDetail[] = [];
    win.addEventListener("TIP6963:announceProvider", (e) => seen.push((e as CustomEvent<TIP6963ProviderDetail>).detail));
    const identity = resolveIdentity({});
    const r = installTronProvider(win, identity, NETWORKS, h.transport, opts);
    return { win, h, seen, r, identity };
  };

  it("announces its own identity (TIP-6963) and stays off other wallets' globals", () => {
    const { win, seen, r, identity } = install();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.info).toMatchObject({ name: identity.name, icon: identity.icon, rdns: identity.rdns });
    expect(seen[0]!.info.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(seen[0]!.provider).toBe(r.provider);
    win.dispatchEvent(new Event("TIP6963:requestProvider"));
    expect(seen).toHaveLength(2);
    expect(seen[1]!.info.uuid).toBe(seen[0]!.info.uuid);
    const w = win as unknown as Record<string, unknown>;
    expect((w.clipwallet as Record<string, unknown>).tron).toBe(r.provider);
    expect(w.tron).toBeUndefined();
    expect(w.tronWeb).toBeUndefined();
    expect(w.tronLink).toBeUndefined();
    expect((r.provider as unknown as Record<string, unknown>).isTronLink).toBeUndefined();
    r.stop();
    win.dispatchEvent(new Event("TIP6963:requestProvider"));
    expect(seen).toHaveLength(2);
  });

  it("claims window.tron only when asked and nothing owns it", () => {
    const a = install(undefined, { claimWindowTron: true });
    expect((a.win as unknown as { tron?: unknown }).tron).toBe(a.r.provider);
    const win = newWindow();
    const other = { isTronLink: true };
    (win as unknown as { tron: unknown }).tron = other;
    const r = installTronProvider(win, resolveIdentity({}), NETWORKS, harness().transport, { claimWindowTron: true });
    expect(r.claimedWindowTron).toBe(false);
    expect((win as unknown as { tron: unknown }).tron).toBe(other);
  });

  it("eth_requestAccounts, eth_chainId, wallet_switchEthereumChain and the events", async () => {
    const { r, h } = install();
    const p = r.provider;
    const events: [string, unknown][] = [];
    for (const e of ["connect", "accountsChanged", "chainChanged", "disconnect"]) expect(p.on(e, (x: unknown) => events.push([e, x]))).toBe(p);
    expect(await p.request({ method: "eth_chainId" })).toBe("0xcd8690dc");
    expect(await p.request({ method: "eth_requestAccounts" })).toEqual([ME]);
    expect(h.transport.calls.map((c) => [c.method, c.chain])).toEqual([
      [TRON_INJECTED.accounts, NILE.id],
      [TRON_INJECTED.connect, NILE.id],
    ]);
    expect(events).toEqual([
      ["accountsChanged", [ME]],
      ["connect", { chainId: "0xcd8690dc" }],
    ]);
    expect(await p.request({ method: "eth_requestAccounts" })).toEqual([ME]); // already connected: no second prompt
    expect(h.handled.filter((x) => x.method === TRON_INJECTED.connect)).toHaveLength(1);

    expect(await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2b6653dc" }] })).toBeNull();
    expect(events.at(-1)).toEqual(["chainChanged", { chainId: "0x2b6653dc" }]);
    expect(await p.request({ method: "eth_chainId" })).toBe("0x2b6653dc");
    await expect(p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x94a9059e" }] })).rejects.toMatchObject({ code: 4902 });
    await expect(p.request({ method: "wallet_switchEthereumChain", params: [{}] })).rejects.toMatchObject({ code: -32602 });
    await expect(p.request({ method: "tron_requestAccounts" })).rejects.toMatchObject({ code: 4200 });
    await expect(p.request({ method: "eth_sign", params: [] })).rejects.toMatchObject({ code: 4200 });

    await p.disconnect();
    expect(events.slice(-2)).toEqual([
      ["accountsChanged", []],
      ["disconnect", expect.objectContaining({ code: 4900 })],
    ]);
  });

  it("signs through the TronWeb subset on the current chain", async () => {
    const { r, h } = install((req) => (req.method === "tron_signMessage" ? { signature: "0xabc" } : { ...(req.params as { transaction: object }).transaction, signature: ["11"] }));
    const tw = r.provider.tronWeb;
    expect(tw.ready).toBe(false);
    expect(tw.defaultAddress).toEqual({ base58: false, hex: false });
    await expect(tw.trx.sign({ raw_data_hex: "0a00" })).rejects.toMatchObject({ code: 4100 });
    await r.provider.request({ method: "eth_requestAccounts" });
    expect(tw.ready).toBe(true);
    expect(tw.defaultAddress).toEqual({ base58: ME, hex: "41c8599111f29c1e1e061265b4af93ea1f274ad78a" });
    expect(tw.fullNode.host).toBe("https://nile.trongrid.io");

    expect(await tw.trx.sign({ txID: "aa", raw_data_hex: "0a00" })).toEqual({ txID: "aa", raw_data_hex: "0a00", signature: ["11"] });
    expect(h.handled.at(-1)).toMatchObject({ method: "tron_signTransaction", networkId: NILE.id, params: { address: ME, transaction: { txID: "aa", raw_data_hex: "0a00" } } });
    expect(await tw.trx.signMessageV2("hello")).toBe("0xabc");
    expect(h.handled.at(-1)).toMatchObject({ method: "tron_signMessage", params: { address: ME, message: "hello" } });
    await tw.trx.signMessageV2(new Uint8Array([0, 255]));
    expect(h.handled.at(-1)?.params).toEqual({ address: ME, message: "00ff", encoding: "hex" });

    await expect(tw.trx.sign("deadbeef")).rejects.toMatchObject({ code: 4200 });
    await expect(tw.trx.sign({ raw_data_hex: "0a00" }, "a".repeat(64))).rejects.toMatchObject({ code: -32602 });
    await expect(tw.trx.multiSign()).rejects.toMatchObject({ code: 4200 });
    await expect(tw.trx._signTypedData()).rejects.toMatchObject({ code: 4200 });
    await r.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2b6653dc" }] });
    await tw.trx.signMessageV2("on mainnet");
    expect(h.handled.at(-1)?.networkId).toBe(MAINNET.id);
  });

  it("maps chain ids both ways", () => {
    expect(tronNetworkIdOf("0x2B6653DC")).toBe("tron:0x2b6653dc");
    expect(tronNetworkIdOf("728126428")).toBe("tron:0x2b6653dc");
    expect(tronNetworkIdOf("tron")).toBeNull();
    expect(tronChainIdOf("tron:0xcd8690dc")).toBe("0xcd8690dc");
    expect(tronChainIdOf("eip155:1")).toBeNull();
  });
});
