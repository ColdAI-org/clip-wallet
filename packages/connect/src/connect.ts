/**
 * Clip Connect: one connect() for every wallet. Prefers Clip Wallet (EIP-6963 rdns / Wallet Standard name), falls back
 * to any other injected wallet, then to `window.ethereum`, then to a provider you pass (AppKit, WalletConnect).
 * Speaks only public standards (EIP-1193, EIP-6963, EIP-5792, ERC-7682, Wallet Standard, CAIP-2/10), so it works with
 * any wallet that implements them and depends on no wallet internals.
 */
import { type AssetSpec, NATIVE, assetRegistry, erc20BalanceOf, erc20Transfer, formatAmount, parseAmount } from "./assets.js";
import { type Caip10, type Caip2, caip10, evmCaip2, evmChainId, toCaip2, toHex, toWalletStandardChain } from "./caip.js";
import { CLIP_WALLET, type Eip1193Provider, type Preference, type StandardWallet, discover, rankEip6963, rankStandard } from "./discovery.js";

export type Family = "evm" | "solana" | "sui" | "aptos" | "bitcoin";

export interface WalletConnectOptions {
  /** Your Reown (WalletConnect) Cloud project id. Clip Connect never ships one. */
  projectId: string;
  metadata?: { name: string; description: string; url: string; icons: string[] };
  showQrModal?: boolean;
  /** How to load @walletconnect/ethereum-provider (optional peer). Pass `() => import("@walletconnect/ethereum-provider")`. */
  load?: () => Promise<{ EthereumProvider: { init(o: Record<string, unknown>): Promise<Eip1193Provider & { connect?(): Promise<unknown>; enable?(): Promise<unknown> }> } }>;
}

export interface ConnectOptions {
  /** Which wallet to prefer when several are installed. Default: Clip Wallet. */
  prefer?: Preference;
  /** Families to connect. Default ["evm"]. Each non-EVM family asks the user once (Wallet Standard connect). */
  families?: Family[];
  /** EVM chain ids your app works on (balances, pay without a chain, WalletConnect). Default: the wallet's chain. */
  chains?: number[];
  /** Extra assets by key, merged over the built-in table (native coins, Circle USDC). */
  assets?: AssetSpec[];
  /** Read-only JSON-RPC URLs per EVM chain id, for balances on chains the wallet isn't on right now. */
  rpc?: Record<number, string>;
  /** Used when no injected EVM wallet exists: any EIP-1193 provider (e.g. Reown AppKit's `getProvider("eip155")`). */
  fallback?: () => Eip1193Provider | Promise<Eip1193Provider>;
  /** WalletConnect when nothing is injected and no `fallback` is given. */
  walletConnect?: WalletConnectOptions;
  window?: Window & typeof globalThis;
  /** How long to wait for wallets to announce themselves. Default 120 ms. */
  waitMs?: number;
}

export interface WalletInfo {
  name: string;
  icon?: string;
  rdns?: string;
  via: "eip6963" | "window.ethereum" | "fallback" | "walletconnect" | "wallet-standard";
  /** True for the preferred wallet (Clip Wallet unless you set `prefer`). */
  preferred: boolean;
}

export interface ChainCapabilities {
  atomic?: { status: "supported" | "ready" | "unsupported" };
  auxiliaryFunds?: { supported: boolean; assets?: string[] };
  [k: string]: unknown;
}

export interface PayRequest {
  /** Asset key ("usdc", "eth") or { address, decimals } for a token not in the table. */
  asset: string | { address: `0x${string}` | "native"; decimals: number; symbol?: string };
  /** Human units ("25", "0.5") or base units as a bigint. */
  amount: string | number | bigint;
  to: string;
  /** CAIP-2 ("eip155:84532") or a chain id. Omit it and Clip Connect picks: where you hold enough, else where the wallet can bring money in. */
  chain?: Caip2 | number;
}

export interface PayResult {
  chain: Caip2;
  /** "wallet_sendCalls" when the wallet speaks EIP-5792, else a plain "eth_sendTransaction". */
  method: "wallet_sendCalls" | "eth_sendTransaction";
  /** EIP-5792 batch id (sendCalls) or the transaction hash (plain transfer). */
  id: string;
  /** True when the wallet said it can bring in money from elsewhere (ERC-7682) and was told what's needed. */
  auxiliaryFunds: boolean;
  /** Set when Clip Connect fell back to a same-chain transfer: tell your user the balance on `chain` must cover it. */
  fallback?: "no-eip5792" | "no-auxiliary-funds";
  /** Resolves with the final state (polls wallet_getCallsStatus or the receipt). */
  wait(opts?: { timeoutMs?: number; pollMs?: number }): Promise<{ status: "confirmed" | "failed"; transactionHashes: string[] }>;
}

export interface AssetBalance {
  key: string;
  symbol: string;
  decimals: number;
  /** Base units summed over every chain read. */
  total: bigint;
  /** "25.5" */
  formatted: string;
  byChain: Partial<Record<Caip2, bigint>>;
}

export type ConnectEvent = "accountsChanged" | "chainChanged" | "disconnect";

export interface ClipConnection {
  wallet: WalletInfo;
  /** Every connected account, CAIP-10. EVM accounts are listed on the wallet's current chain. */
  accounts: Caip10[];
  /** The EIP-1193 provider (for viem/ethers), when an EVM wallet is connected. */
  evm?: { provider: Eip1193Provider; address: `0x${string}`; chain: Caip2 };
  /** Wallet Standard wallets connected for non-EVM families. */
  standard: StandardWallet[];
  /** Any method on any connected chain: EVM JSON-RPC, or a Wallet Standard feature ("solana:signMessage"). */
  request<T = unknown>(r: { chain: Caip2 | number; method: string; params?: unknown }): Promise<T>;
  /** EIP-5792 capabilities per chain, or null when the wallet doesn't speak EIP-5792. */
  capabilities(chains?: (Caip2 | number)[]): Promise<Record<Caip2, ChainCapabilities> | null>;
  pay(p: PayRequest): Promise<PayResult>;
  /** Balances by asset key across your chains (see `rpc`). Assets with nothing anywhere are left out. */
  balances(): Promise<Record<string, AssetBalance>>;
  /** Can the user pay this somewhere? "balance" = they hold enough on a chain; "auxiliaryFunds" = the wallet can bring it in. */
  canPay(p: Omit<PayRequest, "to">): Promise<{ ok: boolean; how: "balance" | "auxiliaryFunds" | "none"; chain?: Caip2 }>;
  on(event: ConnectEvent, cb: (data: unknown) => void): () => void;
  disconnect(): Promise<void>;
}

const UNSUPPORTED = new Set([4200, -32601, -32602]);
const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? Number((e as { code: unknown }).code) : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpcFetch(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

async function evmProvider(opts: ConnectOptions): Promise<{ provider: Eip1193Provider; wallet: WalletInfo } | undefined> {
  const win = opts.window ?? (globalThis.window as (Window & typeof globalThis) | undefined);
  const prefer = opts.prefer ?? CLIP_WALLET;
  const found = await discover({ ...(win ? { window: win } : {}), waitMs: opts.waitMs ?? 120 });
  const [first] = rankEip6963(found.eip6963, prefer);
  if (first) {
    return {
      provider: first.provider,
      wallet: { name: first.info.name, icon: first.info.icon, rdns: first.info.rdns, via: "eip6963", preferred: first.info.rdns === prefer.rdns || first.info.name === prefer.name },
    };
  }
  const legacy = (win as unknown as { ethereum?: Eip1193Provider } | undefined)?.ethereum;
  if (legacy && typeof legacy.request === "function") return { provider: legacy, wallet: { name: "Browser wallet", via: "window.ethereum", preferred: false } };
  if (opts.fallback) return { provider: await opts.fallback(), wallet: { name: "Wallet", via: "fallback", preferred: false } };
  if (opts.walletConnect) {
    const wc = opts.walletConnect;
    const load = wc.load ?? (() => import(/* @vite-ignore */ ["@walletconnect", "ethereum-provider"].join("/")) as never);
    const { EthereumProvider } = await load();
    const chains = opts.chains?.length ? opts.chains : [1];
    const provider = await EthereumProvider.init({
      projectId: wc.projectId,
      ...(wc.metadata ? { metadata: wc.metadata } : {}),
      showQrModal: wc.showQrModal ?? true,
      optionalChains: chains,
      // Ask for the Wallet Call API too: wallets that serve it (Clip Wallet does) will say so in the session.
      optionalMethods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus", "wallet_showCallsStatus", "wallet_switchEthereumChain"],
    });
    await (provider.connect?.() ?? provider.enable?.());
    return { provider, wallet: { name: "WalletConnect", via: "walletconnect", preferred: false } };
  }
  return undefined;
}

/** Discover, pick and connect. Throws if no wallet is available for any requested family. */
export async function connect(opts: ConnectOptions = {}): Promise<ClipConnection> {
  const families = opts.families ?? ["evm"];
  const registry = assetRegistry(opts.assets);
  const listeners = new Map<ConnectEvent, Set<(d: unknown) => void>>();
  const emit = (e: ConnectEvent, d: unknown) => listeners.get(e)?.forEach((cb) => cb(d));
  const accounts: Caip10[] = [];
  let wallet: WalletInfo | undefined;
  let evm: ClipConnection["evm"];
  const standard: StandardWallet[] = [];
  const cleanups: (() => void)[] = [];

  if (families.includes("evm")) {
    const got = await evmProvider(opts);
    if (got) {
      const list = (await got.provider.request({ method: "eth_requestAccounts" })) as string[];
      const chainHex = (await got.provider.request({ method: "eth_chainId" })) as string;
      const address = list[0] as `0x${string}` | undefined;
      if (address) {
        evm = { provider: got.provider, address, chain: evmCaip2(chainHex) };
        wallet = got.wallet;
        accounts.push(caip10(evm.chain, address));
        const onAccounts = (a: unknown) => {
          const next = Array.isArray(a) ? (a[0] as `0x${string}` | undefined) : undefined;
          if (evm) {
            if (next) evm.address = next;
            emit(next ? "accountsChanged" : "disconnect", next ? [caip10(evm.chain, next)] : []);
          }
        };
        const onChain = (c: unknown) => {
          if (evm && typeof c === "string") {
            evm.chain = evmCaip2(c);
            emit("chainChanged", evm.chain);
          }
        };
        got.provider.on?.("accountsChanged", onAccounts);
        got.provider.on?.("chainChanged", onChain);
        cleanups.push(() => (got.provider.removeListener?.("accountsChanged", onAccounts), got.provider.removeListener?.("chainChanged", onChain)));
      }
    }
  }

  const others = families.filter((f) => f !== "evm");
  if (others.length) {
    const found = await discover({ ...(opts.window ? { window: opts.window } : {}), waitMs: 0 });
    for (const fam of others) {
      const ns = fam === "bitcoin" ? "bitcoin:" : `${fam}:`;
      const w = rankStandard(found.standard, opts.prefer ?? CLIP_WALLET).find((x) => x.chains.some((c) => c.startsWith(ns)) && x.features["standard:connect"]);
      if (!w) continue;
      const res = (await (w.features["standard:connect"] as { connect(): Promise<{ accounts: StandardWallet["accounts"] }> }).connect()) ?? { accounts: w.accounts };
      if (!standard.includes(w)) standard.push(w);
      for (const a of res.accounts ?? w.accounts) for (const c of a.chains.filter((x) => x.startsWith(ns))) accounts.push(caip10(toCaip2(c), a.address));
      wallet ??= { name: w.name, icon: w.icon, via: "wallet-standard", preferred: w.name === (opts.prefer?.name ?? CLIP_WALLET.name) };
    }
  }
  if (!wallet) throw Object.assign(new Error("No wallet found. Install Clip Wallet or another wallet, or pass walletConnect / fallback."), { code: "no-wallet" });

  /* ---------------------------------------------------------------- helpers */

  const toChain = (c: Caip2 | number): Caip2 => (typeof c === "number" ? evmCaip2(c) : c);
  const evmOrThrow = () => {
    if (!evm) throw Object.assign(new Error("No EVM wallet is connected."), { code: "no-evm" });
    return evm;
  };
  const ensureChain = async (chain: Caip2) => {
    const e = evmOrThrow();
    if (e.chain === chain) return;
    await e.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(evmChainId(chain)!) }] });
    e.chain = chain;
  };
  const read = async (chain: Caip2, method: string, params: unknown[]): Promise<unknown> => {
    const e = evmOrThrow();
    const url = opts.rpc?.[evmChainId(chain)!];
    if (url) return rpcFetch(url, method, params);
    if (e.chain === chain) return e.provider.request({ method, params });
    return undefined;
  };
  const evmChains = (): Caip2[] => {
    const set = new Set<Caip2>([...(opts.chains ?? []).map((c) => evmCaip2(c))]);
    if (evm) set.add(evm.chain);
    return [...set];
  };

  const capabilities: ClipConnection["capabilities"] = async (chains) => {
    const e = evmOrThrow();
    const ids = (chains ?? evmChains()).map((c) => toHex(evmChainId(toChain(c))!));
    try {
      const res = (await e.provider.request({ method: "wallet_getCapabilities", params: [e.address, ids] })) as Record<string, ChainCapabilities>;
      const out: Record<Caip2, ChainCapabilities> = {};
      const all = res["0x0"] ?? {};
      for (const [hex, caps] of Object.entries(res ?? {})) if (hex !== "0x0") out[evmCaip2(hex)] = { ...all, ...caps };
      for (const id of ids) if (!out[evmCaip2(id)] && res["0x0"]) out[evmCaip2(id)] = { ...all };
      return out;
    } catch (err) {
      if (UNSUPPORTED.has(codeOf(err) ?? 0) || codeOf(err) === 4100) return null;
      throw err;
    }
  };

  const specOf = (asset: PayRequest["asset"]) => {
    if (typeof asset !== "string") return { key: asset.symbol ?? "custom", symbol: asset.symbol ?? "", decimals: asset.decimals, on: undefined, address: asset.address };
    const s = registry.get(asset);
    if (!s) throw Object.assign(new Error(`Unknown asset "${asset}". Pass it in connect({ assets }).`), { code: "unknown-asset" });
    return { ...s, address: undefined };
  };
  const addressOn = (spec: ReturnType<typeof specOf>, chain: Caip2) => spec.address ?? spec.on?.[chain];

  const balanceOf = async (chain: Caip2, token: `0x${string}` | "native"): Promise<bigint | undefined> => {
    const e = evmOrThrow();
    try {
      const raw =
        token === "native" ? await read(chain, "eth_getBalance", [e.address, "latest"]) : await read(chain, "eth_call", [{ to: token, data: erc20BalanceOf(e.address) }, "latest"]);
      return typeof raw === "string" && raw.startsWith("0x") ? BigInt(raw === "0x" ? 0 : raw) : undefined;
    } catch {
      return undefined;
    }
  };

  const pickChain = async (spec: ReturnType<typeof specOf>, units: bigint): Promise<{ chain: Caip2; how: "balance" | "auxiliaryFunds" | "none" }> => {
    const e = evmOrThrow();
    const cands = [e.chain, ...evmChains().filter((c) => c !== e.chain)].filter((c) => addressOn(spec, c));
    for (const c of cands) {
      const b = await balanceOf(c, addressOn(spec, c)!);
      if (b !== undefined && b >= units) return { chain: c, how: "balance" };
    }
    const caps = await capabilities(cands).catch(() => null);
    for (const c of cands) if (auxFor(caps, c, addressOn(spec, c)!)) return { chain: c, how: "auxiliaryFunds" };
    return { chain: cands[0] ?? e.chain, how: "none" };
  };

  const auxFor = (caps: Record<Caip2, ChainCapabilities> | null, chain: Caip2, token: string) => {
    const aux = caps?.[chain]?.auxiliaryFunds;
    if (!aux?.supported) return false;
    const want = (token === "native" ? NATIVE : token).toLowerCase();
    return !aux.assets || aux.assets.some((a) => a.toLowerCase() === want);
  };

  const waitCalls = (id: string, chain: Caip2): PayResult["wait"] => async (o = {}) => {
    const end = Date.now() + (o.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const st = (await evmOrThrow().provider.request({ method: "wallet_getCallsStatus", params: [id] })) as { status: number; receipts?: { transactionHash: string; status: string }[] };
      if (st.status >= 200) {
        return { status: st.status === 200 ? "confirmed" : "failed", transactionHashes: (st.receipts ?? []).map((r) => r.transactionHash) };
      }
      if (Date.now() > end) throw Object.assign(new Error("Timed out waiting for the payment."), { code: "timeout", chain });
      await sleep(o.pollMs ?? 2000);
    }
  };
  const waitTx = (hash: string, chain: Caip2): PayResult["wait"] => async (o = {}) => {
    const end = Date.now() + (o.timeoutMs ?? 10 * 60_000);
    for (;;) {
      const r = (await read(chain, "eth_getTransactionReceipt", [hash]).catch(() => null)) as { status?: string } | null;
      if (r?.status) return { status: r.status === "0x1" ? "confirmed" : "failed", transactionHashes: [hash] };
      if (Date.now() > end) throw Object.assign(new Error("Timed out waiting for the payment."), { code: "timeout", chain });
      await sleep(o.pollMs ?? 2000);
    }
  };

  /* ---------------------------------------------------------------- the connection */

  const conn: ClipConnection = {
    wallet,
    accounts,
    ...(evm ? { evm } : {}),
    standard,

    async request<T>(r: { chain: Caip2 | number; method: string; params?: unknown }): Promise<T> {
      const chain = toChain(r.chain);
      if (chain.startsWith("eip155:")) {
        await ensureChain(chain);
        return (await evmOrThrow().provider.request({ method: r.method, ...(r.params !== undefined ? { params: r.params } : {}) })) as T;
      }
      const ws = toWalletStandardChain(chain);
      const w = standard.find((x) => x.chains.includes(ws) || x.chains.includes(chain));
      const feature = w?.features[r.method] as Record<string, (...a: unknown[]) => Promise<unknown>> | undefined;
      const fn = feature?.[r.method.split(":")[1] ?? ""];
      if (!fn) throw Object.assign(new Error(`No connected wallet offers ${r.method} on ${chain}.`), { code: 4200 });
      return (await fn.apply(feature, Array.isArray(r.params) ? r.params : [r.params])) as T;
    },

    capabilities,

    async pay(p) {
      const e = evmOrThrow();
      const spec = specOf(p.asset);
      const units = parseAmount(p.amount, spec.decimals);
      const chain = p.chain !== undefined ? toChain(p.chain) : (await pickChain(spec, units)).chain;
      const token = addressOn(spec, chain);
      if (!token) throw Object.assign(new Error(`${spec.symbol || "That asset"} isn't known on ${chain}.`), { code: "unknown-asset" });
      const call = token === "native" ? { to: p.to, value: toHex(units), data: "0x" } : { to: token, value: "0x0", data: erc20Transfer(p.to, units) };
      await ensureChain(chain);
      const caps = await capabilities([chain]).catch(() => null);
      if (caps) {
        const aux = auxFor(caps, chain, token);
        const params = {
          version: "2.0.0",
          chainId: toHex(evmChainId(chain)!),
          from: e.address,
          atomicRequired: false,
          calls: [call],
          // ERC-7682: requiredAssets only when the wallet advertises the capability, marked optional; native comes from `value`.
          ...(aux ? { capabilities: { auxiliaryFunds: { optional: true, ...(token === "native" ? {} : { requiredAssets: [{ address: token, amount: toHex(units), standard: "erc20" }] }) } } } : {}),
        };
        try {
          const res = (await e.provider.request({ method: "wallet_sendCalls", params: [params] })) as { id: string };
          return { chain, method: "wallet_sendCalls", id: res.id, auxiliaryFunds: aux, ...(aux ? {} : { fallback: "no-auxiliary-funds" as const }), wait: waitCalls(res.id, chain) };
        } catch (err) {
          if (!UNSUPPORTED.has(codeOf(err) ?? 0)) throw err;
        }
      }
      const hash = (await e.provider.request({ method: "eth_sendTransaction", params: [{ from: e.address, ...call }] })) as string;
      return { chain, method: "eth_sendTransaction", id: hash, auxiliaryFunds: false, fallback: "no-eip5792", wait: waitTx(hash, chain) };
    },

    async balances() {
      const out: Record<string, AssetBalance> = {};
      for (const spec of registry.values()) {
        for (const chain of evmChains()) {
          const token = spec.on[chain];
          if (!token) continue;
          const b = await balanceOf(chain, token);
          if (b === undefined || b === 0n) continue;
          const cur = (out[spec.key] ??= { key: spec.key, symbol: spec.symbol, decimals: spec.decimals, total: 0n, formatted: "0", byChain: {} });
          cur.byChain[chain] = b;
          cur.total += b;
          cur.formatted = formatAmount(cur.total, spec.decimals);
        }
      }
      return out;
    },

    async canPay(p) {
      const spec = specOf(p.asset);
      const units = parseAmount(p.amount, spec.decimals);
      const r = await pickChain(spec, units);
      return { ok: r.how !== "none", how: r.how, ...(r.how !== "none" ? { chain: r.chain } : {}) };
    },

    on(event, cb) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(cb);
      return () => set!.delete(cb);
    },

    async disconnect() {
      cleanups.splice(0).forEach((c) => c());
      if (evm) {
        await evm.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
        await (evm.provider as { disconnect?: () => Promise<void> }).disconnect?.().catch?.(() => undefined);
      }
      for (const w of standard) await (w.features["standard:disconnect"] as { disconnect?: () => Promise<void> } | undefined)?.disconnect?.().catch(() => undefined);
      emit("disconnect", []);
    },
  };
  return conn;
}
