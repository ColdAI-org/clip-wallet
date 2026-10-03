import type { Account, AssetRef, ChainContext, DappRequest, DecodedRequest, Network, Nft, TokenBalance } from "@clip-wallet/core";
import { HEDERA_TESTNET, aliasAddress, clearMirrorCache } from "@clip-wallet/chains-hedera";
import { SOLANA_DEVNET } from "@clip-wallet/chains-solana";
import { vi } from "vitest";
import type { HistoryEntry, SecurityHost } from "../src/host.js";

/** Public keys/addresses only. No private key exists anywhere in this package. */
export const HEDERA_PUB = "037601488ece3332e657cb928cd949745319f6b4b741db300125c61e9a6ac014a4";
export const ME_HEDERA = "0.0.1001";
export const ME_SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const ME_EVM = "0x1111111111111111111111111111111111111111";

export const SEPOLIA: Network = {
  id: "eip155:11155111",
  family: "evm",
  name: "Ethereum Sepolia",
  nativeAsset: { key: "eth-testnet", symbol: "ETH", name: "Sepolia Ether", decimals: 18, networkId: "eip155:11155111" },
  testnet: true,
  rpcUrls: ["https://sepolia.rpc.test"],
  explorerUrl: "https://sepolia.etherscan.io",
  indexerUrl: "https://eth-sepolia.blockscout.test/api/v2",
  chainId: 11155111,
};
/** Same network without an indexer: forces the eth_getLogs fallback. */
export const SEPOLIA_NO_INDEXER: Network = { ...SEPOLIA, indexerUrl: undefined };
export const DEVNET: Network = { ...SOLANA_DEVNET, rpcUrls: ["https://devnet.rpc.test"] };
export const HEDERA = HEDERA_TESTNET;
export const APTOS: Network = {
  id: "aptos:testnet",
  family: "aptos",
  name: "Aptos Testnet",
  nativeAsset: { key: "apt", symbol: "APT", name: "Aptos", decimals: 8, networkId: "aptos:testnet" },
  testnet: true,
  rpcUrls: ["https://aptos.rpc.test"],
  explorerUrl: "https://explorer.aptoslabs.com",
};

export function accountFor(network: Network): Account {
  if (network.family === "hedera") {
    return { id: "hedera:0", family: "hedera", index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: HEDERA_PUB, address: aliasAddress(HEDERA_PUB), hederaAccountId: ME_HEDERA };
  }
  if (network.family === "solana") {
    return { id: "solana:0", family: "solana", index: 0, curve: "ed25519", derivationPath: "m/44'/501'/0'/0'", publicKey: "00".repeat(32), address: ME_SOL };
  }
  return { id: `${network.family}:0`, family: network.family, index: 0, curve: "secp256k1", derivationPath: "m/44'/60'/0'/0/0", publicKey: "02".padEnd(66, "1"), address: ME_EVM };
}

type Body = unknown | ((url: string, init?: RequestInit) => unknown);
export type Route = [RegExp, Body] | [RegExp, Body, number];

/** Mocked fetch. JSON-RPC bodies go to `rpc` handlers by method; then URL routes (first match wins); else 404. */
export function mockFetch(routes: Route[], rpc: Record<string, (params: unknown[], url: string) => unknown> = {}) {
  const calls: { url: string; init?: RequestInit; method?: string; params?: unknown[]; body?: string }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let parsed: { id?: number; method?: string; params?: unknown[] } | null = null;
    try {
      parsed = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      parsed = null;
    }
    calls.push({ url, init, method: parsed?.method, params: parsed?.params, body: init?.body ? String(init.body) : undefined });
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
        if (typeof v === "string") return new Response(v, { status: status ?? 200 });
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

export function fakeHost(p: {
  networks: Network[];
  fetch: typeof fetch;
  assets?: AssetRef[];
  balances?: TokenBalance[];
  nfts?: Nft[];
  addressBook?: { address: string; name?: string }[];
  history?: HistoryEntry[];
  now?: () => number;
}): SecurityHost & { enqueued: Enqueued[]; store: Map<string, unknown> } {
  clearMirrorCache();
  const enqueued: Enqueued[] = [];
  const store = new Map<string, unknown>();
  return {
    enqueued,
    store,
    networks: () => p.networks,
    assets: () => p.assets ?? p.networks.map((n) => n.nativeAsset),
    ctx: async (networkId: string): Promise<ChainContext> => {
      const network = p.networks.find((n) => n.id === networkId)!;
      return { network, account: accountFor(network), fetch: p.fetch };
    },
    balances: async () => p.balances ?? [],
    nfts: async () => p.nfts ?? [],
    addressBook: async () => p.addressBook ?? [],
    history: async () => p.history ?? [],
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
    decode: async (): Promise<DecodedRequest> => ({ requestId: "x", title: "", lines: [], balanceChanges: [], simulated: false, blind: true, warnings: [], networkId: "" }),
    kv: {
      get: async <T,>(k: string) => store.get(k) as T | undefined,
      set: async <T,>(k: string, v: T) => void store.set(k, structuredClone(v)),
    },
    usd: () => undefined,
    fetch: p.fetch,
    now: p.now,
  };
}

export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

export function decoded(lines: { label: string; value: string }[] = [], extra: Partial<DecodedRequest> = {}): DecodedRequest {
  return { requestId: "r1", title: "Do a thing", lines, balanceChanges: [], simulated: true, blind: false, warnings: [], networkId: SEPOLIA.id, ...extra };
}

export function dappRequest(p: Partial<DappRequest> = {}): DappRequest {
  return { id: "r1", origin: "https://app.example.org", via: "injected", family: "evm", networkId: SEPOLIA.id, method: "eth_sendTransaction", params: [{ from: ME_EVM, to: "0x2222222222222222222222222222222222222222", value: "0x0", data: "0x" }], ...p };
}
