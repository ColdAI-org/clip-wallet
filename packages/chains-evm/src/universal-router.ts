/**
 * Uniswap Universal Router: execute(commands, inputs[, deadline]). Each byte of `commands` names an action and the
 * input at the same index holds that action's arguments (ABI-encoded, not calldata). Only the command types whose
 * layout is the same in every Universal Router version (0x00–0x0e) are read; any other command is unreadable, and
 * then so is the whole plan. Layouts: Uniswap universal-router contracts/libraries/Commands.sol and
 * contracts/base/Dispatcher.sol.
 */
import { msg, titled, warning, type ChainContext, type DecodedRequest, type Msg, type Warning } from "@clip-wallet/core";
import { type Hex, decodeAbiParameters, hexToBytes, isAddressEqual, parseAbiParameters, zeroAddress } from "viem";
import { tokenMeta } from "./chain.js";
import { formatAmount, safeChecksum, shortAddress } from "./format.js";
import { appName } from "./tokens.js";

export type RouterStep = Pick<DecodedRequest, "title" | "titleMsg" | "lines" | "warnings" | "blind">;

/** Recipients the router resolves itself (Constants.sol): the account that called it, and the router. */
const MSG_SENDER = "0x0000000000000000000000000000000000000001";
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";
/** "The router's whole balance of this token" (Constants.CONTRACT_BALANCE). */
const CONTRACT_BALANCE = 1n << 255n;
const COMMAND_TYPE_MASK = 0x3f;
const UINT160 = (1n << 160n) - 1n;
/** Permit2 amounts at or above this are unlimited in practice (as in decode.ts). */
const PERMIT2_UNLIMITED = UINT160 >> 1n;

const P = {
  v3Swap: parseAbiParameters("address recipient, uint256 amountA, uint256 amountB, bytes path, bool payerIsUser"),
  v2Swap: parseAbiParameters("address recipient, uint256 amountA, uint256 amountB, address[] path, bool payerIsUser"),
  /** PERMIT2_TRANSFER_FROM (amount), SWEEP (minimum), TRANSFER (value), PAY_PORTION (bips). */
  tokenTo: parseAbiParameters("address token, address recipient, uint256 amount"),
  permit: parseAbiParameters("((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature"),
  permitBatch: parseAbiParameters("((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permit, bytes signature"),
  transferBatch: parseAbiParameters("(address from, address to, uint160 amount, address token)[] transfers"),
  wrap: parseAbiParameters("address recipient, uint256 amount"),
  balanceCheck: parseAbiParameters("address owner, address token, uint256 minBalance"),
};

const who = (address: string): string => appName(address) ?? shortAddress(address);
const step = (title: string | Msg, lines: RouterStep["lines"] = [], warnings: Warning[] = []): RouterStep => ({
  ...(typeof title === "string" ? { title } : titled(title)),
  lines,
  warnings,
  blind: false,
});
const unreadable = (): RouterStep => ({ title: "A step that can't be read", lines: [], warnings: [], blind: true });

/** The plan's steps in order, or undefined when the plan itself is malformed (the router would refuse it). */
export async function routerSteps(ctx: ChainContext, router: string, commands: Hex, inputs: readonly Hex[]): Promise<RouterStep[] | undefined> {
  const types = hexToBytes(commands);
  if (types.length !== inputs.length) return undefined;
  const me = ctx.account.address as Hex;
  const native = ctx.network.nativeAsset;
  const asset = async (token: string) => (isAddressEqual(token as Hex, zeroAddress) ? native : (await tokenMeta(ctx, token)).asset);
  const amountOf = async (token: string, v: bigint) => {
    const a = await asset(token);
    return v === CONTRACT_BALANCE ? `all the ${a.symbol} from the previous step` : `${formatAmount(v, a.decimals)} ${a.symbol}`;
  };
  const isYou = (a: string) => isAddressEqual(a as Hex, MSG_SENDER) || isAddressEqual(a as Hex, me);
  const isRouter = (a: string) => isAddressEqual(a as Hex, ADDRESS_THIS) || isAddressEqual(a as Hex, router as Hex);
  const toWhom = (a: string) => (isYou(a) ? "you" : isRouter(a) ? "the swap" : who(a));
  /** Something leaves the plan for an account that is neither you nor the router itself. */
  const elsewhere = (a: string, what: string): { lines: RouterStep["lines"]; warnings: Warning[] } =>
    isYou(a) || isRouter(a)
      ? { lines: [], warnings: [] }
      : { lines: [{ label: "To", value: safeChecksum(a) }], warnings: [{ level: "caution", code: "new-recipient", message: `${what} from this goes to ${who(a)}, not to you.` }] };

  const swap = async (exactIn: boolean, recipient: string, a: bigint, b: bigint, tokenIn: string, tokenOut: string) => {
    const title = exactIn ? `Swap ${await amountOf(tokenIn, a)} for at least ${await amountOf(tokenOut, b)}` : `Swap at most ${await amountOf(tokenIn, b)} for ${await amountOf(tokenOut, a)}`;
    const e = elsewhere(recipient, (await asset(tokenOut)).symbol);
    return step(title, e.lines, e.warnings);
  };
  const pull = async (token: string, recipient: string, amount: bigint) => {
    const amt = await amountOf(token, amount & UINT160);
    if (isRouter(recipient)) return step(`Move ${amt} from your account into the swap`);
    const e = elsewhere(recipient, (await asset(token)).symbol);
    return step(msg("bg.req.sendTo", { amount: amt, to: toWhom(recipient) }), e.lines, e.warnings);
  };
  const permit = async (token: string, amount: bigint, spender: string) => {
    const a = await asset(token);
    const name = who(spender);
    const lines = [{ label: "Allowed app", value: safeChecksum(spender) }, { label: "Token", value: `${a.name} (${safeChecksum(token)})` }];
    if (amount >= PERMIT2_UNLIMITED) {
      return step(msg("bg.req.allowSpendAll", { spender: name, symbol: a.symbol }), lines, [warning("danger", "unlimited-approval", msg("bg.warn.letsTakeAll", { spender: name, symbol: a.symbol }))]);
    }
    return step(msg("bg.req.allowSpendUpTo", { spender: name, amount: `${formatAmount(amount, a.decimals)} ${a.symbol}` }), lines);
  };

  const steps: RouterStep[] = [];
  for (let i = 0; i < types.length; i++) {
    const input = inputs[i]!;
    try {
      switch (types[i]! & COMMAND_TYPE_MASK) {
        case 0x00: // V3_SWAP_EXACT_IN: path is tokenIn, fee, …, tokenOut
        case 0x01: {
          // V3_SWAP_EXACT_OUT: path runs backwards, tokenOut first
          const [recipient, a, b, path] = decodeAbiParameters(P.v3Swap, input);
          const n = (path.length - 2) / 2;
          if (n < 43 || (n - 20) % 23 !== 0) throw new Error("bad path");
          const [first, last] = [`0x${path.slice(2, 42)}`, `0x${path.slice(-40)}`];
          const exactIn = (types[i]! & COMMAND_TYPE_MASK) === 0x00;
          steps.push(await swap(exactIn, recipient, a, b, exactIn ? first : last, exactIn ? last : first));
          break;
        }
        case 0x08: // V2_SWAP_EXACT_IN
        case 0x09: {
          // V2_SWAP_EXACT_OUT: the path runs forwards in both
          const [recipient, a, b, path] = decodeAbiParameters(P.v2Swap, input);
          if (path.length < 2) throw new Error("bad path");
          steps.push(await swap((types[i]! & COMMAND_TYPE_MASK) === 0x08, recipient, a, b, path[0]!, path[path.length - 1]!));
          break;
        }
        case 0x02: {
          // PERMIT2_TRANSFER_FROM: from your account, through your Permit2 allowance
          const [token, recipient, amount] = decodeAbiParameters(P.tokenTo, input);
          steps.push(await pull(token, recipient, amount));
          break;
        }
        case 0x0d: {
          // PERMIT2_TRANSFER_FROM_BATCH (the router refuses any `from` that isn't you)
          const [transfers] = decodeAbiParameters(P.transferBatch, input);
          for (const t of transfers) steps.push(await pull(t.token, t.to, t.amount));
          break;
        }
        case 0x0a: {
          // PERMIT2_PERMIT: registers a Permit2 allowance you signed
          const [p] = decodeAbiParameters(P.permit, input);
          steps.push(await permit(p.details.token, p.details.amount & UINT160, p.spender));
          break;
        }
        case 0x03: {
          // PERMIT2_PERMIT_BATCH
          const [p] = decodeAbiParameters(P.permitBatch, input);
          for (const d of p.details) steps.push(await permit(d.token, d.amount & UINT160, p.spender));
          break;
        }
        case 0x04: {
          // SWEEP: everything of a token the router holds
          const [token, recipient] = decodeAbiParameters(P.tokenTo, input);
          const sym = (await asset(token)).symbol;
          const e = elsewhere(recipient, sym);
          steps.push(step(`Send the ${sym} left in the swap to ${toWhom(recipient)}`, e.lines, e.warnings));
          break;
        }
        case 0x05: {
          // TRANSFER: from the router's balance
          const [token, recipient, value] = decodeAbiParameters(P.tokenTo, input);
          const e = elsewhere(recipient, (await asset(token)).symbol);
          steps.push(step(`Send ${await amountOf(token, value)} from the swap to ${toWhom(recipient)}`, e.lines, e.warnings));
          break;
        }
        case 0x06: {
          // PAY_PORTION: a share (in basis points) of what the router holds, usually an app fee
          const [token, recipient, bips] = decodeAbiParameters(P.tokenTo, input);
          const sym = (await asset(token)).symbol;
          const e = bips > 100n ? elsewhere(recipient, sym) : { lines: [], warnings: [] };
          steps.push(step(`Pay ${Number(bips) / 100}% of the ${sym} to ${toWhom(recipient)}`, e.lines, e.warnings));
          break;
        }
        case 0x0b: {
          // WRAP_ETH
          const [recipient, amount] = decodeAbiParameters(P.wrap, input);
          const amt = amount === CONTRACT_BALANCE ? `all the ${native.symbol} from the previous step` : `${formatAmount(amount, native.decimals)} ${native.symbol}`;
          const e = elsewhere(recipient, `W${native.symbol}`);
          steps.push(step(`Wrap ${amt}`, e.lines, e.warnings));
          break;
        }
        case 0x0c: {
          // UNWRAP_WETH (the amount is a minimum)
          const [recipient] = decodeAbiParameters(P.wrap, input);
          const e = elsewhere(recipient, native.symbol);
          steps.push(step(`Unwrap to ${native.symbol} and send it to ${toWhom(recipient)}`, e.lines, e.warnings));
          break;
        }
        case 0x0e: {
          // BALANCE_CHECK_ERC20: stops the plan unless a balance is high enough
          const [owner, token, min] = decodeAbiParameters(P.balanceCheck, input);
          steps.push(step(`Stop unless ${isYou(owner) ? "you hold" : `${who(owner)} holds`} at least ${await amountOf(token, min)}`));
          break;
        }
        default:
          steps.push(unreadable());
      }
    } catch {
      steps.push(unreadable());
    }
  }
  return steps;
}
