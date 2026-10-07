import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createFuelDispatcher, fuelInjectedAllowlist, type FuelRouterInternals } from "../src/background/fuel.js";
import { ClipFuelConnector, FUEL_CONNECTOR_EVENT, fuelWireMessage, installFuelConnector } from "../src/inpage/fuel.js";
import type { InpageTransport } from "../src/inpage/transport.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { ProviderRpcError, RpcErrorCode } from "../src/shared/errors.js";
import { FUEL_INJECTED } from "../src/shared/fuel.js";
import type { ExposedAccount, OneMaskEvent } from "../src/shared/protocol.js";

const asset = (networkId: string) => ({ key: "eth", symbol: "ETH", name: "Ether", decimals: 9, networkId });
const net = (id: string, url: string): Network => ({ id, family: "fuel", name: id, nativeAsset: asset(id), testnet: id === "fuel:0", rpcUrls: [url], explorerUrl: "" });
const TESTNET = net("fuel:0", "https://testnet.fuel.network/v1/graphql");
const MAINNET = net("fuel:9889", "https://mainnet.fuel.network/v1/graphql");
const ME: ExposedAccount = { address: "0x806EC69A1bC1398877A7327c467EE09511B3f26DcfB55b305D8ea2cd2c285b89", publicKey: "026760754232b8ae531b05039f630cf2549027d47dfe6af603f7504616602dfcd2" };
const ORIGIN = "https://app.example";

/** A router stand-in: one origin, one permission flag, approvals recorded. */
function fakeRouter(opts: { permitted?: boolean; reject?: boolean } = {}) {
  let permitted = opts.permitted ?? false;
  const selected = new Map<string, string>();
  const approved: DappRequest[] = [];
  const events: { event: OneMaskEvent; data: unknown }[] = [];
  const h: FuelRouterInternals = {
    permitted: async () => permitted,
    accounts: async () => (permitted ? [ME] : []),
    connect: async () => {
      if (opts.reject) throw new ProviderRpcError(RpcErrorCode.UserRejected, "The user rejected the request.");
      permitted = true;
      return [ME];
    },
    approve: async (r) => (approved.push(r), r.method === FUEL_INJECTED.sendTransaction ? "0xabc" : r.method === FUEL_INJECTED.signMessage ? "0xsig" : { signed: true }),
    makeReq: (origin, family, n, method, params) => ({ id: "x", origin, via: "injected", family, networkId: n.id, method, params }),
    selectedNetwork: (origin) => [TESTNET, MAINNET].find((n) => n.id === selected.get(origin)) ?? TESTNET,
    setSelected: (origin, _f, id) => void selected.set(origin, id),
    candidates: (f: Family) => (f === "fuel" ? [TESTNET, MAINNET] : []),
    emit: (_o, _f, event, data) => void events.push({ event, data }),
    revoke: async () => void (permitted = false),
  };
  return { h, approved, events, dispatcher: createFuelDispatcher(h) };
}

/** Page ↔ background without the content script: requests go straight to the dispatcher. */
function directTransport(r: ReturnType<typeof fakeRouter>) {
  const listeners = new Set<(f: Family, e: OneMaskEvent, d: unknown) => void>();
  const sent: { method: string; params: unknown }[] = [];
  const t: InpageTransport & { push(e: OneMaskEvent, d: unknown): void; sent: typeof sent } = {
    request: async (family, method, params) => {
      expect(family).toBe("fuel");
      sent.push({ method, params });
      // Round-trip through JSON like the real transport (postMessage + runtime port).
      const p = params === undefined ? undefined : JSON.parse(JSON.stringify(params));
      return JSON.parse(JSON.stringify((await r.dispatcher.dispatch(ORIGIN, method, p)) ?? null));
    },
    onEvent: (l) => (listeners.add(l), () => listeners.delete(l)),
    destroy: () => listeners.clear(),
    push: (e, d) => listeners.forEach((l) => l("fuel", e, d)),
    sent,
  };
  return t;
}

describe("Fuel dispatcher (background)", () => {
  it("allowlists the connector's methods only", () => {
    expect([...fuelInjectedAllowlist()].sort()).toEqual(
      ["1mask_getAccounts", "fuel:connect", "fuel:currentNetwork", "fuel:disconnect", "fuel:networks", "fuel:selectNetwork", "fuel_sendTransaction", "fuel_signMessage", "fuel_signTransaction"].sort(),
    );
  });

  it("reads accounts silently, connects once, and refuses signing before connect", async () => {
    const r = fakeRouter();
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.accounts, undefined)).toEqual([]);
    await expect(r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.signMessage, { address: ME.address, message: { text: "hi" } })).rejects.toMatchObject({ code: 4100 });
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.connect, {})).toEqual([ME]);
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.accounts, undefined)).toEqual([ME]);
    expect(r.approved).toEqual([]);
  });

  it("sends signing requests for the connected account to approval, on the site's network", async () => {
    const r = fakeRouter({ permitted: true });
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.sendTransaction, { address: ME.address.toLowerCase(), transaction: { type: 0 } })).toBe("0xabc");
    expect(r.approved[0]).toMatchObject({ family: "fuel", networkId: "fuel:0", method: "fuel_sendTransaction", origin: ORIGIN });
    await expect(r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.signTransaction, { address: `0x${"11".repeat(32)}`, transaction: { type: 0 } })).rejects.toMatchObject({ code: 4100 });
    await expect(r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.signMessage, { address: ME.address })).rejects.toMatchObject({ code: -32602 });
    await expect(r.dispatcher.dispatch(ORIGIN, "fuel_signTypedData", {})).rejects.toMatchObject({ code: 4200 });
  });

  it("lists and switches only the wallet's networks, telling the page", async () => {
    const r = fakeRouter();
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.currentNetwork, undefined)).toEqual({ url: TESTNET.rpcUrls[0], chainId: 0 });
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.networks, undefined)).toEqual([
      { url: TESTNET.rpcUrls[0], chainId: 0 },
      { url: MAINNET.rpcUrls[0], chainId: 9889 },
    ]);
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.selectNetwork, { chainId: 9889 })).toBe(true);
    expect(r.events).toEqual([{ event: "chainChanged", data: { url: MAINNET.rpcUrls[0], chainId: 9889 } }]);
    expect(await r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.selectNetwork, { url: "https://mainnet.fuel.network/v1/graphql/" })).toBe(true);
    expect(r.events).toHaveLength(1);
    await expect(r.dispatcher.dispatch(ORIGIN, FUEL_INJECTED.selectNetwork, { chainId: 1119889111 })).rejects.toMatchObject({ code: 4902 });
  });
});

describe("Fuel connector (inpage)", () => {
  it("announces itself with the FuelConnector event under the wallet's own identity", () => {
    const seen: unknown[] = [];
    const onAnnounce = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(FUEL_CONNECTOR_EVENT, onAnnounce);
    const identity = { ...DEFAULT_IDENTITY, name: "Kit Wallet", rdns: "com.example.kit" };
    const { connector, announce, stop } = installFuelConnector(window, identity, directTransport(fakeRouter()), { reannounce: false });
    expect(seen).toEqual([connector]);
    expect(connector.name).toBe("Kit Wallet");
    expect(connector.name).not.toMatch(/fuel wallet/i);
    expect(connector.metadata.image).toBe(identity.icon);
    expect((window as unknown as { clipwallet: { fuel: unknown } }).clipwallet.fuel).toBe(connector);
    announce();
    expect(seen).toHaveLength(2);
    // Fuel writes these on the connector, so it must stay writable.
    connector.installed = true;
    (connector as unknown as { _latestUpdate: number })._latestUpdate = 1;
    stop();
    window.removeEventListener(FUEL_CONNECTOR_EVENT, onAnnounce);
  });

  it("connects, follows account and network events, and disconnects", async () => {
    const r = fakeRouter();
    const t = directTransport(r);
    const c = new ClipFuelConnector(DEFAULT_IDENTITY, t);
    const log: [string, unknown][] = [];
    for (const e of ["accounts", "currentAccount", "connection", "currentNetwork"]) c.on(e, (d: unknown) => log.push([e, d]));
    expect(await c.ping()).toBe(true);
    expect(await c.isConnected()).toBe(false);
    expect(await c.connect()).toBe(true);
    expect(await c.accounts()).toEqual([ME.address]);
    expect(await c.currentAccount()).toBe(ME.address);
    expect(log).toEqual([
      ["accounts", [ME.address]],
      ["currentAccount", ME.address],
      ["connection", true],
    ]);
    t.push("chainChanged", { url: MAINNET.rpcUrls[0], chainId: 9889 });
    expect(log.at(-1)).toEqual(["currentNetwork", { url: MAINNET.rpcUrls[0], chainId: 9889 }]);
    expect(await c.disconnect()).toBe(false);
    expect(log.slice(-3)).toEqual([
      ["accounts", []],
      ["currentAccount", null],
      ["connection", false],
    ]);
    expect(await c.isConnected()).toBe(false);
  });

  it("answers false when the person declines to connect", async () => {
    const c = new ClipFuelConnector(DEFAULT_IDENTITY, directTransport(fakeRouter({ reject: true })));
    expect(await c.connect()).toBe(false);
  });

  it("sends messages and transactions as plain JSON", async () => {
    const r = fakeRouter({ permitted: true });
    const t = directTransport(r);
    const c = new ClipFuelConnector(DEFAULT_IDENTITY, t);
    expect(await c.signMessage(ME.address, "hello")).toBe("0xsig");
    await c.signMessage(ME.address, { personalSign: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) });
    expect(r.approved.map((a) => (a.params as { message: unknown }).message)).toEqual([{ text: "hello" }, { personalSignHex: "0xdeadbeef" }]);

    // A fuels-ts-like request instance: BN fields serialize through toJSON, functions and prototypes don't cross.
    class Bn {
      constructor(private v: number) {}
      toJSON() {
        return `0x${this.v.toString(16)}`;
      }
    }
    class Req {
      type = 0;
      gasLimit = new Bn(64);
      maxFee = new Bn(168);
      inputs = [];
      outputs = [];
      witnesses = [];
      helper() {
        return 1;
      }
    }
    const id = await c.sendTransaction(ME.address, new Req(), {
      provider: { url: TESTNET.rpcUrls[0]! },
      onBeforeSend: async (x) => Object.assign(x as object, { tip: new Bn(1) }),
    });
    expect(id).toBe("0xabc");
    expect(r.approved.at(-1)!.params).toEqual({
      address: ME.address,
      transaction: { type: 0, gasLimit: "0x40", maxFee: "0xa8", inputs: [], outputs: [], witnesses: [], tip: "0x1" },
      provider: { url: TESTNET.rpcUrls[0] },
    });
    expect(await c.signTransaction(ME.address, { type: 0 })).toEqual({ signed: true });
    expect(r.approved.at(-1)!.method).toBe("fuel_signTransaction");
  });

  it("checks message shapes in the page and doesn't let sites add networks or assets", async () => {
    expect(fuelWireMessage({ personalSign: "hi" })).toEqual({ personalSign: "hi" });
    expect(() => fuelWireMessage("  ")).toThrow();
    expect(() => fuelWireMessage({ nope: 1 })).toThrow();
    const c = new ClipFuelConnector(DEFAULT_IDENTITY, directTransport(fakeRouter()));
    await expect(c.addNetwork("https://evil.example/v1/graphql")).rejects.toMatchObject({ code: 4001 });
    expect(await c.addAssets([{}])).toBe(false);
    expect(await c.assets()).toEqual([]);
    expect(await c.hasABI("0x00")).toBe(false);
    expect(await c.selectNetwork({ chainId: 9889 })).toBe(true);
    expect(await c.currentNetwork()).toEqual({ url: MAINNET.rpcUrls[0], chainId: 9889 });
  });
});
