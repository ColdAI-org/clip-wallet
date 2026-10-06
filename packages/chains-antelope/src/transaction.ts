import { sha256 } from "@noble/hashes/sha2.js";
import { Reader, Writer, concat, fromHex, hex, nameFromBigInt, nameToBigInt } from "./bytes.js";

/**
 * Antelope transactions (Spring/Leap `transaction`): header (expiration uint32 seconds, ref_block_num uint16,
 * ref_block_prefix uint32, max_net_usage_words varuint32, max_cpu_usage_ms uint8, delay_sec varuint32), then
 * context_free_actions[], actions[] (account name, name, authorization[{actor, permission}], data bytes) and
 * transaction_extensions[] (uint16 type, bytes). Signing digest = SHA-256(chain_id ‖ packed_trx ‖ SHA-256 of the
 * context-free data, or 32 zero bytes when there is none); the id = SHA-256(packed_trx).
 */

export interface PermissionLevel {
  actor: string;
  permission: string;
}

export interface ActionJson {
  account: string;
  name: string;
  authorization: PermissionLevel[];
  /** Packed action data, hex. */
  data: string;
}

export interface TransactionJson {
  /** "2026-10-06T12:00:00" (UTC). */
  expiration: string;
  ref_block_num: number;
  ref_block_prefix: number;
  max_net_usage_words: number;
  max_cpu_usage_ms: number;
  delay_sec: number;
  context_free_actions: ActionJson[];
  actions: ActionJson[];
  transaction_extensions: [number, string][];
}

export function expirationSeconds(expiration: string): number {
  const ms = Date.parse(/[zZ]$/.test(expiration) ? expiration : `${expiration}Z`);
  if (Number.isNaN(ms)) throw new Error(`bad expiration ${expiration}`);
  return Math.floor(ms / 1000);
}

export function expirationText(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.000Z$/, "");
}

function packAction(w: Writer, a: ActionJson): void {
  w.uint(nameToBigInt(a.account), 8).uint(nameToBigInt(a.name), 8).varuint32(a.authorization.length);
  for (const p of a.authorization) w.uint(nameToBigInt(p.actor), 8).uint(nameToBigInt(p.permission), 8);
  w.blob(fromHex(a.data));
}

export function packTransaction(tx: TransactionJson): Uint8Array {
  const w = new Writer()
    .uint(expirationSeconds(tx.expiration), 4)
    .uint(tx.ref_block_num, 2)
    .uint(tx.ref_block_prefix, 4)
    .varuint32(tx.max_net_usage_words)
    .uint(tx.max_cpu_usage_ms, 1)
    .varuint32(tx.delay_sec);
  w.varuint32(tx.context_free_actions.length);
  for (const a of tx.context_free_actions) packAction(w, a);
  w.varuint32(tx.actions.length);
  for (const a of tx.actions) packAction(w, a);
  w.varuint32(tx.transaction_extensions.length);
  for (const [type, data] of tx.transaction_extensions) w.uint(type, 2).blob(fromHex(data));
  return w.done();
}

function unpackAction(r: Reader): ActionJson {
  const account = nameFromBigInt(r.uint(8));
  const name = nameFromBigInt(r.uint(8));
  const n = r.varuint32();
  const authorization: PermissionLevel[] = [];
  for (let i = 0; i < n; i++) authorization.push({ actor: nameFromBigInt(r.uint(8)), permission: nameFromBigInt(r.uint(8)) });
  return { account, name, authorization, data: hex(r.blob()) };
}

export function unpackTransaction(bytes: Uint8Array): TransactionJson {
  const r = new Reader(bytes);
  const tx: TransactionJson = {
    expiration: expirationText(Number(r.uint(4))),
    ref_block_num: Number(r.uint(2)),
    ref_block_prefix: Number(r.uint(4)),
    max_net_usage_words: r.varuint32(),
    max_cpu_usage_ms: r.byte(),
    delay_sec: r.varuint32(),
    context_free_actions: [],
    actions: [],
    transaction_extensions: [],
  };
  for (let i = r.varuint32(); i > 0; i--) tx.context_free_actions.push(unpackAction(r));
  for (let i = r.varuint32(); i > 0; i--) tx.actions.push(unpackAction(r));
  for (let i = r.varuint32(); i > 0; i--) tx.transaction_extensions.push([Number(r.uint(2)), hex(r.blob())]);
  if (r.remaining) throw new Error("bytes left after the transaction");
  return tx;
}

export function signingDigest(chainId: string, packedTrx: Uint8Array): Uint8Array {
  return sha256(concat(fromHex(chainId), packedTrx, new Uint8Array(32)));
}

export function transactionId(packedTrx: Uint8Array): string {
  return hex(sha256(packedTrx));
}

/** TAPoS from a block id: ref_block_num = block number & 0xffff, ref_block_prefix = bytes 8..12 little-endian. */
export function tapos(blockId: string): { ref_block_num: number; ref_block_prefix: number } {
  const b = fromHex(blockId);
  if (b.length !== 32) throw new Error("bad block id");
  const num = (b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!;
  const prefix = (b[8]! | (b[9]! << 8) | (b[10]! << 16) | (b[11]! << 24)) >>> 0;
  return { ref_block_num: num & 0xffff, ref_block_prefix: prefix };
}
