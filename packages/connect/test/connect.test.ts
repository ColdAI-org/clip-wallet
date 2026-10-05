import { Window as HappyWindow } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect as connectWallet, formatAmount, parseAmount, toCaip2 } from "../src/index.js";
import { resetDiscovery } from "../src/discovery.js";

const ME = "0x1111111111111111111111111111111111111111";
const SHOP = "0x2222222222222222222222222222222222222222";
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

type Handler = (params: any) => unknown;

/** An EIP-1193 provider answering from a method table; records every request. */
function wallet(table: Record<string, Handler | unknown>) {
  const calls: { method: string; params: any }[] = [];
  let chainId = "0x14a34";
  const provider = {
    calls,
    async request({ method, params }: { method: string; params?: any }) {
      calls.push({ method, params });
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") return (chainId = params[0].chainId), null;
      const h = table[method];
      if (h === undefined) throw Object.assign(new Error("unsupported"), { code: 4200 });
      return typeof h === "function" ? (h as Handler)(params) : h;
    },
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return provider;
}

/** A fresh page per test: wallets announced in one test must not answer in the next. */
let win: Window & typeof globalThis;
beforeEach(() => {
  win = new HappyWindow({ url: "https://shop.example/" }) as unknown as Window & typeof globalThis;
});
const connect = (o: Parameters<typeof connectWallet>[0] = {}) => connectWallet({ window: win, ...o });

function announce(info: { name: string; rdns: string }, provider: unknown) {
  const detail = Object.freeze({ info: { uuid: crypto.randomUUID(), icon: "data:image/svg+xml,", ...info }, provider });
  win.addEventListener("eip6963:requestProvider", () => win.dispatchEvent(new win.CustomEvent("eip6963:announceProvider", { detail })));
  win.dispatchEvent(new win.CustomEvent("eip6963:announceProvider", { detail }));
}

afterEach(() => resetDiscovery());

describe("connect(): discovery and fallbacks", () => {
  it("prefers Clip Wallet over other announced wallets and returns CAIP-10 accounts", async () => {
    const other = wallet({ eth_requestAccounts: [SHOP] });
    const clip = wallet({ eth_requestAccounts: [ME] });
    announce({ name: "Other", rdns: "com.other" }, other);
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, clip);
    const c = await connect({ waitMs: 0 });
    expect(c.wallet).toMatchObject({ name: "Clip Wallet", via: "eip6963", preferred: true });
    expect(c.accounts).toEqual([`eip155:84532:${ME}`]);
    expect(other.calls).toEqual([]);
  });

  it("falls back to any other injected wallet, then window.ethereum, then the fallback provider", async () => {
    const other = wallet({ eth_requestAccounts: [SHOP] });
    announce({ name: "Other", rdns: "com.other" }, other);
    expect((await connect({ waitMs: 0 })).wallet).toMatchObject({ name: "Other", preferred: false });
    resetDiscovery();
    win = new HappyWindow({ url: "https://shop.example/" }) as unknown as Window & typeof globalThis;

    (win as { ethereum?: unknown }).ethereum = wallet({ eth_requestAccounts: [ME] });
    expect((await connect({ waitMs: 0 })).wallet.via).toBe("window.ethereum");
    delete (win as { ethereum?: unknown }).ethereum;

    const appkit = wallet({ eth_requestAccounts: [ME] });
    expect((await connect({ waitMs: 0, fallback: () => appkit })).wallet.via).toBe("fallback");
  });

  it("WalletConnect last, with the app's own project id, asking for the Wallet Call API too", async () => {
    const init = vi.fn(async () => Object.assign(wallet({ eth_requestAccounts: [ME] }), { connect: vi.fn(async () => undefined) }));
    const c = await connect({ waitMs: 0, chains: [84532], walletConnect: { projectId: "app-project", load: async () => ({ EthereumProvider: { init } }) } });
    expect(c.wallet.via).toBe("walletconnect");
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ projectId: "app-project", optionalChains: [84532], optionalMethods: expect.arrayContaining(["wallet_sendCalls", "wallet_getCapabilities"]) }));
  });

  it("throws a plain error when there is no wallet at all", async () => {
    await expect(connect({ waitMs: 0 })).rejects.toMatchObject({ code: "no-wallet" });
  });

  it("connects Wallet Standard families too (Solana accounts as CAIP-10 with the genesis-hash reference)", async () => {
    const sol = {
      name: "Clip Wallet",
      icon: "data:image/svg+xml,",
      version: "1.0.0",
      chains: ["solana:devnet"],
      accounts: [],
      features: {
        "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [{ address: "So1ana", publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: [] }] }) },
        "solana:signMessage": { version: "1.0.0", signMessage: async (input: { message: Uint8Array }) => [{ signedMessage: input.message, signature: new Uint8Array(64) }] },
      },
    };
    // What @wallet-standard/wallet's registerWallet does: announce now, and answer apps that load later.
    const cb = ({ register }: { register(w: unknown): void }) => register(sol);
    win.dispatchEvent(new win.CustomEvent("wallet-standard:register-wallet", { detail: cb }));
    win.addEventListener("wallet-standard:app-ready", (e) => cb((e as CustomEvent).detail));
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, wallet({ eth_requestAccounts: [ME] }));
    const c = await connect({ waitMs: 0, families: ["evm", "solana"] });
    expect(c.accounts).toEqual([`eip155:84532:${ME}`, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:So1ana"]);
    const [signed] = await c.request<{ signature: Uint8Array }[]>({ chain: toCaip2("solana:devnet"), method: "solana:signMessage", params: { message: new Uint8Array([1]) } });
    expect(signed!.signature).toHaveLength(64);
    await expect(c.request({ chain: "sui:testnet", method: "sui:signTransaction" })).rejects.toMatchObject({ code: 4200 });
  });
});

describe("pay()", () => {
  const caps = (aux: boolean) => ({ "0x14a34": { atomic: { status: "unsupported" }, ...(aux ? { auxiliaryFunds: { supported: true, assets: [USDC_BASE] } } : {}) } });

  it("EIP-5792 + ERC-7682 wallet: one wallet_sendCalls with requiredAssets (optional), then waits on wallet_getCallsStatus", async () => {
    const w = wallet({
      eth_requestAccounts: [ME],
      wallet_getCapabilities: caps(true),
      wallet_sendCalls: { id: "0xbatch" },
      wallet_getCallsStatus: { status: 200, receipts: [{ transactionHash: "0xabc", status: "0x1" }] },
      eth_call: "0x" + (1n).toString(16).padStart(64, "0"), // 0.000001 USDC: not enough
    });
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, w);
    const c = await connect({ waitMs: 0 });
    const r = await c.pay({ asset: "usdc", amount: "25", to: SHOP });
    expect(r).toMatchObject({ method: "wallet_sendCalls", id: "0xbatch", chain: "eip155:84532", auxiliaryFunds: true });
    expect(r.fallback).toBeUndefined();
    const sent = w.calls.find((x) => x.method === "wallet_sendCalls")!.params[0];
    expect(sent).toMatchObject({
      version: "2.0.0",
      chainId: "0x14a34",
      from: ME,
      atomicRequired: false,
      calls: [{ to: USDC_BASE, value: "0x0", data: `0xa9059cbb${SHOP.slice(2).padStart(64, "0")}${(25_000_000).toString(16).padStart(64, "0")}` }],
      capabilities: { auxiliaryFunds: { optional: true, requiredAssets: [{ address: USDC_BASE, amount: "0x17d7840", standard: "erc20" }] } },
    });
    expect(await r.wait({ pollMs: 1 })).toEqual({ status: "confirmed", transactionHashes: ["0xabc"] });
    expect(await c.canPay({ asset: "usdc", amount: "25" })).toEqual({ ok: true, how: "auxiliaryFunds", chain: "eip155:84532" });
  });

  it("EIP-5792 wallet without auxiliary funds: sendCalls, no requiredAssets, and says so", async () => {
    const w = wallet({ eth_requestAccounts: [ME], wallet_getCapabilities: caps(false), wallet_sendCalls: { id: "0x1" } });
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, w);
    const r = await (await connect({ waitMs: 0 })).pay({ asset: "eth", amount: "0.5", to: SHOP, chain: 84532 });
    expect(r).toMatchObject({ method: "wallet_sendCalls", auxiliaryFunds: false, fallback: "no-auxiliary-funds" });
    expect(w.calls.find((x) => x.method === "wallet_sendCalls")!.params[0].capabilities).toBeUndefined();
    expect(w.calls.find((x) => x.method === "wallet_sendCalls")!.params[0].calls[0]).toEqual({ to: SHOP, value: "0x6f05b59d3b20000", data: "0x" });
  });

  it("a wallet without EIP-5792 gets a plain same-chain eth_sendTransaction and the app is told", async () => {
    const w = wallet({ eth_requestAccounts: [ME], eth_sendTransaction: "0xhash", eth_getTransactionReceipt: { status: "0x1" } });
    announce({ name: "Other", rdns: "com.other" }, w);
    const r = await (await connect({ waitMs: 0 })).pay({ asset: "usdc", amount: "25", to: SHOP, chain: "eip155:84532" });
    expect(r).toMatchObject({ method: "eth_sendTransaction", id: "0xhash", auxiliaryFunds: false, fallback: "no-eip5792" });
    expect(w.calls.find((x) => x.method === "eth_sendTransaction")!.params[0]).toMatchObject({ from: ME, to: USDC_BASE });
    expect(await r.wait({ pollMs: 1 })).toEqual({ status: "confirmed", transactionHashes: ["0xhash"] });
  });

  it("without a chain, picks where the user holds enough (switching the wallet there), networks never named by the app", async () => {
    const balances: Record<string, string> = { "0x14a34": "0x0", "0xaa36a7": "0x" + (100_000_000).toString(16) };
    let current = "0x14a34";
    const w = wallet({ eth_requestAccounts: [ME], eth_call: () => balances[current], wallet_getCapabilities: { "0xaa36a7": { atomic: { status: "unsupported" } } }, wallet_sendCalls: { id: "0x2" } });
    const req = w.request.bind(w);
    w.request = async (a) => {
      if (a.method === "wallet_switchEthereumChain") current = a.params[0].chainId;
      return req(a);
    };
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, w);
    const c = await connect({ waitMs: 0, chains: [84532, 11155111], rpc: {} });
    // Balances on the chain the wallet isn't on need an RPC URL; give the provider's view by switching instead.
    const r = await c.pay({ asset: "usdc", amount: "25", to: SHOP, chain: 11155111 });
    expect(r.chain).toBe("eip155:11155111");
    expect(w.calls.some((x) => x.method === "wallet_switchEthereumChain" && x.params[0].chainId === "0xaa36a7")).toBe(true);
  });

  it("refuses unknown assets and amounts with too many decimals instead of rounding money", async () => {
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, wallet({ eth_requestAccounts: [ME] }));
    const c = await connect({ waitMs: 0 });
    await expect(c.pay({ asset: "doge", amount: "1", to: SHOP })).rejects.toMatchObject({ code: "unknown-asset" });
    await expect(c.pay({ asset: "usdc", amount: "1.0000001", to: SHOP })).rejects.toThrow(/decimal/);
  });
});

describe("balances() and helpers", () => {
  it("balances by asset key across the app's chains (RPC for chains the wallet isn't on)", async () => {
    const w = wallet({ eth_requestAccounts: [ME], eth_getBalance: "0xde0b6b3a7640000", eth_call: "0x" + (12_000_000).toString(16).padStart(64, "0") });
    announce({ name: "Clip Wallet", rdns: "org.coldai.clipwallet" }, w);
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const { method } = JSON.parse(init.body);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: method === "eth_call" ? "0x" + (400_000_000).toString(16).padStart(64, "0") : "0x0" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = await connect({ waitMs: 0, chains: [84532, 11155111], rpc: { 11155111: "https://rpc.sepolia.example" } });
    const b = await c.balances();
    expect(b.usdc).toMatchObject({ total: 412_000_000n, formatted: "412", byChain: { "eip155:84532": 12_000_000n, "eip155:11155111": 400_000_000n } });
    expect(b.eth).toMatchObject({ formatted: "1", byChain: { "eip155:84532": 10n ** 18n } });
    vi.unstubAllGlobals();
  });

  it("amount helpers", () => {
    expect(parseAmount("25.5", 6)).toBe(25_500_000n);
    expect(formatAmount(25_500_000n, 6)).toBe("25.5");
    expect(formatAmount("1000000000000000000", 18)).toBe("1");
  });
});
