import type { AssetRef, NetworkId } from "@clip-wallet/core";
import { hash, shortString } from "starknet";
import { ETH_ADDRESS, STRK_ADDRESS, chainOf, strkAsset, type StarknetChain } from "./networks.js";
import type { StarknetRpc } from "./rpc.js";
import { padAddress } from "./util.js";

/**
 * Curated ERC-20s. Symbols and decimals checked on-chain (starknet_call symbol/decimals) on 2026-10-03.
 * USDC addresses from developers.circle.com/stablecoins/usdc-contract-addresses (Circle-issued, key "usdc";
 * testnet USDC shares it, as in chains-evm). StarkGate's older bridged USDC is "usdc.e", bridged.
 */
export interface CuratedToken {
  chain: StarknetChain;
  address: string;
  key: string;
  symbol: string;
  name: string;
  decimals: number;
  bridged?: boolean;
}

const both = (t: Omit<CuratedToken, "chain">): CuratedToken[] => [
  { ...t, chain: "SN_MAIN" },
  { ...t, chain: "SN_SEPOLIA" },
];

export const CURATED_TOKENS: CuratedToken[] = [
  ...both({ address: STRK_ADDRESS, key: "strk", symbol: "STRK", name: "Starknet Token", decimals: 18 }),
  // StarkGate ETH merges with the EVM chains' ETH: "eth" on mainnet, "eth-testnet" on Sepolia (chains-evm's key).
  { chain: "SN_MAIN", address: ETH_ADDRESS, key: "eth", symbol: "ETH", name: "Ether", decimals: 18 },
  { chain: "SN_SEPOLIA", address: ETH_ADDRESS, key: "eth-testnet", symbol: "ETH", name: "Ether", decimals: 18 },
  { chain: "SN_MAIN", address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb", key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { chain: "SN_SEPOLIA", address: "0x0512feac6339ff7889822cb5aa2a86c848e9d392bb0e3e237c008674feed8343", key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6 },
  {
    chain: "SN_MAIN",
    address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
    key: "usdc.e",
    symbol: "USDC.e",
    name: "Bridged USDC (StarkGate)",
    decimals: 6,
    bridged: true,
  },
];

const norm = (a: string) => padAddress(a).toLowerCase();

export function curatedTokens(networkId: NetworkId): CuratedToken[] {
  const c = chainOf(networkId);
  return c ? CURATED_TOKENS.filter((t) => t.chain === c) : [];
}

export function curatedToken(networkId: NetworkId, address: string): CuratedToken | undefined {
  const a = norm(address);
  return curatedTokens(networkId).find((t) => norm(t.address) === a);
}

export function curatedAsset(networkId: NetworkId, t: CuratedToken): AssetRef {
  if (t.key === "strk") return strkAsset(networkId);
  const a: AssetRef = { key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId, address: norm(t.address) };
  if (t.bridged) a.bridged = true;
  return a;
}

/** The asset for a token contract: curated first, else read symbol/decimals on-chain (cached). */
const metaCache = new Map<string, AssetRef | null>();
export function clearTokenCache(): void {
  metaCache.clear();
}

/** Felt short string, or a Cairo ByteArray ([data_len, ...31-byte words, pending_word, pending_len]). */
export function decodeStringResult(felts: string[]): string | null {
  try {
    if (felts.length === 1) return shortString.decodeShortString(felts[0]!);
    if (felts.length >= 3) {
      const n = Number(BigInt(felts[0]!));
      if (felts.length !== n + 3) return null;
      let s = "";
      for (let i = 1; i <= n; i++) s += shortString.decodeShortString(felts[i]!);
      const pendingLen = Number(BigInt(felts[n + 2]!));
      if (pendingLen > 0) s += shortString.decodeShortString(felts[n + 1]!);
      return s;
    }
  } catch {
    /* not a string */
  }
  return null;
}

export async function tokenAsset(rpc: StarknetRpc, networkId: NetworkId, address: string): Promise<AssetRef | null> {
  if (BigInt(address) === BigInt(STRK_ADDRESS)) return strkAsset(networkId);
  const t = curatedToken(networkId, address);
  if (t) return curatedAsset(networkId, t);
  const key = `${networkId}:${norm(address)}`;
  if (metaCache.has(key)) return metaCache.get(key)!;
  let out: AssetRef | null = null;
  try {
    const [sym, dec] = await Promise.all([
      rpc.call<string[]>("starknet_call", [{ contract_address: norm(address), entry_point_selector: hash.getSelectorFromName("symbol"), calldata: [] }, "latest"]),
      rpc.call<string[]>("starknet_call", [{ contract_address: norm(address), entry_point_selector: hash.getSelectorFromName("decimals"), calldata: [] }, "latest"]),
    ]);
    const symbol = decodeStringResult(sym);
    const decimals = dec[0] !== undefined ? Number(BigInt(dec[0])) : NaN;
    if (symbol && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
      // Unknown tokens never merge with anything; a look-alike symbol is flagged spam.
      const lookalike = CURATED_TOKENS.some((c) => c.symbol.toUpperCase() === symbol.toUpperCase());
      out = { key: `starknet:${norm(address)}`, symbol, name: symbol, decimals, networkId, address: norm(address) };
      if (lookalike) out.spam = true;
    }
  } catch {
    out = null;
  }
  metaCache.set(key, out);
  return out;
}

export function tokenAssetKey(networkId: NetworkId, address: string): string {
  const t = curatedToken(networkId, address);
  return t ? t.key : `starknet:${norm(address)}`;
}
