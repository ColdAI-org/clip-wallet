/** Read helpers on top of rpc(): token metadata, fee estimation, gas. */
import type { AssetRef, ChainContext } from "@clip-wallet/core";
import { type Hex, decodeFunctionResult, encodeFunctionData, erc20Abi, hexToBigInt, toHex } from "viem";
import { specFor } from "./networks.js";
import { RpcError, rpc } from "./rpc.js";
import { curatedToken, curatedAsset, tokenAsset } from "./tokens.js";

export const chainIdOf = (ctx: ChainContext): number => {
  const id = ctx.network.chainId ?? Number(ctx.network.id.split(":")[1]);
  if (!Number.isSafeInteger(id)) throw new Error(`not an EVM network: ${ctx.network.id}`);
  return id;
};

export async function ethCall(ctx: ChainContext, to: string, data: Hex): Promise<Hex> {
  return rpc<Hex>(ctx.network, ctx.fetch, "eth_call", [{ to, data }, "latest"]);
}

async function tryRead<T>(ctx: ChainContext, to: string, fn: "symbol" | "name" | "decimals"): Promise<T | undefined> {
  try {
    const out = await ethCall(ctx, to, encodeFunctionData({ abi: erc20Abi, functionName: fn }));
    if (!out || out === "0x") return undefined;
    return decodeFunctionResult({ abi: erc20Abi, functionName: fn, data: out }) as T;
  } catch {
    return undefined;
  }
}

/** Token metadata: curated list first, then the contract itself. `isToken` is false when decimals() fails (likely an NFT). */
export async function tokenMeta(ctx: ChainContext, address: string): Promise<{ asset: AssetRef; isToken: boolean }> {
  const chainId = chainIdOf(ctx);
  const c = curatedToken(chainId, address);
  if (c) return { asset: curatedAsset(c), isToken: true };
  const [symbol, name, decimals] = await Promise.all([
    tryRead<string>(ctx, address, "symbol"),
    tryRead<string>(ctx, address, "name"),
    tryRead<number>(ctx, address, "decimals"),
  ]);
  const meta: { symbol?: string; name?: string; decimals?: number } = {};
  if (symbol !== undefined) meta.symbol = symbol;
  if (name !== undefined) meta.name = name;
  if (decimals !== undefined) meta.decimals = Number(decimals);
  return { asset: tokenAsset(ctx.network.id, chainId, address, meta), isToken: decimals !== undefined };
}

export interface FeeQuote {
  type: "eip1559" | "legacy";
  /** eip1559 */
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /** legacy */
  gasPrice?: bigint;
  /** What we expect a unit of gas to cost now (for the displayed fee). */
  expectedPerGas: bigint;
}

const GWEI = 1_000_000_000n;

/**
 * EIP-1559 when the latest block has a base fee (and the network is not flagged legacy):
 * maxFee = 2 × baseFee + tip, tip from eth_maxPriorityFeePerGas (fallback: gasPrice − baseFee, floor 0).
 * Otherwise legacy gasPrice (+10%).
 */
export async function quoteFees(ctx: ChainContext): Promise<FeeQuote> {
  const spec = specFor(ctx.network.id);
  const block = await rpc<{ baseFeePerGas?: Hex } | null>(ctx.network, ctx.fetch, "eth_getBlockByNumber", ["latest", false]);
  const gasPrice = hexToBigInt(await rpc<Hex>(ctx.network, ctx.fetch, "eth_gasPrice"));
  if (!spec?.legacyGas && block?.baseFeePerGas !== undefined) {
    const base = hexToBigInt(block.baseFeePerGas);
    let tip: bigint;
    try {
      tip = hexToBigInt(await rpc<Hex>(ctx.network, ctx.fetch, "eth_maxPriorityFeePerGas"));
    } catch {
      tip = gasPrice > base ? gasPrice - base : 0n;
    }
    if (tip === 0n && base === 0n) tip = GWEI / 1000n; // keep a non-zero tip on zero-fee testnets
    return { type: "eip1559", maxFeePerGas: base * 2n + tip, maxPriorityFeePerGas: tip, expectedPerGas: base + tip };
  }
  const gp = (gasPrice * 11n) / 10n;
  return { type: "legacy", gasPrice: gp, expectedPerGas: gasPrice };
}

export interface CallLike {
  from: string;
  to?: string;
  value?: Hex;
  data?: Hex;
}

/** eth_estimateGas with 20% headroom. Throws RpcError when the call reverts. */
export async function estimateGas(ctx: ChainContext, call: CallLike): Promise<bigint> {
  const est = hexToBigInt(await rpc<Hex>(ctx.network, ctx.fetch, "eth_estimateGas", [call]));
  return (est * 12n) / 10n;
}

export const toQuantity = (v: bigint | number): Hex => toHex(v);

export { RpcError };
