/**
 * Simulation: eth_simulateV1 with traceTransfers (native moves show up as Transfer logs from
 * 0xEeee…EEeE), parsed into balance changes for the user's account. Falls back to eth_call +
 * eth_estimateGas, which only tells us whether the transaction would revert.
 */
import type { BalanceChange, ChainContext } from "@clip-wallet/core";
import { type Hex, hexToBigInt, isAddressEqual, numberToHex, pad, toEventSelector } from "viem";
import { tokenMeta } from "./chain.js";
import { RpcError, rpc } from "./rpc.js";
import type { TxParams } from "./params.js";

export const TRANSFER_TOPIC = toEventSelector("event Transfer(address indexed from, address indexed to, uint256 value)");
export const TRANSFER_SINGLE_TOPIC = toEventSelector("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
export const NATIVE_PSEUDO_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

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
    if (prior.length > 0) return { simulated: false, reverts: false, balanceChanges: [], nftMoves: [], unavailable: true };
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
    const out: SimulationResult = { simulated: true, reverts: true, gasUsed, balanceChanges: [], nftMoves: [], unavailable: false };
    if (call.error?.message) out.revertReason = call.error.message;
    return out;
  }
  const me = ctx.account.address as `0x${string}`;
  const deltas = new Map<string, bigint>();
  const nftMoves: SimulationResult["nftMoves"] = [];
  for (const log of call.logs ?? []) {
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
    }
  }
  const balanceChanges: BalanceChange[] = [];
  for (const [addr, delta] of deltas) {
    if (delta === 0n) continue;
    const asset = addr === NATIVE_PSEUDO_TOKEN.toLowerCase() ? ctx.network.nativeAsset : (await tokenMeta(ctx, addr)).asset;
    balanceChanges.push({ asset, delta: delta.toString() });
  }
  return { simulated: true, reverts: false, gasUsed, balanceChanges, nftMoves, unavailable: false };
}

async function fallback(ctx: ChainContext, tx: TxParams): Promise<SimulationResult> {
  const base: SimulationResult = { simulated: false, reverts: false, balanceChanges: [], nftMoves: [], unavailable: false };
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
