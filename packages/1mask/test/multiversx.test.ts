import type { DappRequest, Family, Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createMemoryPermissionStore } from "../src/background/index.js";
import { MULTIVERSX_CONNECT_METHODS, createMultiversXDispatcher, multiversxInjectedAllowlist } from "../src/background/multiversx.js";
import { type MultiversXProviderEntry, installMultiversXProvider } from "../src/inpage/multiversx.js";
import type { EventListener, InpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ProviderRpcError } from "../src/shared/errors.js";
import { MULTIVERSX_INJECTED, multiversxNetworkIdOf, nativeAuthOrigin } from "../src/shared/multiversx-methods.js";
import type { ExposedAccount, OneMaskEvent } from "../src/shared/protocol.js";
import { newWindow } from "./helpers.js";

const asset = (networkId: string) => ({ key: "egld", symbol: "EGLD", name: "MultiversX eGold", decimals: 18, networkId });
const net = (id: string, name: string): Network => ({ id, family: "multiversx", name, nativeAsset: asset(id), testnet: id !== "mvx:1", rpcUrls: ["https://devnet-gateway.multiversx.com"], explorerUrl: "https://devnet-explorer.multiversx.com" });
const DEVNET = net("mvx:D", "MultiversX Devnet");
const MAINNET = net("mvx:1", "MultiversX");
const NETWORKS: Network[] = [DEVNET, MAINNET];
const ME = "erd1sqhjrtmsn5yjk6w85099p8v0ly0g8z9pxeqe5dvu5rlf2n7vq3vqytny9g";
const BOB = "erd1sxmr0k8u6trd5c6eu6trzyapzux7090ykujmsng7pdx0m8k93n5s48kwzk";
const ORIGIN = "https://dapp.example";
const SIG = "ab".repeat(64);

const b64url = (t: string) => btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const loginToken = (origin: string) => `${b64url(origin)}.${"cd".repeat(32)}.86400.${b64url("{}")}`;

/** Router stand-in lending the same closures createOneMaskRouter lends the dispatchers. */
function harness(handleImpl: (r: DappRequest) => unknown = () => ({ signature: SIG })) {
  const permissions = createMemoryPermissionStore();
  const handled: DappRequest[] = [];
  const listeners = new Set<EventListener>();
  const accounts: ExposedAccount[] = [{ address: ME, publicKey: "80".repeat(32) }];
  const emit = (family: Family, event: OneMaskEvent, data?: unknown) => listeners.forEach((l) => l(family, event, data));
  const d = createMultiversXDispatcher({
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
    requireNetwork: (_f, _o, chain) => {
      if (chain === undefined) return DEVNET;
      const n = NETWORKS.find((x) => x.id === chain);
      if (!n) throw new ProviderRpcError(4901, "Not connected to that network.");
      return n;
    },
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
      expect(family).toBe("multiversx");
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

/** A stand-in for an sdk-core Transaction (the provider only uses toPlainObject() and `signature`). */
class FakeTransaction {
  signature = new Uint8Array();
  guardianSignature = new Uint8Array([9]);
  constructor(readonly plain: Record<string, unknown>) {}
  toPlainObject() {
    return { ...this.plain };
  }
}
const plainTx = (over: Record<string, unknown> = {}) => ({ nonce: 7, value: "1000000000000000000", receiver: BOB, sender: ME, gasPrice: 1000000000, gasLimit: 50000, chainID: "D", version: 2, ...over });

describe("MultiversX background dispatcher", () => {
  it("allows only the MultiversX wire methods", async () => {
    expect([...multiversxInjectedAllowlist()].sort()).toEqual([MULTIVERSX_INJECTED.accounts, MULTIVERSX_INJECTED.connect, MULTIVERSX_INJECTED.disconnect, "mvx_signMessage", "mvx_signTransactions"].sort());
    expect(MULTIVERSX_CONNECT_METHODS).toEqual(["mvx:connect"]);
    const { d } = harness();
    await expect(d.dispatch(ORIGIN, "mvx_signAndSendTransactions", {}, undefined)).rejects.toMatchObject({ code: 4200 });
  });

  it("needs a connection before signing; accounts are silent and empty until then", async () => {
    const { d, handled } = harness();
    expect(await d.dispatch(ORIGIN, MULTIVERSX_INJECTED.accounts, undefined, undefined)).toEqual([]);
    await expect(d.dispatch(ORIGIN, "mvx_signMessage", { message: "hi", address: ME }, "mvx:D")).rejects.toMatchObject({ code: 4100 });
    expect(handled).toHaveLength(0);
  });

  it("checks that every signer is this site's account", async () => {
    const { d, handled } = harness();
    await d.dispatch(ORIGIN, MULTIVERSX_INJECTED.connect, {}, "mvx:D");
    await expect(d.dispatch(ORIGIN, "mvx_signMessage", { message: "hi", address: BOB }, "mvx:D")).rejects.toMatchObject({ code: 4100 });
    await expect(d.dispatch(ORIGIN, "mvx_signTransactions", { transactions: [plainTx({ sender: BOB })] }, "mvx:D")).rejects.toMatchObject({ code: 4100 });
    await expect(d.dispatch(ORIGIN, "mvx_signTransactions", { transactions: [] }, "mvx:D")).rejects.toMatchObject({ code: -32602 });
    await expect(d.dispatch(ORIGIN, "mvx_signTransactions", { transactions: [plainTx()] }, "mvx:Z")).rejects.toMatchObject({ code: 4901 });
    expect(handled.map((h) => h.method)).toEqual(["mvx:connect"]);
    await d.dispatch(ORIGIN, "mvx_signTransactions", { transactions: [plainTx()], address: ME }, "mvx:D");
    expect(handled.at(-1)).toMatchObject({ method: "mvx_signTransactions", networkId: "mvx:D", family: "multiversx" });
  });

  it("refuses a native-auth login token made for another site", async () => {
    const { d, handled } = harness();
    await d.dispatch(ORIGIN, MULTIVERSX_INJECTED.connect, {}, undefined);
    expect(nativeAuthOrigin(loginToken("https://other.example"))).toBe("https://other.example");
    await expect(d.dispatch(ORIGIN, "mvx_signMessage", { message: ME + loginToken("https://other.example"), address: ME }, undefined)).rejects.toMatchObject({ code: 4100 });
    await d.dispatch(ORIGIN, "mvx_signMessage", { message: ME + loginToken(ORIGIN), address: ME }, undefined);
    expect(handled.at(-1)?.method).toBe("mvx_signMessage");
  });
});

describe("MultiversX provider on window.multiversx.providers (sdk-dapp custom provider hook)", () => {
  const identity = resolveIdentity({ name: "Kit Wallet", rdns: "org.example.kit" });

  it("adds its own entry without replacing the array or other wallets' entries", () => {
    const win = newWindow();
    const other = { name: "Other", type: "other", constructor: async () => ({}) };
    const original = [other];
    (win as unknown as { multiversx: unknown }).multiversx = { providers: original, keep: 1 };
    const { transport } = harness();
    const { entry, provider, stop } = installMultiversXProvider(win, identity, NETWORKS, transport, { globalKey: "kitwallet" });
    const mvx = (win as unknown as { multiversx: { providers: MultiversXProviderEntry[]; keep: number } }).multiversx;
    expect(mvx.providers).toBe(original);
    expect(mvx.keep).toBe(1);
    expect(mvx.providers.map((e) => e.type)).toEqual(["other", "kitwallet"]);
    expect(entry).toMatchObject({ name: "Kit Wallet", type: "kitwallet", iconUrl: identity.icon });
    expect(Object.isFrozen(entry)).toBe(true);
    expect((win as unknown as { kitwallet: { multiversx: unknown } }).kitwallet.multiversx).toBe(provider);
    // Installing twice doesn't duplicate (sdk-dapp dedupes by type too).
    installMultiversXProvider(win, identity, NETWORKS, transport, { globalKey: "kitwallet" });
    expect(mvx.providers.filter((e) => e.type === "kitwallet")).toHaveLength(1);
    stop();
    expect(mvx.providers.map((e) => e.type)).toEqual(["other"]);
  });

  it("creates the hook when the page has none, never as the DeFi Wallet", () => {
    const win = newWindow();
    const { transport } = harness();
    const { entry } = installMultiversXProvider(win, resolveIdentity(), NETWORKS, transport);
    expect(entry.type).toBe("clipwallet");
    expect(entry.type).not.toBe("extension");
    const w = win as unknown as Record<string, unknown>;
    expect(w.elrondWallet).toBeUndefined();
    expect(w.multiversxWallet).toBeUndefined();
  });

  it("ProviderFactory-style use: construct, init, login with a native-auth token, sign transactions and a message", async () => {
    const win = newWindow();
    const { transport, handled } = harness((req) => {
      if (req.method === "mvx_signTransactions") {
        const txs = (req.params as { transactions: unknown[] }).transactions;
        return { signatures: txs.map((_, i) => ({ signature: String(i + 1).repeat(128).slice(0, 128) })), transactions: txs };
      }
      return { signature: SIG, address: ME };
    });
    const { entry } = installMultiversXProvider(win, identity, NETWORKS, transport);
    // sdk-dapp ProviderFactory.create: `await entry.constructor({ address, anchor })`, then `provider.init()`.
    const p = await entry.constructor({ address: undefined });
    expect(await p.init()).toBe(true);
    expect(p.isInitialized() && !p.isConnected()).toBe(true);
    expect(p.getType()).toBe("clipwallet");

    const token = loginToken(ORIGIN);
    const login = await p.login({ token });
    expect(login).toEqual({ address: ME, signature: SIG });
    expect(handled.map((h) => h.method)).toEqual(["mvx:connect", "mvx_signMessage"]);
    // The native-auth message: address + token (sdk-native-auth-server `${address}${body}`).
    expect(handled[1]!.params).toEqual({ message: `${ME}${token}`, address: ME });
    expect(await p.getAddress()).toBe(ME);
    expect(p.getAccount()).toEqual({ address: ME });

    const t1 = new FakeTransaction(plainTx());
    const t2 = new FakeTransaction(plainTx({ nonce: 8 }));
    const signed = await p.signTransactions([t1, t2]);
    expect(signed[0]).toBe(t1);
    expect(Array.from(t1.signature.slice(0, 2))).toEqual([0x11, 0x11]);
    expect(Array.from(t2.signature.slice(0, 2))).toEqual([0x22, 0x22]);
    expect(t1.guardianSignature).toEqual(new Uint8Array([9]));
    expect(handled.at(-1)).toMatchObject({ method: "mvx_signTransactions", networkId: "mvx:D", params: { transactions: [plainTx(), plainTx({ nonce: 8 })], address: ME } });
    expect(await p.signTransaction(new FakeTransaction(plainTx({ chainID: "1" })))).toBeInstanceOf(FakeTransaction);
    expect(handled.at(-1)?.networkId).toBe("mvx:1");
    await expect(p.signTransactions([new FakeTransaction(plainTx()), new FakeTransaction(plainTx({ chainID: "1" }))])).rejects.toMatchObject({ code: -32602 });

    const message = { data: new TextEncoder().encode("hello"), signer: "sdk-js" } as { data: Uint8Array; signature?: Uint8Array; signer: string };
    const sm = await p.signMessage(message);
    expect(sm).toBe(message);
    expect(sm.signature).toHaveLength(64);
    expect(sm.signer).toBe("Kit Wallet");
    expect(handled.at(-1)?.params).toEqual({ message: "hello", address: ME });
    await expect(p.signMessage({ data: Uint8Array.of(0xff, 0xfe) })).rejects.toMatchObject({ code: -32602 });

    expect(await p.logout()).toBe(true);
    expect(p.isConnected()).toBe(false);
    await expect(p.signMessage({ data: new TextEncoder().encode("x") })).rejects.toMatchObject({ code: 4100 });
  });

  it("session restore: the constructor takes sdk-dapp's stored address; the background still checks it", async () => {
    const win = newWindow();
    const { transport } = harness();
    const { entry } = installMultiversXProvider(win, identity, NETWORKS, transport);
    const p = await entry.constructor({ address: BOB });
    expect(await p.getAddress()).toBe(BOB);
    // Not permitted yet → 4100 from the background, nothing signed.
    await expect(p.signMessage({ data: new TextEncoder().encode("x") })).rejects.toMatchObject({ code: 4100 });
  });

  it("chain ids", () => {
    expect(multiversxNetworkIdOf("D")).toBe("mvx:D");
    expect(multiversxNetworkIdOf("1")).toBe("mvx:1");
    expect(multiversxNetworkIdOf("")).toBeNull();
    expect(nativeAuthOrigin("not.a.token")).toBeNull();
  });
});
