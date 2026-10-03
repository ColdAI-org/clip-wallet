/**
 * Ref Finance (now branded Rhea) v2 exchange: wallet-built swap transactions and their swap message.
 *
 * Contracts (ref-finance/ref-sdk src/constant.ts; `metadata` view checked 2026-10-03: mainnet 1.9.20 with
 * wnear_id "wrap.near", testnet 1.9.19 with wnear_id "wrap.testnet", both state "Running"):
 *   mainnet v2.ref-finance.near, testnet ref-finance-101.testnet.
 *
 * A swap is an "instant swap" (ref-finance/ref-ui src/services/swap.ts swapFromServer; ref-sdk
 * src/v1-swap/instantSwap.ts): the input token's `ft_transfer_call` to the exchange with
 *   msg = JSON { force: 0, actions: [{ pool_id, token_in, token_out, amount_in?, min_amount_out }], skip_unwrap_near? }
 * 1 yoctoNEAR attached, 300 Tgas. The account doesn't need to be registered with the exchange. Each action's
 * `min_amount_out` is enforced by the exchange (the whole call reverts and the tokens come back otherwise).
 * An action without `amount_in` swaps the previous action's output (multi-hop). When the output is wNEAR,
 * `skip_unwrap_near: false` makes the exchange unwrap it and send native NEAR (as ref-ui does for NEAR).
 *
 * Before the swap the account must be registered (NEP-145 storage_deposit) with the output token, and with
 * wrap.near when NEAR is wrapped first (`near_deposit`, which needs registration too).
 */
import type { NetworkId } from "@clip-wallet/core";
import { type NearNetworkName, WRAP_CONTRACTS, networkName } from "./networks.js";

const TGAS = 10n ** 12n;

export const REF_CONTRACTS: Record<NearNetworkName, string> = { mainnet: "v2.ref-finance.near", testnet: "ref-finance-101.testnet" };
export const REF_SWAP_GAS = 300n * TGAS;
export const WRAP_GAS = 10n * TGAS;
export const REGISTER_GAS = 30n * TGAS;

export interface RefSwapAction {
  pool_id: number;
  token_in: string;
  token_out: string;
  /** Present on the first hop of each route; later hops swap the previous hop's output. */
  amount_in?: string;
  min_amount_out: string;
}

export interface RefSwapMsg {
  force?: number;
  actions: RefSwapAction[];
  skip_unwrap_near?: boolean;
}

const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UINT = /^\d+$/;

export function refContract(networkId: NetworkId): string | null {
  const n = networkName(networkId);
  return n ? REF_CONTRACTS[n] : null;
}

export function isRefContract(networkId: NetworkId, accountId: string): boolean {
  return refContract(networkId) === accountId;
}

/** Parses an exchange swap message; null for anything that isn't exactly a list of well-formed swap actions. */
export function parseRefSwapMsg(msg: unknown): RefSwapMsg | null {
  if (typeof msg !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(msg);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.actions) || !o.actions.length) return null;
  const actions: RefSwapAction[] = [];
  for (const a of o.actions) {
    if (!a || typeof a !== "object") return null;
    const x = a as Record<string, unknown>;
    const pool = typeof x.pool_id === "string" && UINT.test(x.pool_id) ? Number(x.pool_id) : x.pool_id;
    if (typeof pool !== "number" || !Number.isSafeInteger(pool) || pool < 0) return null;
    if (typeof x.token_in !== "string" || !ACCOUNT.test(x.token_in) || typeof x.token_out !== "string" || !ACCOUNT.test(x.token_out)) return null;
    if (typeof x.min_amount_out !== "string" || !UINT.test(x.min_amount_out)) return null;
    if (x.amount_in !== undefined && (typeof x.amount_in !== "string" || !UINT.test(x.amount_in))) return null;
    const act: RefSwapAction = { pool_id: pool, token_in: x.token_in, token_out: x.token_out, min_amount_out: x.min_amount_out };
    if (x.amount_in !== undefined) act.amount_in = x.amount_in as string;
    actions.push(act);
  }
  const out: RefSwapMsg = { actions };
  if (typeof o.force === "number") out.force = o.force;
  if (typeof o.skip_unwrap_near === "boolean") out.skip_unwrap_near = o.skip_unwrap_near;
  return out;
}

/**
 * Checks a route (for example from Ref's smart router) before the wallet signs it: every route starts with
 * `tokenIn` and an `amount_in`, each later hop continues from the previous hop's output, every route ends in
 * `tokenOut` with a positive `min_amount_out`, and the routes' inputs add up to `amountIn`.
 * Returns the guaranteed output (sum of the routes' minimums), or a plain reason why not.
 */
export function checkRefRoute(actions: RefSwapAction[], tokenIn: string, tokenOut: string, amountIn: bigint): { minOut: bigint } | { error: string } {
  if (!actions.length) return { error: "The route is empty." };
  if (tokenIn === tokenOut) return { error: "The route swaps a token for itself." };
  let total = 0n;
  let minOut = 0n;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const startsRoute = a.amount_in !== undefined;
    if (i === 0 && !startsRoute) return { error: "The route doesn't say how much it swaps." };
    if (startsRoute) {
      if (a.token_in !== tokenIn) return { error: "The route starts from a different token." };
      if (BigInt(a.amount_in!) <= 0n) return { error: "The route swaps nothing." };
      total += BigInt(a.amount_in!);
    } else if (a.token_in !== actions[i - 1]!.token_out) return { error: "The route's hops don't connect." };
    const last = i === actions.length - 1 || actions[i + 1]!.amount_in !== undefined;
    if (last) {
      if (a.token_out !== tokenOut) return { error: "The route ends in a different token." };
      if (BigInt(a.min_amount_out) <= 0n) return { error: "The route has no minimum output." };
      minOut += BigInt(a.min_amount_out);
    } else if (a.token_out === tokenOut) return { error: "The route ends early." };
  }
  if (total !== amountIn) return { error: "The route swaps a different amount." };
  return { minOut };
}

export interface RefSwapPlan {
  networkId: NetworkId;
  /** NEP-141 contract sold, or null for native NEAR (wrapped first). */
  sell: string | null;
  /** NEP-141 contract bought, or null for native NEAR (the exchange unwraps wNEAR). */
  buy: string | null;
  /** Base units of the sold token. */
  amountIn: string;
  actions: RefSwapAction[];
  /** NEP-145 registrations to pay first, with the deposit for each (storage_balance_bounds.min). */
  register: { contract: string; deposit: string }[];
}

/** One transaction in the shape near_signAndSendTransactions accepts (wallet-selector actions). */
export interface RefTx {
  receiverId: string;
  actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
}

function fc(methodName: string, args: Record<string, unknown>, gas: bigint, deposit: bigint | string) {
  return { type: "FunctionCall" as const, params: { methodName, args, gas: gas.toString(), deposit: deposit.toString() } };
}

/**
 * Builds the transactions for a Ref swap, in order: registration with the output token (if needed), then one
 * transaction to the input token: [register with wrap.near, near_deposit] when selling NEAR, and the
 * ft_transfer_call to the exchange with the swap message. `signerId` is the account the tokens belong to.
 */
export function refSwapTransactions(plan: RefSwapPlan, signerId: string): RefTx[] {
  const n = networkName(plan.networkId);
  if (!n) throw new Error("not a NEAR network");
  const ref = REF_CONTRACTS[n];
  const wrap = WRAP_CONTRACTS[n];
  const tokenIn = plan.sell ?? wrap;
  const tokenOut = plan.buy ?? wrap;
  const amount = BigInt(plan.amountIn);
  const checked = checkRefRoute(plan.actions, tokenIn, tokenOut, amount);
  if ("error" in checked) throw new Error(checked.error);
  const txs: RefTx[] = [];
  const reg = (contract: string) => plan.register.find((r) => r.contract === contract);
  // Registration with the output token goes first (unless it's the same contract as the input, handled below).
  const outReg = reg(tokenOut);
  if (outReg && tokenOut !== tokenIn) txs.push({ receiverId: tokenOut, actions: [fc("storage_deposit", { account_id: signerId, registration_only: true }, REGISTER_GAS, outReg.deposit)] });
  const swap: RefTx = { receiverId: tokenIn, actions: [] };
  const inReg = reg(tokenIn);
  if (inReg) swap.actions.push(fc("storage_deposit", { account_id: signerId, registration_only: true }, REGISTER_GAS, inReg.deposit));
  if (plan.sell === null) swap.actions.push(fc("near_deposit", {}, WRAP_GAS, amount));
  const msg: RefSwapMsg = { force: 0, actions: plan.actions };
  if (tokenOut === wrap) msg.skip_unwrap_near = plan.buy !== null;
  swap.actions.push(fc("ft_transfer_call", { receiver_id: ref, amount: amount.toString(), msg: JSON.stringify(msg) }, REF_SWAP_GAS, 1n));
  txs.push(swap);
  return txs;
}
