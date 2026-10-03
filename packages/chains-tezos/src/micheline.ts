import { addressFromBytes, fromHex, isHex, isTezosAddress, textOf } from "./encoding.js";

/** Micheline JSON (https://octez.tezos.com/docs/shell/micheline.html). */
export type Micheline =
  | { int: string }
  | { string: string }
  | { bytes: string }
  | { prim: string; args?: Micheline[]; annots?: string[] }
  | Micheline[];

type Obj = Record<string, unknown>;
const obj = (m: unknown): Obj | null => (m && typeof m === "object" && !Array.isArray(m) ? (m as Obj) : null);

export const isPrim = (m: unknown, prim: string): m is { prim: string; args: Micheline[] } => obj(m)?.prim === prim;

/** Right-comb pairs: Pair a b c ≡ Pair a (Pair b c), and a sequence of n≥2 items is also a comb. */
export function pairArgs(m: unknown, n: number): unknown[] | null {
  const o = obj(m);
  let args: unknown[] | null = null;
  if (o?.prim === "Pair" && Array.isArray(o.args)) args = o.args as unknown[];
  else if (Array.isArray(m) && m.length >= 2 && n >= 2) args = m;
  if (!args || args.length < 2) return null;
  if (args.length >= n) return args.length === n ? args : [...args.slice(0, n - 1), { prim: "Pair", args: args.slice(n - 1) }];
  const tail = pairArgs(args[args.length - 1], n - args.length + 1);
  return tail ? [...args.slice(0, -1), ...tail] : null;
}

export function asNat(m: unknown): bigint | null {
  const o = obj(m);
  return typeof o?.int === "string" && /^-?\d+$/.test(o.int) ? BigInt(o.int) : null;
}

export function asAddress(m: unknown): string | null {
  const o = obj(m);
  if (typeof o?.string === "string") {
    const a = o.string.split("%")[0]!;
    return isTezosAddress(a) ? a : null;
  }
  if (typeof o?.bytes === "string" && isHex(o.bytes)) return addressFromBytes(fromHex(o.bytes));
  return null;
}

export interface Fa2Transfer {
  from: string;
  to: string;
  tokenId: string;
  amount: bigint;
}

/** FA2 (TZIP-12) `transfer`: list (pair (address %from_) (list %txs (pair (address %to_) (pair (nat %token_id) (nat %amount))))). */
export function parseFa2Transfer(value: unknown): Fa2Transfer[] | null {
  if (!Array.isArray(value)) return null;
  const out: Fa2Transfer[] = [];
  for (const item of value) {
    const p = pairArgs(item, 2);
    if (!p) return null;
    const from = asAddress(p[0]);
    if (!from || !Array.isArray(p[1])) return null;
    for (const tx of p[1]) {
      const t = pairArgs(tx, 3);
      const to = t && asAddress(t[0]);
      const id = t && asNat(t[1]);
      const amount = t && asNat(t[2]);
      if (!to || id == null || amount == null) return null;
      out.push({ from, to, tokenId: id.toString(), amount });
    }
  }
  return out;
}

/** FA1.2 (TZIP-7) `transfer`: pair (address :from) (pair (address :to) (nat :value)). */
export function parseFa12Transfer(value: unknown): { from: string; to: string; amount: bigint } | null {
  const p = pairArgs(value, 3);
  if (!p) return null;
  const from = asAddress(p[0]);
  const to = asAddress(p[1]);
  const amount = asNat(p[2]);
  return from && to && amount != null ? { from, to, amount } : null;
}

/** FA1.2 `approve`: pair (address :spender) (nat :value). */
export function parseFa12Approve(value: unknown): { spender: string; amount: bigint } | null {
  const p = pairArgs(value, 2);
  if (!p) return null;
  const spender = asAddress(p[0]);
  const amount = asNat(p[1]);
  return spender && amount != null ? { spender, amount } : null;
}

export interface OperatorUpdate {
  add: boolean;
  owner: string;
  operator: string;
  tokenId: string;
}

/** FA2 `update_operators`: list (or (pair %add_operator owner operator token_id) (pair %remove_operator …)). */
export function parseUpdateOperators(value: unknown): OperatorUpdate[] | null {
  if (!Array.isArray(value)) return null;
  const out: OperatorUpdate[] = [];
  for (const item of value) {
    const o = obj(item);
    const add = o?.prim === "Left";
    if (!o || (!add && o.prim !== "Right") || !Array.isArray(o.args)) return null;
    const p = pairArgs(o.args[0], 3);
    const owner = p && asAddress(p[0]);
    const operator = p && asAddress(p[1]);
    const id = p && asNat(p[2]);
    if (!owner || !operator || id == null) return null;
    out.push({ add, owner, operator, tokenId: id.toString() });
  }
  return out;
}

/** Short, readable Micheline for previews (truncated). */
export function preview(m: unknown, max = 160): string {
  const s = render(m, 0);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function render(m: unknown, depth: number): string {
  if (depth > 8) return "…";
  if (Array.isArray(m)) return `[${m.map((x) => render(x, depth + 1)).join(", ")}]`;
  const o = obj(m);
  if (!o) return String(m);
  if (typeof o.int === "string") return o.int;
  if (typeof o.string === "string") return JSON.stringify(o.string);
  if (typeof o.bytes === "string") {
    const a = addressFromBytes(isHex(o.bytes) ? fromHex(o.bytes) : new Uint8Array());
    return a ?? `0x${o.bytes}`;
  }
  if (typeof o.prim === "string") {
    const args = Array.isArray(o.args) ? (o.args as unknown[]) : [];
    if (!args.length) return o.prim;
    return `${o.prim}(${args.map((x) => render(x, depth + 1)).join(", ")})`;
  }
  return "?";
}

/* ------------------------------------------------------------------ packed data (0x05) */

export type Packed = { kind: "string"; text: string } | { kind: "bytes"; bytes: Uint8Array } | { kind: "other" };

/**
 * PACKed Micheline: 0x05 then the binary expression. A string is 0x01 + uint32 BE length + UTF-8; bytes are
 * 0x0a + uint32 length + data. That is the form of Beacon / TZIP sign-in messages
 * ("05" + "01" + length + utf8("Tezos Signed Message: …")).
 */
export function unpack(bytes: Uint8Array): Packed | null {
  if (bytes[0] !== 0x05 || bytes.length < 2) return null;
  const tag = bytes[1];
  if ((tag === 0x01 || tag === 0x0a) && bytes.length >= 6) {
    const len = ((bytes[2]! << 24) | (bytes[3]! << 16) | (bytes[4]! << 8) | bytes[5]!) >>> 0;
    if (len !== bytes.length - 6) return { kind: "other" };
    const body = bytes.subarray(6);
    if (tag === 0x0a) return { kind: "bytes", bytes: body };
    const text = textOf(body);
    return text == null ? { kind: "other" } : { kind: "string", text };
  }
  return { kind: "other" };
}
