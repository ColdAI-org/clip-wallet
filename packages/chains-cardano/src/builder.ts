/**
 * Transaction building: CIP-2 largest-first coin selection, Babbage min-UTxO, and the linear fee
 * (txFeePerByte × size + txFeeFixed) measured on the final size with placeholder witnesses.
 *
 * min-UTxO (Babbage/Conway): coinsPerUTxOByte × (160 + serialized output size).
 */
import { ClipError } from "@clip-wallet/core";
import { CborMap, CborTag, type CborValue, encode } from "./cbor.js";
import type { KoiosUtxo, ProtocolParams } from "./koios.js";
import { type Value, addValue, cloneValue, covers, emptyValue, encodeValue } from "./value.js";
import { fromHex } from "./util.js";
import { addressToBytes } from "./address.js";
import type { TxInput } from "./tx.js";

export interface Utxo {
  input: TxInput;
  address: Uint8Array;
  value: Value;
}

export function utxoFromKoios(u: KoiosUtxo): Utxo {
  const assets = new Map<string, bigint>();
  for (const a of u.asset_list ?? []) {
    const unit = a.policy_id + (a.asset_name ?? "");
    assets.set(unit, (assets.get(unit) ?? 0n) + BigInt(a.quantity));
  }
  return { input: { txHash: fromHex(u.tx_hash), index: u.tx_index }, address: addressToBytes(u.address), value: { coin: BigInt(u.value), assets } };
}

export function encodeOutput(address: Uint8Array, value: Value): CborValue {
  return new CborMap([
    [0, address],
    [1, encodeValue(value)],
  ]);
}

export function minAda(address: Uint8Array, value: Value, p: ProtocolParams): bigint {
  // Size depends on the coin's own encoding width; iterate to a fixed point.
  let coin = value.coin > 0n ? value.coin : 1_000_000n;
  for (let i = 0; i < 4; i++) {
    const size = encode(encodeOutput(address, { coin, assets: value.assets })).length;
    const need = BigInt(p.utxoCostPerByte) * BigInt(160 + size);
    if (need <= coin || i === 3) return need;
    coin = need;
  }
  return coin;
}

export function encodeInput(i: TxInput): CborValue {
  return [i.txHash, i.index];
}

export interface BuildParams {
  utxos: Utxo[];
  outputs: { address: Uint8Array; value: Value }[];
  changeAddress: Uint8Array;
  params: ProtocolParams;
  ttl: bigint;
  certs?: CborValue[];
  /** Deposits taken by certificates (positive) or refunded (negative). */
  deposit?: bigint;
  /** Reward withdrawals (body key 5). The withdrawn ADA counts as an input. */
  withdrawals?: { rewardAddress: Uint8Array; amount: bigint }[];
  /** Vkey witnesses the final transaction will carry (for the size estimate). */
  witnesses: number;
}

export interface Built {
  body: Uint8Array;
  fee: bigint;
  inputs: Utxo[];
  change: Value | null;
}

type Extra = { certs?: CborValue[] | undefined; withdrawals?: { rewardAddress: Uint8Array; amount: bigint }[] | undefined };

function bodyBytes(inputs: Utxo[], outputs: CborValue[], fee: bigint, ttl: bigint, extra: Extra): Uint8Array {
  const { certs, withdrawals } = extra;
  const sorted = [...inputs].sort((a, b) => {
    for (let i = 0; i < 32; i++) if (a.input.txHash[i] !== b.input.txHash[i]) return a.input.txHash[i]! - b.input.txHash[i]!;
    return a.input.index - b.input.index;
  });
  const entries: [CborValue, CborValue][] = [
    [0, new CborTag(258, sorted.map((u) => encodeInput(u.input)))],
    [1, outputs],
    [2, fee],
    [3, ttl],
  ];
  if (certs?.length) entries.push([4, new CborTag(258, certs)]);
  if (withdrawals?.length) {
    // Canonical map order: shorter keys first, then bytewise (all reward addresses are 29 bytes).
    const sortedW = [...withdrawals].sort((a, b) => (hexOf(a.rewardAddress) < hexOf(b.rewardAddress) ? -1 : 1));
    entries.push([5, new CborMap(sortedW.map((w) => [w.rewardAddress, w.amount] as [CborValue, CborValue]))]);
  }
  return encode(new CborMap(entries));
}

/** Size of the signed transaction with `n` placeholder vkey witnesses. */
function signedSize(body: Uint8Array, n: number): number {
  const ws = encode(new CborMap([[0, new CborTag(258, Array.from({ length: n }, () => [new Uint8Array(32), new Uint8Array(64)]))]]));
  return 1 + body.length + ws.length + 1 + 1;
}

const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function feeFor(size: number, p: ProtocolParams): bigint {
  return BigInt(p.txFeePerByte) * BigInt(size) + BigInt(p.txFeeFixed);
}

/** Largest-first: UTxOs holding requested assets first (most of the asset first), then by ADA. */
function order(utxos: Utxo[], target: Value): Utxo[] {
  const wanted = [...target.assets.keys()];
  const score = (u: Utxo) => wanted.reduce((a, unit) => a + (u.value.assets.get(unit) ?? 0n), 0n);
  return [...utxos].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa > sb ? -1 : 1;
    if (a.value.coin !== b.value.coin) return a.value.coin > b.value.coin ? -1 : 1;
    return 0;
  });
}

export function buildTx(bp: BuildParams): Built {
  const { params: p } = bp;
  const outputs = bp.outputs.map((o) => encodeOutput(o.address, o.value));
  const target = emptyValue();
  for (const o of bp.outputs) addValue(target, o.value);
  target.coin += bp.deposit ?? 0n;
  for (const w of bp.withdrawals ?? []) target.coin -= w.amount;
  const extra: Extra = { certs: bp.certs, withdrawals: bp.withdrawals };

  const pool = order(bp.utxos, target);
  const selected: Utxo[] = [];
  const have = emptyValue();
  let i = 0;
  const take = () => {
    const u = pool[i++];
    if (!u) return false;
    selected.push(u);
    addValue(have, u.value);
    return true;
  };

  // A transaction needs at least one input, even when withdrawals or refunds cover everything.
  while (!covers(have, target) || selected.length === 0) {
    if (!take()) {
      const asset = [...target.assets].find(([u, q]) => (have.assets.get(u) ?? 0n) < q);
      throw new ClipError(asset ? "You don't have enough of that token." : "You don't have enough ADA for this.", "cardano/insufficient-funds");
    }
  }

  for (;;) {
    const change = cloneValue(have);
    addValue(change, target, -1n);
    // Fee with a change output.
    let fee = feeFor(signedSize(bodyBytes(selected, outputs, 0n, bp.ttl, extra), bp.witnesses) + 9, p);
    for (let k = 0; k < 3; k++) {
      const c = cloneValue(change);
      c.coin -= fee;
      const outs = [...outputs, encodeOutput(bp.changeAddress, c)];
      const next = feeFor(signedSize(bodyBytes(selected, outs, fee, bp.ttl, extra), bp.witnesses), p);
      if (next <= fee) break;
      fee = next;
    }
    const withChange = cloneValue(change);
    withChange.coin -= fee;
    if (withChange.coin >= 0n && withChange.coin >= minAda(bp.changeAddress, withChange, p)) {
      const outs = [...outputs, encodeOutput(bp.changeAddress, withChange)];
      return { body: bodyBytes(selected, outs, fee, bp.ttl, extra), fee, inputs: selected, change: withChange };
    }
    // No room for change: if only a little ADA is left over (no tokens), it goes to the fee.
    if (change.assets.size === 0) {
      const noChangeFee = feeFor(signedSize(bodyBytes(selected, outputs, change.coin, bp.ttl, extra), bp.witnesses), p);
      if (change.coin >= noChangeFee) {
        return { body: bodyBytes(selected, outputs, change.coin, bp.ttl, extra), fee: change.coin, inputs: selected, change: null };
      }
    }
    if (!take()) throw new ClipError("You don't have enough ADA to cover this and the network fee.", "cardano/insufficient-funds");
  }
}
