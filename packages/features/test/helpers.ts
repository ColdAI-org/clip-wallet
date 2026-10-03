import type { Account, AssetRef, ChainContext, DappRequest, DecodedRequest, Network, TokenBalance } from "@clip-wallet/core";
import { HEDERA_TESTNET, aliasAddress, clearMirrorCache } from "@clip-wallet/chains-hedera";
import { SOLANA_DEVNET, SOLANA_MAINNET } from "@clip-wallet/chains-solana";
import { vi } from "vitest";
import type { FeatureHost } from "../src/host.js";

/** Public key only (from chains-hedera test fixtures). No private key exists anywhere in this package. */
export const HEDERA_PUB = "037601488ece3332e657cb928cd949745319f6b4b741db300125c61e9a6ac014a4";
export const ME_HEDERA = "0.0.1001";
/** A public Solana address used only as a label (no key). */
export const ME_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const ME_EVM = "0x1111111111111111111111111111111111111111";

export const BASE_MAINNET: Network = {
  id: "eip155:8453",
  family: "evm",
  name: "Base",
  nativeAsset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:8453" },
  testnet: false,
  rpcUrls: ["https://base.rpc.test"],
  explorerUrl: "https://basescan.org",
  chainId: 8453,
};
export const SEPOLIA: Network = {
  id: "eip155:11155111",
  family: "evm",
  name: "Ethereum Sepolia",
  nativeAsset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:11155111" },
  testnet: true,
  rpcUrls: ["https://sepolia.rpc.test"],
  explorerUrl: "https://sepolia.etherscan.io",
  chainId: 11155111,
};
export const DEVNET = { ...SOLANA_DEVNET, rpcUrls: ["https://devnet.rpc.test"] };
export const SOL_MAIN = { ...SOLANA_MAINNET, rpcUrls: ["https://mainnet.rpc.test"] };

export const hbar = (n = HEDERA_TESTNET.id): AssetRef => ({ key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: n });
export const sauce = (n = HEDERA_TESTNET.id): AssetRef => ({ key: "hts:0.0.1183558", symbol: "SAUCE", name: "SAUCE", decimals: 6, networkId: n, address: "0.0.1183558" });
export const usdcHedera = (n = HEDERA_TESTNET.id): AssetRef => ({ key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n, address: "0.0.429274" });
export const sol = (n: string): AssetRef => ({ key: "sol", symbol: "SOL", name: "Solana", decimals: 9, networkId: n });
export const usdcSol = (n: string, mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"): AssetRef => ({ key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n, address: mint });
export const ethOn = (n: Network): AssetRef => n.nativeAsset;
export const usdcEvm = (n: Network, address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"): AssetRef => ({ key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address });

export function accountFor(network: Network): Account {
  if (network.family === "hedera") {
    return { id: "hedera:0", family: "hedera", index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: HEDERA_PUB, address: aliasAddress(HEDERA_PUB), hederaAccountId: ME_HEDERA };
  }
  if (network.family === "solana") {
    return { id: "solana:0", family: "solana", index: 0, curve: "ed25519", derivationPath: "m/44'/501'/0'/0'", publicKey: "00".repeat(32), address: ME_SOL };
  }
  return { id: "evm:0", family: "evm", index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: "02".padEnd(66, "1"), address: ME_EVM };
}

type Body = unknown | ((url: string, init?: RequestInit) => unknown);
export type Route = [RegExp, Body] | [RegExp, Body, number];

/**
 * Mocked fetch. URL routes first (first match wins; a function receives url and init). JSON-RPC bodies are
 * matched by `rpc` method handlers. Unmatched → 404. Every call is recorded.
 */
export function mockFetch(routes: Route[], rpc: Record<string, (params: unknown[], url: string) => unknown> = {}) {
  const calls: { url: string; init?: RequestInit; method?: string; params?: unknown[] }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let parsed: { id?: number; method?: string; params?: unknown[] } | null = null;
    try {
      parsed = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      parsed = null;
    }
    calls.push({ url, init, method: parsed?.method, params: parsed?.params });
    if (parsed?.method && rpc[parsed.method]) {
      try {
        return json({ jsonrpc: "2.0", id: parsed.id, result: rpc[parsed.method]!(parsed.params ?? [], url) });
      } catch (e) {
        return json({ jsonrpc: "2.0", id: parsed.id, error: e });
      }
    }
    for (const [re, body, status] of routes) {
      if (re.test(url)) {
        const v = typeof body === "function" ? (body as (u: string, i?: RequestInit) => unknown)(url, init) : body;
        if (v === undefined) break;
        return json(v, status ?? 200);
      }
    }
    return json({ _status: { messages: [{ message: "Not found" }] } }, 404);
  }) as typeof fetch;
  return { fetch: f, calls };
}

export function json(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
}

export interface Enqueued {
  request: DappRequest;
  appName: string;
  resolve(v: unknown): void;
  reject(e: unknown): void;
}

/** A FeatureHost backed by fixtures. `enqueued` records approvals; tests resolve them as the user would. */
export function fakeHost(p: {
  networks: Network[];
  assets?: AssetRef[];
  balances?: TokenBalance[];
  fetch: typeof fetch;
  usd?: Record<string, number>;
  decode?: (r: DappRequest) => Promise<DecodedRequest>;
  now?: () => number;
}): FeatureHost & { enqueued: Enqueued[]; store: Map<string, unknown> } {
  clearMirrorCache();
  const enqueued: Enqueued[] = [];
  const store = new Map<string, unknown>();
  const host = {
    enqueued,
    store,
    networks: () => p.networks,
    assets: () => p.assets ?? p.networks.map((n) => n.nativeAsset),
    ctx: async (networkId: string): Promise<ChainContext> => {
      const network = p.networks.find((n) => n.id === networkId)!;
      return { network, account: accountFor(network), fetch: p.fetch };
    },
    balances: async () => p.balances ?? [],
    enqueue: vi.fn(async (request: DappRequest, meta: { appName: string }) => {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const result = new Promise<unknown>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      result.catch(() => undefined);
      enqueued.push({ request, appName: meta.appName, resolve, reject });
      return { id: `approval-${enqueued.length}`, result };
    }),
    decode: p.decode ?? (async () => ({ requestId: "x", title: "", lines: [], balanceChanges: [], simulated: false, blind: true, warnings: [], networkId: "" })),
    kv: {
      get: async <T,>(k: string) => store.get(k) as T | undefined,
      set: async <T,>(k: string, v: T) => void store.set(k, structuredClone(v)),
    },
    usd: (k: string) => p.usd?.[k],
    fetch: p.fetch,
    now: p.now,
  };
  return host;
}

/** Let queued promise chains (result → finish → next enqueue) run. */
export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export function mirrorAccount(id: string, extra: Record<string, unknown> = {}) {
  return {
    account: id,
    evm_address: null,
    alias: null,
    balance: { balance: 12_345_000_000, timestamp: "1", tokens: [] },
    max_automatic_token_associations: 0,
    staked_node_id: null,
    staked_account_id: null,
    decline_reward: false,
    pending_reward: 0,
    ...extra,
  };
}
