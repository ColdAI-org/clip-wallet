/**
 * Known swap programs, decoded from their published instruction layouts so a swap isn't "blind".
 * The amounts here are what the user asked for (exact in / minimum out, or maximum in / exact out); the
 * real result comes from simulation when available.
 *
 * Verified sources (fetched 2026-10-03):
 *  - Jupiter Aggregator v6 `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`: IDL in github.com/jup-ag/instruction-parser
 *    src/idl/jupiter.ts (route, routeWithTokenLedger, sharedAccountsRoute, sharedAccountsRouteWithTokenLedger,
 *    exactOutRoute, sharedAccountsExactOutRoute) and github.com/jup-ag/jupiter-cpi idl.json. Args end with
 *    `… in_amount|out_amount u64, quoted_* u64, slippage_bps u16, platform_fee_bps u8`, so the fixed tail is read
 *    from the end without parsing the variable-length route plan. Mainnet only (no devnet deployment).
 *  - Raydium AMM v4 `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` (devnet `DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav`):
 *    github.com/raydium-io/raydium-amm program/src/instruction.rs — tag 9 SwapBaseIn(amount_in, minimum_amount_out),
 *    11 SwapBaseOut(max_amount_in, amount_out), 16/17 the V2 variants; user source/destination/owner are the
 *    last three accounts (17/18 accounts for v1, 8 for v2).
 *  - Raydium CPMM `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` (devnet `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb`):
 *    raydium-cp-swap lib.rs swap_base_input(amount_in, minimum_amount_out) / swap_base_output(max_amount_in, amount_out);
 *    accounts payer, authority, amm_config, pool_state, input_token_account, output_token_account, input_vault,
 *    output_vault, input_token_program, output_token_program, input_token_mint, output_token_mint, observation_state.
 *  - Raydium CLMM `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK` (devnet `DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH`):
 *    raydium-clmm lib.rs swap / swap_v2(amount, other_amount_threshold, sqrt_price_limit_x64 u128, is_base_input bool);
 *    SwapSingle accounts payer, amm_config, pool_state, input_token_account, output_token_account, …;
 *    SwapSingleV2 adds input_vault_mint (11) and output_vault_mint (12).
 *  - Orca Whirlpool `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` (same id on devnet): orca-so/whirlpools
 *    programs/whirlpool lib.rs swap / swap_v2(amount, other_amount_threshold, sqrt_price_limit u128,
 *    amount_specified_is_input bool, a_to_b bool[, remaining_accounts_info]); Swap accounts token_program,
 *    token_authority, whirlpool, token_owner_account_a, token_vault_a, token_owner_account_b, token_vault_b, …;
 *    SwapV2 accounts token_program_a, token_program_b, memo_program, token_authority, whirlpool, token_mint_a,
 *    token_mint_b, token_owner_account_a, token_vault_a, token_owner_account_b, token_vault_b, ….
 * Anchor discriminators are sha256("global:<snake_name>")[0..8] (checked in test/swaps.test.ts).
 * Not decoded (stay blind): two-hop Whirlpool swaps, Raydium router, liquidity and admin instructions.
 */
import type { Instruction } from "@solana/kit";

export const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const RAYDIUM_AMM_V4 = ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav"];
export const RAYDIUM_CPMM = ["CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"];
export const RAYDIUM_CLMM = ["CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"];
export const ORCA_WHIRLPOOL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export const SWAP_PROGRAMS = new Set([JUPITER_V6, ...RAYDIUM_AMM_V4, ...RAYDIUM_CPMM, ...RAYDIUM_CLMM, ORCA_WHIRLPOOL]);

export const DISCRIMINATORS = {
  route: "e517cb977ae3ad2a",
  routeWithTokenLedger: "96564774a75d0e68",
  sharedAccountsRoute: "c1209b3341d69c81",
  sharedAccountsRouteWithTokenLedger: "e6798f50779f6aaa",
  exactOutRoute: "d033ef977b2bed5c",
  sharedAccountsExactOutRoute: "b0d169a89a7d453e",
  swap: "f8c69e91e17587c8",
  swapV2: "2b04ed0b1ac91e62",
  swapBaseInput: "8fbe5adac41e33de",
  swapBaseOutput: "37d96256a34ab4ad",
} as const;

export type Venue = "Jupiter" | "Raydium" | "Orca";

export interface SwapIntent {
  venue: Venue;
  /** Who must sign for the input (the user, for a normal swap). */
  authority: string;
  /** User token account the input leaves from. */
  sourceAccount: string | null;
  sourceMint: string | null;
  /** Token account the output lands in. */
  destinationAccount: string | null;
  destinationMint: string | null;
  /** Exact input (exactIn) or the most that can be taken (exactOut). null = decided on-chain (token ledger). */
  amountIn: bigint | null;
  /** Least that will be received (exactIn) or the exact output (exactOut). */
  amountOut: bigint | null;
  exactIn: boolean;
  slippageBps: number | null;
  /** Accounts worth prefetching (token accounts and mints). */
  lookups: string[];
}

type Bytes = { readonly [i: number]: number; readonly length: number };

const hex8 = (d: Bytes) => Array.from({ length: Math.min(8, d.length) }, (_, i) => (d[i] ?? 0).toString(16).padStart(2, "0")).join("");
const u64 = (d: Bytes, at: number): bigint => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i] ?? 0);
  return v;
};
const u16 = (d: Bytes, at: number) => (d[at] ?? 0) | ((d[at + 1] ?? 0) << 8);

function acc(ix: Instruction, i: number): string | null {
  const a = ix.accounts?.[i]?.address;
  return a ? String(a) : null;
}

/** Jupiter "optional account" = the program id itself when absent (Anchor convention). */
function opt(ix: Instruction, i: number): string | null {
  const a = acc(ix, i);
  return a && a !== JUPITER_V6 ? a : null;
}

function nonNull(xs: (string | null)[]): string[] {
  return xs.filter((x): x is string => !!x);
}

function jupiter(ix: Instruction, d: Bytes): SwapIntent | null {
  const disc = hex8(d);
  const n = d.length;
  // Fixed tail: [amountA u64][amountB u64][slippage u16][platform fee u8] (or one amount for token-ledger variants)
  const tail2 = () => ({ a: u64(d, n - 19), b: u64(d, n - 11), slip: u16(d, n - 3) });
  const tail1 = () => ({ b: u64(d, n - 11), slip: u16(d, n - 3) });
  switch (disc) {
    case DISCRIMINATORS.route:
    case DISCRIMINATORS.routeWithTokenLedger: {
      if (n < 8 + 4 + (disc === DISCRIMINATORS.route ? 19 : 11)) return null;
      const ledger = disc === DISCRIMINATORS.routeWithTokenLedger;
      const t = ledger ? { a: null, ...tail1() } : tail2();
      const userDest = acc(ix, 3);
      return {
        venue: "Jupiter",
        authority: acc(ix, 1) ?? "",
        sourceAccount: acc(ix, 2),
        sourceMint: null,
        destinationAccount: opt(ix, 4) ?? userDest,
        destinationMint: acc(ix, 5),
        amountIn: t.a,
        amountOut: t.b,
        exactIn: true,
        slippageBps: t.slip,
        lookups: nonNull([acc(ix, 2), userDest, opt(ix, 4), acc(ix, 5)]),
      };
    }
    case DISCRIMINATORS.sharedAccountsRoute:
    case DISCRIMINATORS.sharedAccountsRouteWithTokenLedger: {
      const ledger = disc === DISCRIMINATORS.sharedAccountsRouteWithTokenLedger;
      if (n < 8 + 1 + 4 + (ledger ? 11 : 19)) return null;
      const t = ledger ? { a: null, ...tail1() } : tail2();
      return {
        venue: "Jupiter",
        authority: acc(ix, 2) ?? "",
        sourceAccount: acc(ix, 3),
        sourceMint: acc(ix, 7),
        destinationAccount: acc(ix, 6),
        destinationMint: acc(ix, 8),
        amountIn: t.a,
        amountOut: t.b,
        exactIn: true,
        slippageBps: t.slip,
        lookups: nonNull([acc(ix, 3), acc(ix, 6), acc(ix, 7), acc(ix, 8)]),
      };
    }
    case DISCRIMINATORS.exactOutRoute: {
      if (n < 8 + 4 + 19) return null;
      const t = tail2(); // a = out_amount, b = quoted_in_amount
      const userDest = acc(ix, 3);
      return {
        venue: "Jupiter",
        authority: acc(ix, 1) ?? "",
        sourceAccount: acc(ix, 2),
        sourceMint: acc(ix, 5),
        destinationAccount: opt(ix, 4) ?? userDest,
        destinationMint: acc(ix, 6),
        // Jupiter caps the input at quoted_in × (1 + slippage).
        amountIn: (t.b * BigInt(10_000 + t.slip)) / 10_000n,
        amountOut: t.a,
        exactIn: false,
        slippageBps: t.slip,
        lookups: nonNull([acc(ix, 2), userDest, opt(ix, 4), acc(ix, 5), acc(ix, 6)]),
      };
    }
    case DISCRIMINATORS.sharedAccountsExactOutRoute: {
      if (n < 8 + 1 + 4 + 19) return null;
      const t = tail2();
      return {
        venue: "Jupiter",
        authority: acc(ix, 2) ?? "",
        sourceAccount: acc(ix, 3),
        sourceMint: acc(ix, 7),
        destinationAccount: acc(ix, 6),
        destinationMint: acc(ix, 8),
        amountIn: (t.b * BigInt(10_000 + t.slip)) / 10_000n,
        amountOut: t.a,
        exactIn: false,
        slippageBps: t.slip,
        lookups: nonNull([acc(ix, 3), acc(ix, 6), acc(ix, 7), acc(ix, 8)]),
      };
    }
  }
  return null;
}

function raydiumAmm(ix: Instruction, d: Bytes): SwapIntent | null {
  const tag = d[0];
  if (d.length < 17 || (tag !== 9 && tag !== 11 && tag !== 16 && tag !== 17)) return null;
  const count = ix.accounts?.length ?? 0;
  const v2 = tag === 16 || tag === 17;
  if (v2 ? count !== 8 : count !== 17 && count !== 18) return null;
  const exactIn = tag === 9 || tag === 16;
  const a = u64(d, 1);
  const b = u64(d, 9);
  const src = acc(ix, count - 3);
  const dst = acc(ix, count - 2);
  return {
    venue: "Raydium",
    authority: acc(ix, count - 1) ?? "",
    sourceAccount: src,
    sourceMint: null,
    destinationAccount: dst,
    destinationMint: null,
    amountIn: a, // base-in: amount_in; base-out: max_amount_in
    amountOut: b, // base-in: minimum_amount_out; base-out: amount_out
    exactIn,
    slippageBps: null,
    lookups: nonNull([src, dst]),
  };
}

function raydiumCpmm(ix: Instruction, d: Bytes): SwapIntent | null {
  const disc = hex8(d);
  if (d.length < 24 || (disc !== DISCRIMINATORS.swapBaseInput && disc !== DISCRIMINATORS.swapBaseOutput)) return null;
  const exactIn = disc === DISCRIMINATORS.swapBaseInput;
  const a = u64(d, 8);
  const b = u64(d, 16);
  return {
    venue: "Raydium",
    authority: acc(ix, 0) ?? "",
    sourceAccount: acc(ix, 4),
    sourceMint: acc(ix, 10),
    destinationAccount: acc(ix, 5),
    destinationMint: acc(ix, 11),
    amountIn: a, // amount_in | max_amount_in
    amountOut: b, // minimum_amount_out | amount_out
    exactIn,
    slippageBps: null,
    lookups: nonNull([acc(ix, 4), acc(ix, 5), acc(ix, 10), acc(ix, 11)]),
  };
}

function raydiumClmm(ix: Instruction, d: Bytes): SwapIntent | null {
  const disc = hex8(d);
  if (d.length < 8 + 8 + 8 + 16 + 1 || (disc !== DISCRIMINATORS.swap && disc !== DISCRIMINATORS.swapV2)) return null;
  const v2 = disc === DISCRIMINATORS.swapV2;
  const amount = u64(d, 8);
  const threshold = u64(d, 16);
  const exactIn = (d[40] ?? 0) !== 0;
  return {
    venue: "Raydium",
    authority: acc(ix, 0) ?? "",
    sourceAccount: acc(ix, 3),
    sourceMint: v2 ? acc(ix, 11) : null,
    destinationAccount: acc(ix, 4),
    destinationMint: v2 ? acc(ix, 12) : null,
    amountIn: exactIn ? amount : threshold,
    amountOut: exactIn ? threshold : amount,
    exactIn,
    slippageBps: null,
    lookups: nonNull([acc(ix, 3), acc(ix, 4), ...(v2 ? [acc(ix, 11), acc(ix, 12)] : [])]),
  };
}

function whirlpool(ix: Instruction, d: Bytes): SwapIntent | null {
  const disc = hex8(d);
  if (d.length < 8 + 8 + 8 + 16 + 2 || (disc !== DISCRIMINATORS.swap && disc !== DISCRIMINATORS.swapV2)) return null;
  const v2 = disc === DISCRIMINATORS.swapV2;
  const amount = u64(d, 8);
  const threshold = u64(d, 16);
  const exactIn = (d[40] ?? 0) !== 0;
  const aToB = (d[41] ?? 0) !== 0;
  const [authI, ownerA, ownerB, mintA, mintB] = v2 ? [3, 7, 9, 5, 6] : [1, 3, 5, -1, -1];
  const inAcc = acc(ix, aToB ? ownerA : ownerB);
  const outAcc = acc(ix, aToB ? ownerB : ownerA);
  const inMint = v2 ? acc(ix, aToB ? mintA : mintB) : null;
  const outMint = v2 ? acc(ix, aToB ? mintB : mintA) : null;
  return {
    venue: "Orca",
    authority: acc(ix, authI) ?? "",
    sourceAccount: inAcc,
    sourceMint: inMint,
    destinationAccount: outAcc,
    destinationMint: outMint,
    amountIn: exactIn ? amount : threshold,
    amountOut: exactIn ? threshold : amount,
    exactIn,
    slippageBps: null,
    lookups: nonNull([inAcc, outAcc, inMint, outMint]),
  };
}

/** Decodes a swap instruction of a known program; null if the program is unknown or the instruction isn't a swap. */
export function decodeSwap(ix: Instruction): SwapIntent | null {
  const prog = String(ix.programAddress);
  if (!SWAP_PROGRAMS.has(prog)) return null;
  const d = (ix.data ?? new Uint8Array()) as Bytes;
  try {
    if (prog === JUPITER_V6) return jupiter(ix, d);
    if (RAYDIUM_AMM_V4.includes(prog)) return raydiumAmm(ix, d);
    if (RAYDIUM_CPMM.includes(prog)) return raydiumCpmm(ix, d);
    if (RAYDIUM_CLMM.includes(prog)) return raydiumClmm(ix, d);
    if (prog === ORCA_WHIRLPOOL) return whirlpool(ix, d);
  } catch {
    return null;
  }
  return null;
}
