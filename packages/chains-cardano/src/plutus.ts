/**
 * Plutus data helpers (cardano-ledger conway.cddl `plutus_data` / `constr<a>`): enough to read DEX order datums
 * and check who they pay. Read-only; nothing here builds scripts.
 *
 *   constr<a> = #6.121([* a]) .. #6.127([* a])      ; alternatives 0..6
 *             / #6.1280([* a]) .. #6.1400([* a])    ; alternatives 7..127
 *             / #6.102([uint, [* a]])               ; any alternative
 *
 * Plutus `Address` (plutus-ledger-api): Constr 0 [credential, Maybe StakingCredential], where
 * credential = Constr 0 [pubKeyHash] / Constr 1 [scriptHash] and
 * StakingCredential = Constr 0 [credential] (StakingHash) / Constr 1 [ptr…] (StakingPtr); Maybe = Constr 0 [x] / Constr 1 [].
 */
import { blake2b } from "@noble/hashes/blake2.js";
import type { Credential } from "./address.js";
import { CborTag, type CborValue, asBytes, asInt, asList, decode, splitArray, splitMap } from "./cbor.js";
import type { ParsedTx, TxOutput } from "./tx.js";
import { hex } from "./util.js";

export interface Constr {
  index: number;
  fields: CborValue[];
}

export function constrOf(v: CborValue): Constr | null {
  if (!(v instanceof CborTag)) return null;
  const t = v.tag;
  if (t >= 121 && t <= 127) return Array.isArray(v.value) ? { index: t - 121, fields: v.value } : null;
  if (t >= 1280 && t <= 1400) return Array.isArray(v.value) ? { index: t - 1280 + 7, fields: v.value } : null;
  if (t === 102 && Array.isArray(v.value) && v.value.length === 2) {
    const i = asInt(v.value[0]!);
    const f = v.value[1];
    return i !== null && Array.isArray(f) ? { index: Number(i), fields: f } : null;
  }
  return null;
}

export function plutusCredential(v: CborValue): Credential | null {
  const c = constrOf(v);
  if (!c || c.fields.length !== 1 || (c.index !== 0 && c.index !== 1)) return null;
  const h = asBytes(c.fields[0]!);
  return h && h.length === 28 ? { kind: c.index === 0 ? "key" : "script", hash: h } : null;
}

/** Plutus Address → payment credential and (hash) stake credential. Stake pointers come back as `stake: null`. */
export function plutusAddress(v: CborValue): { payment: Credential; stake?: Credential | null } | null {
  const c = constrOf(v);
  if (!c || c.index !== 0 || c.fields.length !== 2) return null;
  const payment = plutusCredential(c.fields[0]!);
  if (!payment) return null;
  const maybe = constrOf(c.fields[1]!);
  if (!maybe) return null;
  if (maybe.index === 1 && maybe.fields.length === 0) return { payment };
  if (maybe.index !== 0 || maybe.fields.length !== 1) return null;
  const sc = constrOf(maybe.fields[0]!);
  if (!sc) return null;
  if (sc.index === 1) return { payment, stake: null };
  if (sc.index !== 0 || sc.fields.length !== 1) return null;
  const stake = plutusCredential(sc.fields[0]!);
  return stake ? { payment, stake } : null;
}

/** Datums carried in the witness set (key 4), by blake2b-256 of their original bytes (the datum hash). */
export function witnessDatums(tx: ParsedTx): Map<string, CborValue> {
  const out = new Map<string, CborValue>();
  for (const [k, v] of splitMap(tx.witnessRaw).entries) {
    if (asInt(decode(k)) !== 4n) continue;
    // Optional tag 258 (set) around the list: d9 0102.
    const start = v[0] === 0xd9 && v[1] === 0x01 && v[2] === 0x02 ? 3 : 0;
    for (const item of splitArray(v, start).items) out.set(hex(blake2b(item, { dkLen: 32 })), decode(item));
  }
  return out;
}

/** The datum an output carries (inline, or by hash from the witness set), or null when it has none / it's missing. */
export function outputDatum(tx: ParsedTx, o: TxOutput, datums = witnessDatums(tx)): CborValue | null {
  if (o.inlineDatum) return decode(o.inlineDatum);
  if (o.datumHash) return datums.get(hex(o.datumHash)) ?? null;
  return null;
}

/** Every Plutus Address found anywhere inside a datum (depth-limited walk). */
export function addressesIn(v: CborValue, depth = 0): { payment: Credential; stake?: Credential | null }[] {
  if (depth > 32) return [];
  const here = plutusAddress(v);
  const out = here ? [here] : [];
  const c = constrOf(v);
  const kids = c ? c.fields : (asList(v) ?? []);
  if (!here) for (const k of kids) out.push(...addressesIn(k, depth + 1));
  return out;
}
