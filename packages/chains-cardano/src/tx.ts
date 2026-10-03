/**
 * Conway-era transaction parsing (cardano-ledger conway.cddl), keeping the original body bytes for hashing.
 *
 *   transaction = [body, witness_set, bool, auxiliary_data / null]   (Mary-era 3-element form also accepted)
 */
import { blake2b } from "@noble/hashes/blake2.js";
import { CborMap, CborRaw, CborTag, type CborValue, asBytes, asInt, asList, decode, encode, splitArray, splitMap } from "./cbor.js";
import { type Credential, parseAddressBytes } from "./address.js";
import { type Value, parseMultiasset, parseValue } from "./value.js";
import { hex } from "./util.js";

export interface TxInput {
  txHash: Uint8Array;
  index: number;
}

export interface TxOutput {
  address: Uint8Array;
  value: Value;
  datum?: "hash" | "inline";
  scriptRef?: boolean;
}

export type Drep = { kind: "key" | "script"; hash: Uint8Array } | { kind: "abstain" } | { kind: "no-confidence" };

export interface Certificate {
  type: number;
  /** Stake credential the certificate acts on (not set for pool/committee/drep-only certs). */
  cred?: Credential;
  pool?: Uint8Array;
  drep?: Drep;
  deposit?: bigint;
}

export interface TxBody {
  inputs: TxInput[];
  outputs: TxOutput[];
  fee: bigint;
  ttl?: bigint;
  validityStart?: bigint;
  certs: Certificate[];
  withdrawals: { rewardAddress: Uint8Array; amount: bigint }[];
  mint: Map<string, bigint>;
  auxDataHash?: Uint8Array;
  scriptDataHash?: Uint8Array;
  collateral: TxInput[];
  requiredSigners: Uint8Array[];
  networkId?: number;
  collateralReturn?: TxOutput;
  totalCollateral?: bigint;
  referenceInputs: TxInput[];
  votingProcedures: boolean;
  proposals: { deposit: bigint }[];
  donation?: bigint;
  unknownKeys: number[];
}

export interface ParsedTx {
  raw: Uint8Array;
  bodyRaw: Uint8Array;
  witnessRaw: Uint8Array;
  isValidRaw: Uint8Array | null;
  auxRaw: Uint8Array | null;
  body: TxBody;
  witness: CborMap;
  aux: CborValue;
  /** blake2b-256 over the original body bytes: what every vkey witness signs. */
  bodyHash: Uint8Array;
}

function inputOf(v: CborValue): TxInput {
  if (!Array.isArray(v) || v.length !== 2) throw new Error("bad input");
  const h = asBytes(v[0]!);
  const i = asInt(v[1]!);
  if (!h || h.length !== 32 || i === null) throw new Error("bad input");
  return { txHash: h, index: Number(i) };
}

const inputs = (v: CborValue | undefined): TxInput[] => (v === undefined ? [] : (asList(v) ?? fail("bad input set")).map(inputOf));

function fail(msg: string): never {
  throw new Error(msg);
}

export function parseOutput(v: CborValue): TxOutput {
  if (Array.isArray(v)) {
    const address = asBytes(v[0]!) ?? fail("bad output address");
    const out: TxOutput = { address, value: parseValue(v[1]!) };
    if (v.length > 2) out.datum = "hash";
    return out;
  }
  if (v instanceof CborMap) {
    const address = asBytes(v.get(0)!) ?? fail("bad output address");
    const out: TxOutput = { address, value: parseValue(v.get(1)!) };
    const d = v.get(2);
    if (Array.isArray(d)) out.datum = asInt(d[0]!) === 1n ? "inline" : "hash";
    if (v.has(3)) out.scriptRef = true;
    return out;
  }
  throw new Error("bad output");
}

function credOf(v: CborValue): Credential {
  if (!Array.isArray(v) || v.length !== 2) throw new Error("bad credential");
  const kind = asInt(v[0]!);
  const hash = asBytes(v[1]!);
  if ((kind !== 0n && kind !== 1n) || !hash || hash.length !== 28) throw new Error("bad credential");
  return { kind: kind === 0n ? "key" : "script", hash };
}

function drepOf(v: CborValue): Drep {
  if (!Array.isArray(v)) throw new Error("bad drep");
  const k = asInt(v[0]!);
  if (k === 0n || k === 1n) return { kind: k === 0n ? "key" : "script", hash: asBytes(v[1]!) ?? fail("bad drep") };
  if (k === 2n) return { kind: "abstain" };
  if (k === 3n) return { kind: "no-confidence" };
  throw new Error("bad drep");
}

function certOf(v: CborValue): Certificate {
  if (!Array.isArray(v) || v.length === 0) throw new Error("bad certificate");
  const type = Number(asInt(v[0]!) ?? -1n);
  const c: Certificate = { type };
  const pool = (x: CborValue) => asBytes(x) ?? fail("bad pool id");
  const coin = (x: CborValue) => asInt(x) ?? fail("bad deposit");
  switch (type) {
    case 0: // stake_registration
    case 1: // stake_deregistration
      c.cred = credOf(v[1]!);
      break;
    case 2: // stake_delegation
      c.cred = credOf(v[1]!);
      c.pool = pool(v[2]!);
      break;
    case 7: // reg_cert
    case 8: // unreg_cert
      c.cred = credOf(v[1]!);
      c.deposit = coin(v[2]!);
      break;
    case 9: // vote_deleg_cert
      c.cred = credOf(v[1]!);
      c.drep = drepOf(v[2]!);
      break;
    case 10: // stake_vote_deleg_cert
      c.cred = credOf(v[1]!);
      c.pool = pool(v[2]!);
      c.drep = drepOf(v[3]!);
      break;
    case 11: // stake_reg_deleg_cert
      c.cred = credOf(v[1]!);
      c.pool = pool(v[2]!);
      c.deposit = coin(v[3]!);
      break;
    case 12: // vote_reg_deleg_cert
      c.cred = credOf(v[1]!);
      c.drep = drepOf(v[2]!);
      c.deposit = coin(v[3]!);
      break;
    case 13: // stake_vote_reg_deleg_cert
      c.cred = credOf(v[1]!);
      c.pool = pool(v[2]!);
      c.drep = drepOf(v[3]!);
      c.deposit = coin(v[4]!);
      break;
    case 4: // pool_retirement
      c.pool = pool(v[1]!);
      break;
    case 16: // reg_drep_cert
    case 17: // unreg_drep_cert
      c.cred = credOf(v[1]!);
      c.deposit = coin(v[2]!);
      break;
    default:
      // 3 pool_registration, 14/15 committee, 18 update_drep: kept as type only.
      break;
  }
  return c;
}

const KNOWN_KEYS = new Set([0, 1, 2, 3, 4, 5, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);

export function parseBody(m: CborValue): TxBody {
  if (!(m instanceof CborMap)) throw new Error("body is not a map");
  const fee = asInt(m.get(2) ?? fail("no fee")) ?? fail("bad fee");
  const outputs = (Array.isArray(m.get(1)) ? (m.get(1) as CborValue[]) : fail("bad outputs")).map(parseOutput);
  const certs = m.get(4) === undefined ? [] : (asList(m.get(4)!) ?? fail("bad certificates")).map(certOf);
  const withdrawals: TxBody["withdrawals"] = [];
  const w = m.get(5);
  if (w !== undefined) {
    if (!(w instanceof CborMap)) throw new Error("bad withdrawals");
    for (const [k, v] of w.entries) withdrawals.push({ rewardAddress: asBytes(k) ?? fail("bad reward address"), amount: asInt(v) ?? fail("bad withdrawal") });
  }
  const requiredSigners = m.get(14) === undefined ? [] : (asList(m.get(14)!) ?? fail("bad required signers")).map((x) => asBytes(x) ?? fail("bad signer"));
  const proposals = m.get(20) === undefined ? [] : (asList(m.get(20)!) ?? fail("bad proposals")).map((p) => ({ deposit: Array.isArray(p) ? (asInt(p[0]!) ?? 0n) : 0n }));
  const body: TxBody = {
    inputs: inputs(m.get(0) ?? fail("no inputs")),
    outputs,
    fee,
    certs,
    withdrawals,
    mint: m.get(9) === undefined ? new Map() : parseMultiasset(m.get(9)!),
    collateral: inputs(m.get(13)),
    requiredSigners,
    referenceInputs: inputs(m.get(18)),
    votingProcedures: m.has(19),
    proposals,
    unknownKeys: [],
  };
  const opt = (k: number) => {
    const v = m.get(k);
    return v === undefined ? undefined : (asInt(v) ?? fail(`bad field ${k}`));
  };
  const ttl = opt(3);
  if (ttl !== undefined) body.ttl = ttl;
  const vs = opt(8);
  if (vs !== undefined) body.validityStart = vs;
  const tc = opt(17);
  if (tc !== undefined) body.totalCollateral = tc;
  const don = opt(22);
  if (don !== undefined) body.donation = don;
  const nid = opt(15);
  if (nid !== undefined) body.networkId = Number(nid);
  if (m.has(7)) body.auxDataHash = asBytes(m.get(7)!) ?? fail("bad aux hash");
  if (m.has(11)) body.scriptDataHash = asBytes(m.get(11)!) ?? fail("bad script data hash");
  if (m.has(16)) body.collateralReturn = parseOutput(m.get(16)!);
  for (const [k] of m.entries) {
    const n = asInt(k);
    if (n === null || !KNOWN_KEYS.has(Number(n))) body.unknownKeys.push(Number(n ?? -1n));
  }
  return body;
}

export function parseTransaction(raw: Uint8Array): ParsedTx {
  const { items, end } = splitArray(raw);
  if (end !== raw.length) throw new Error("trailing bytes");
  if (items.length < 3 || items.length > 4) throw new Error("not a transaction");
  const [bodyRaw, witnessRaw] = [items[0]!, items[1]!];
  const isValidRaw = items.length === 4 ? items[2]! : null;
  const auxRaw = items.length === 4 ? items[3]! : items[2]!;
  const witness = decode(witnessRaw);
  if (!(witness instanceof CborMap)) throw new Error("bad witness set");
  const aux = decode(auxRaw);
  return {
    raw,
    bodyRaw,
    witnessRaw,
    isValidRaw,
    auxRaw: aux === null ? null : auxRaw,
    body: parseBody(decode(bodyRaw)),
    witness,
    aux,
    bodyHash: blake2b(bodyRaw, { dkLen: 32 }),
  };
}

/** True when bytes decode as a transaction or a bare transaction body (used to refuse "messages" that are transactions). */
export function looksLikeTransaction(bytes: Uint8Array): boolean {
  try {
    parseTransaction(bytes);
    return true;
  } catch {
    /* not a full tx */
  }
  try {
    const v = decode(bytes);
    if (v instanceof CborMap && v.has(0) && v.has(1) && v.has(2)) {
      parseBody(v);
      return true;
    }
  } catch {
    /* not a body */
  }
  return false;
}

/** Witness set holding only `vkeys` (what CIP-30 signTx returns). */
export function encodeWitnessSet(vkeys: { publicKey: Uint8Array; signature: Uint8Array }[]): Uint8Array {
  return encode(new CborMap([[0, vkeys.map((w) => [w.publicKey, w.signature])]]));
}

/**
 * Adds vkey witnesses to a transaction's witness set, keeping the body, validity flag and auxiliary data bytes as
 * they were. Existing vkey witnesses are kept (duplicates by public key are skipped).
 */
export function addWitnesses(tx: ParsedTx, vkeys: { publicKey: Uint8Array; signature: Uint8Array }[]): Uint8Array {
  const { entries } = splitMap(tx.witnessRaw);
  const kept: [CborValue, CborValue][] = [];
  let existing: CborValue[] = [];
  let tagged = false;
  for (const [k, v] of entries) {
    if (asInt(decode(k)) === 0n) {
      const val = decode(v);
      tagged = val instanceof CborTag && val.tag === 258;
      existing = asList(val) ?? [];
    } else kept.push([new CborRaw(k), new CborRaw(v)]);
  }
  const seen = new Set(existing.map((w) => (Array.isArray(w) && w[0] instanceof Uint8Array ? hex(w[0]) : "")));
  const all = [...existing];
  for (const w of vkeys) if (!seen.has(hex(w.publicKey))) all.push([w.publicKey, w.signature]);
  const list: CborValue = tagged ? new CborTag(258, all) : all;
  const ws = encode(new CborMap([[0, list], ...kept]));
  const parts: CborValue[] = [new CborRaw(tx.bodyRaw), new CborRaw(ws), tx.isValidRaw ? new CborRaw(tx.isValidRaw) : true, tx.auxRaw ? new CborRaw(tx.auxRaw) : null];
  return encode(parts);
}

/** Native-script / Plutus presence: anything a vkey signature alone doesn't settle. */
export function usesScripts(tx: ParsedTx): boolean {
  if (tx.body.scriptDataHash) return true;
  for (const k of [1, 3, 5, 6, 7]) if (tx.witness.has(k)) return true;
  return false;
}

export function addressCred(address: Uint8Array): { payment?: Credential; stake?: Credential; networkId: number } | null {
  try {
    const p = parseAddressBytes(address);
    const out: { payment?: Credential; stake?: Credential; networkId: number } = { networkId: p.networkId };
    if (p.payment) out.payment = p.payment;
    if (p.stake) out.stake = p.stake;
    return out;
  } catch {
    return null;
  }
}
