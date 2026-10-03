/** Multi-asset values: lovelace plus native assets keyed by unit (policy id hex + asset name hex). */
import { CborMap, type CborValue, asBytes, asInt } from "./cbor.js";
import { hex } from "./util.js";

export interface Value {
  coin: bigint;
  assets: Map<string, bigint>;
}

export const emptyValue = (): Value => ({ coin: 0n, assets: new Map() });

export function addValue(into: Value, v: Value, sign: 1n | -1n = 1n): Value {
  into.coin += sign * v.coin;
  for (const [u, q] of v.assets) {
    const n = (into.assets.get(u) ?? 0n) + sign * q;
    if (n === 0n) into.assets.delete(u);
    else into.assets.set(u, n);
  }
  return into;
}

export const cloneValue = (v: Value): Value => ({ coin: v.coin, assets: new Map(v.assets) });

export const policyOf = (unit: string) => unit.slice(0, 56);
export const nameOf = (unit: string) => unit.slice(56);

/** `coin / [coin, multiasset<uint>]` → Value. Mint maps (signed quantities) parse with `parseMultiasset`. */
export function parseValue(v: CborValue): Value {
  const coin = asInt(v);
  if (coin !== null) return { coin, assets: new Map() };
  if (Array.isArray(v) && v.length === 2) {
    const c = asInt(v[0]!);
    if (c === null) throw new Error("bad value coin");
    return { coin: c, assets: parseMultiasset(v[1]!) };
  }
  throw new Error("bad value");
}

export function parseMultiasset(v: CborValue): Map<string, bigint> {
  if (!(v instanceof CborMap)) throw new Error("bad multiasset");
  const out = new Map<string, bigint>();
  for (const [pk, inner] of v.entries) {
    const policy = asBytes(pk);
    if (!policy || policy.length !== 28 || !(inner instanceof CborMap)) throw new Error("bad multiasset entry");
    for (const [nk, q] of inner.entries) {
      const name = asBytes(nk);
      const qty = asInt(q);
      if (!name || name.length > 32 || qty === null) throw new Error("bad asset");
      const unit = hex(policy) + hex(name);
      out.set(unit, (out.get(unit) ?? 0n) + qty);
    }
  }
  return out;
}

export function encodeMultiasset(assets: Map<string, bigint>): CborMap {
  const byPolicy = new Map<string, [string, bigint][]>();
  for (const [u, q] of [...assets].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (q === 0n) continue;
    const p = policyOf(u);
    const list = byPolicy.get(p) ?? [];
    list.push([nameOf(u), q]);
    byPolicy.set(p, list);
  }
  const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  return new CborMap([...byPolicy].map(([p, names]) => [fromHex(p), new CborMap(names.map(([n, q]) => [fromHex(n), q]))]));
}

export function encodeValue(v: Value): CborValue {
  const nonZero = [...v.assets].filter(([, q]) => q !== 0n);
  return nonZero.length ? [v.coin, encodeMultiasset(new Map(nonZero))] : v.coin;
}

/** Does `have` cover `need` (coin and every asset)? */
export function covers(have: Value, need: Value): boolean {
  if (have.coin < need.coin) return false;
  for (const [u, q] of need.assets) if ((have.assets.get(u) ?? 0n) < q) return false;
  return true;
}

/** CIP-67 asset name labels used by CIP-68. */
export const CIP68 = { reference: "000643b0", nft: "000de140", ft: "0014df10", rft: "001bc280" } as const;

export function cip68Label(assetNameHex: string): keyof typeof CIP68 | null {
  const p = assetNameHex.slice(0, 8).toLowerCase();
  for (const [k, v] of Object.entries(CIP68) as [keyof typeof CIP68, string][]) if (v === p) return k;
  return null;
}

/** Human-readable asset name: CIP-68 label stripped, UTF-8 if printable, else hex. */
export function displayAssetName(assetNameHex: string): string {
  const body = cip68Label(assetNameHex) ? assetNameHex.slice(8) : assetNameHex;
  const bytes = Uint8Array.from(body.match(/../g) ?? [], (x) => parseInt(x, 16));
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (s && !/[\u0000-\u001f\u007f]/.test(s)) return s;
  } catch {
    /* not text */
  }
  return body || "(no name)";
}
