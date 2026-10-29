/**
 * Simulation: eth_simulateV1 with traceTransfers (native moves show up as Transfer logs from
 * 0xEeee…EEeE), parsed into balance changes for the user's account, and Approval / ApprovalForAll
 * logs into the permissions it would give. Falls back to eth_call + eth_estimateGas, which only
 * tells us whether the transaction would revert.
 */
import type { BalanceChange, ChainContext } from "@clip-wallet/core";
import { type Hex, decodeFunctionResult, encodeFunctionData, erc20Abi, hexToBigInt, isAddressEqual, numberToHex, pad, toEventSelector, zeroAddress } from "viem";
import { ethCall, tokenMeta } from "./chain.js";
import { RpcError, rpc } from "./rpc.js";
import type { TxParams } from "./params.js";

export const TRANSFER_TOPIC = toEventSelector("event Transfer(address indexed from, address indexed to, uint256 value)");
export const TRANSFER_SINGLE_TOPIC = toEventSelector("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
/** ERC-20 (3 topics, amount in data) and ERC-721 (4 topics, token id indexed) share this event. */
export const APPROVAL_TOPIC = toEventSelector("event Approval(address indexed owner, address indexed spender, uint256 value)");
export const APPROVAL_FOR_ALL_TOPIC = toEventSelector("event ApprovalForAll(address indexed owner, address indexed operator, bool approved)");
export const NATIVE_PSEUDO_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/** A permission over the account's assets the transaction would give. */
export interface SimulatedApproval {
  contract: string;
  spender: string;
  /** ERC-20: the new allowance, only when it is higher than the allowance before. */
  amount?: bigint;
  /** ERC-721: the one token the spender may move. */
  tokenId?: string;
  /** ApprovalForAll: every NFT the account holds in the collection. */
  all?: true;
}

interface SimLog {
  address: `0x${string}`;
  topics: Hex[];
  data: Hex;
}

export interface SimulationResult {
  /** True when eth_simulateV1 ran and we have balance changes from it. */
  simulated: boolean;
  /** The transaction would revert. */
  reverts: boolean;
  revertReason?: string;
  gasUsed?: bigint;
  balanceChanges: BalanceChange[];
  /** NFTs the account would receive / send ("#123 of 0x…"). */
  nftMoves: { direction: "in" | "out"; contract: string; tokenId: string }[];
  /** Permissions the account would give (Approval / ApprovalForAll logs with the account as owner). */
  approvals: SimulatedApproval[];
  /** The simulation itself could not run (not "the tx reverts"). */
  unavailable: boolean;
}

function callObject(tx: TxParams): Record<string, Hex> {
  const c: Record<string, Hex> = { from: tx.from, data: tx.data, value: numberToHex(tx.value) };
  if (tx.to) c.to = tx.to;
  if (tx.gas !== undefined) c.gas = numberToHex(tx.gas);
  return c;
}

/**
 * `prior`: earlier calls of the same EIP-5792 batch. They run first in the same simulated block, so this call is
 * previewed on the state they leave (an approve before a swap). Without eth_simulateV1 a batch call after the first
 * can't be previewed reliably: it reports "couldn't preview" rather than a revert that may not happen.
 */
export async function simulate(ctx: ChainContext, tx: TxParams, prior: TxParams[] = []): Promise<SimulationResult> {
  try {
    return await simulateV1(ctx, tx, prior);
  } catch {
    if (prior.length > 0) return { simulated: false, reverts: false, balanceChanges: [], nftMoves: [], approvals: [], unavailable: true };
    return fallback(ctx, tx);
  }
}

async function simulateV1(ctx: ChainContext, tx: TxParams, prior: TxParams[] = []): Promise<SimulationResult> {
  const res = await rpc<{ calls: { status: Hex; gasUsed: Hex; logs?: SimLog[]; error?: { message?: string } }[] }[]>(
    ctx.network,
    ctx.fetch,
    "eth_simulateV1",
    [{ blockStateCalls: [{ calls: [...prior.map(callObject), callObject(tx)] }], traceTransfers: true, validation: false }, "latest"],
  );
  const calls = res?.[0]?.calls ?? [];
  // An earlier call of the batch fails on its own: this one can't be previewed on top of it.
  if (calls.slice(0, prior.length).some((c) => c.status !== "0x1")) throw new Error("an earlier batch call reverts");
  const call = calls[prior.length];
  if (!call) throw new Error("empty simulateV1 result");
  const gasUsed = hexToBigInt(call.gasUsed);
  if (call.status !== "0x1") {
    const out: SimulationResult = { simulated: true, reverts: true, gasUsed, balanceChanges: [], nftMoves: [], approvals: [], unavailable: false };
    if (call.error?.message) out.revertReason = call.error.message;
    return out;
  }
  const me = ctx.account.address as `0x${string}`;
  const deltas = new Map<string, bigint>();
  const nftMoves: SimulationResult["nftMoves"] = [];
  const approvals: SimulatedApproval[] = [];
  // ERC-20 allowances by token and spender: the highest this call sets, and what the batch's earlier calls left.
  const allowances = new Map<string, SimulatedApproval>();
  const earlier = new Map<string, bigint>();
  for (const log of calls.slice(0, prior.length).flatMap((c) => c.logs ?? [])) {
    const a = erc20Approval(log, me);
    if (a) earlier.set(a.key, a.value);
  }
  for (const log of call.logs ?? []) {
    const allowance = erc20Approval(log, me);
    if (allowance) {
      const seen = allowances.get(allowance.key);
      if (!seen) {
        const a: SimulatedApproval = { contract: log.address, spender: allowance.spender, amount: allowance.value };
        allowances.set(allowance.key, a);
        approvals.push(a);
      } else if (allowance.value > seen.amount!) seen.amount = allowance.value;
      continue;
    }
    const t0 = log.topics[0]?.toLowerCase();
    if (t0 === TRANSFER_TOPIC && log.topics.length === 3) {
      const from = topicAddress(log.topics[1]!);
      const to = topicAddress(log.topics[2]!);
      const v = log.data && log.data !== "0x" ? hexToBigInt(log.data) : 0n;
      const key = log.address.toLowerCase();
      if (isAddressEqual(from, me)) deltas.set(key, (deltas.get(key) ?? 0n) - v);
      if (isAddressEqual(to, me)) deltas.set(key, (deltas.get(key) ?? 0n) + v);
    } else if (t0 === TRANSFER_TOPIC && log.topics.length === 4) {
      const from = topicAddress(log.topics[1]!);
      const to = topicAddress(log.topics[2]!);
      const tokenId = hexToBigInt(log.topics[3]!).toString();
      if (isAddressEqual(from, me)) nftMoves.push({ direction: "out", contract: log.address, tokenId });
      if (isAddressEqual(to, me)) nftMoves.push({ direction: "in", contract: log.address, tokenId });
    } else if (t0 === TRANSFER_SINGLE_TOPIC && log.topics.length === 4) {
      const from = topicAddress(log.topics[2]!);
      const to = topicAddress(log.topics[3]!);
      const tokenId = hexToBigInt(`0x${log.data.slice(2, 66)}`).toString();
      if (isAddressEqual(from, me)) nftMoves.push({ direction: "out", contract: log.address, tokenId });
      if (isAddressEqual(to, me)) nftMoves.push({ direction: "in", contract: log.address, tokenId });
    } else if (t0 === APPROVAL_TOPIC && log.topics.length === 4 && isAddressEqual(topicAddress(log.topics[1]!), me)) {
      // ERC-721 approve(spender, tokenId); a transfer clears it with the zero address, which grants nothing.
      const spender = topicAddress(log.topics[2]!);
      if (!isAddressEqual(spender, zeroAddress)) approvals.push({ contract: log.address, spender, tokenId: hexToBigInt(log.topics[3]!).toString() });
    } else if (t0 === APPROVAL_FOR_ALL_TOPIC && log.topics.length === 3 && isAddressEqual(topicAddress(log.topics[1]!), me) && firstWord(log.data) !== 0n) {
      approvals.push({ contract: log.address, spender: topicAddress(log.topics[2]!), all: true });
    }
  }
  // Spending through an allowance also logs Approval (the lower remainder): only a raise is a new permission.
  for (const [key, a] of allowances) {
    const before = earlier.get(key) ?? (await allowanceOf(ctx, a.contract, me, a.spender));
    if (a.amount! <= before) approvals.splice(approvals.indexOf(a), 1);
  }
  const balanceChanges: BalanceChange[] = [];
  for (const [addr, delta] of deltas) {
    if (delta === 0n) continue;
    const asset = addr === NATIVE_PSEUDO_TOKEN.toLowerCase() ? ctx.network.nativeAsset : (await tokenMeta(ctx, addr)).asset;
    balanceChanges.push({ asset, delta: delta.toString() });
  }
  return { simulated: true, reverts: false, gasUsed, balanceChanges, nftMoves, approvals, unavailable: false };
}

/** An ERC-20 Approval log with the account as owner. */
function erc20Approval(log: SimLog, me: `0x${string}`): { key: string; spender: `0x${string}`; value: bigint } | undefined {
  if (log.topics[0]?.toLowerCase() !== APPROVAL_TOPIC || log.topics.length !== 3 || !isAddressEqual(topicAddress(log.topics[1]!), me)) return undefined;
  const spender = topicAddress(log.topics[2]!);
  return { key: `${log.address.toLowerCase()}:${spender.toLowerCase()}`, spender, value: firstWord(log.data) };
}

/** The allowance before the transaction; 0 when the token doesn't answer, so a grant is never hidden. */
async function allowanceOf(ctx: ChainContext, token: string, owner: `0x${string}`, spender: string): Promise<bigint> {
  try {
    const out = await ethCall(ctx, token, encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender as `0x${string}`] }));
    return out && out !== "0x" ? decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data: out }) : 0n;
  } catch {
    return 0n;
  }
}

const firstWord = (data: Hex): bigint => (data && data.length > 2 ? hexToBigInt(`0x${data.slice(2, 66)}`) : 0n);

async function fallback(ctx: ChainContext, tx: TxParams): Promise<SimulationResult> {
  const base: SimulationResult = { simulated: false, reverts: false, balanceChanges: [], nftMoves: [], approvals: [], unavailable: false };
  try {
    await rpc(ctx.network, ctx.fetch, "eth_call", [callObject(tx), "latest"]);
  } catch (e) {
    if (e instanceof RpcError) return { ...base, reverts: true, revertReason: e.message };
    return { ...base, unavailable: true };
  }
  try {
    base.gasUsed = hexToBigInt(await rpc<Hex>(ctx.network, ctx.fetch, "eth_estimateGas", [callObject(tx)]));
  } catch (e) {
    if (e instanceof RpcError) return { ...base, reverts: true, revertReason: e.message };
    base.unavailable = true;
  }
  return base;
}

const topicAddress = (topic: Hex): `0x${string}` => `0x${topic.slice(-40)}`;

/** For tests and callers building logs. */
export const addressTopic = (a: string): Hex => pad(a as Hex, { size: 32 }).toLowerCase() as Hex;
