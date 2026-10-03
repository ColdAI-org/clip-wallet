import type { StarkCall } from "./describe.js";
import { padAddress, toHexFelt } from "./util.js";

/**
 * Helpers for wallet-built AVNU swaps (Clip Wallet features). AVNU Exchange `multi_route_swap`
 * (avnu-labs/avnu-contracts-v2 `src/exchange.cairo`, read 2026-10-03):
 *
 *   fn multi_route_swap(sell_token_address: ContractAddress, sell_token_amount: u256,
 *     buy_token_address: ContractAddress, buy_token_amount: u256, buy_token_min_amount: u256,
 *     beneficiary: ContractAddress, integrator_fee_amount_bps: u128, integrator_fee_recipient: ContractAddress,
 *     routes: Array<Route>) -> bool
 *
 * Serialized (Cairo Serde): [sell, sell.low, sell.high, buy, buyAmt.low, buyAmt.high, min.low, min.high,
 * beneficiary, fee_bps, fee_recipient, routes_len, …routes]. Routes are opaque here: the exchange pulls exactly
 * `sell_token_amount` from the caller and reverts unless the beneficiary receives at least `buy_token_min_amount`.
 *
 * Exchange addresses: avnu-contracts-v2 README ("Mainnet | Sepolia").
 */
export const AVNU_EXCHANGE = {
  SN_MAIN: "0x04270219d365d6b017231b52e92b3fb5d7c8378b05e9abc97724537a80e93b0f",
  SN_SEPOLIA: "0x02c56e8b00dbe2a71e57472685378fc8988bba947e9a99b26a00fade2b4fe7c2",
} as const;

const U128 = 1n << 128n;
const u256 = (low: string, high: string) => BigInt(low) + BigInt(high) * U128;

export interface MultiRouteSwap {
  sellToken: string;
  sellAmount: bigint;
  buyToken: string;
  buyAmount: bigint;
  buyMinAmount: bigint;
  beneficiary: string;
  integratorFeeBps: bigint;
  integratorFeeRecipient: string;
  routesLen: number;
}

/** Reads the fixed head of `multi_route_swap` calldata. Throws on anything shorter or malformed. */
export function parseMultiRouteSwap(calldata: readonly string[]): MultiRouteSwap {
  if (calldata.length < 12) throw new Error("calldata too short for multi_route_swap");
  const c = calldata.map((x) => BigInt(x).toString());
  for (const i of [2, 5, 7]) if (BigInt(c[i]!) >= U128 || BigInt(c[i - 1]!) >= U128) throw new Error("bad u256");
  return {
    sellToken: padAddress(c[0]!),
    sellAmount: u256(c[1]!, c[2]!),
    buyToken: padAddress(c[3]!),
    buyAmount: u256(c[4]!, c[5]!),
    buyMinAmount: u256(c[6]!, c[7]!),
    beneficiary: padAddress(c[8]!),
    integratorFeeBps: BigInt(c[9]!),
    integratorFeeRecipient: padAddress(c[10]!),
    routesLen: Number(BigInt(c[11]!)),
  };
}

/** ERC-20 `approve(spender, amount: u256)` for exactly `amount`. */
export function approveCall(token: string, spender: string, amount: bigint): StarkCall {
  if (amount <= 0n || amount >= U128 * U128) throw new Error("approve amount out of range");
  return { contractAddress: padAddress(token), entrypoint: "approve", calldata: [padAddress(spender), toHexFelt(amount % U128), toHexFelt(amount / U128)] };
}

/** `approve` calldata back to its parts. */
export function parseApprove(calldata: readonly string[]): { spender: string; amount: bigint } {
  if (calldata.length !== 3) throw new Error("approve takes 3 felts");
  return { spender: padAddress(calldata[0]!), amount: u256(calldata[1]!, calldata[2]!) };
}

export const sameStarknetAddress = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
};
