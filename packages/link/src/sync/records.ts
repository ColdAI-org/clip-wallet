/**
 * Settings-sync records: per-record last-writer-wins with vector timestamps.
 *
 * Each record carries a vector clock (device id → counter), the wall-clock time of its last write and the
 * device that wrote it. Merging two versions of one record:
 *   - one clock dominates (≥ everywhere): it wins, nothing was lost;
 *   - concurrent (each has a write the other hasn't seen): the later `t` wins, ties broken by device id;
 *   - the merged clock is the element-wise maximum, so the result dominates both inputs.
 * merge() is commutative, associative and idempotent, so every device converges to the same value no matter
 * the order in which it sees updates (tested). Deletions are tombstones (`v: null`) so they sync too.
 */

/** What syncs. Never keys, phrases, passwords or session secrets. */
export const COLLECTIONS = ["contacts", "accounts", "apps", "prefs", "hidden", "bookmarks"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export type VectorClock = Record<string, number>;

export interface SyncRecord<V = unknown> {
  c: Collection;
  id: string;
  /** JSON value; null = deleted. */
  v: V | null;
  clock: VectorClock;
  /** ms since epoch of the write that produced `v`. */
  t: number;
  /** Device that produced `v`. */
  d: string;
}

export type Order = "equal" | "before" | "after" | "concurrent";

/** Compare clocks: "before" means a happened-before b. */
export function compareClocks(a: VectorClock, b: VectorClock): Order {
  let less = false;
  let more = false;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] ?? 0;
    const y = b[k] ?? 0;
    if (x < y) less = true;
    else if (x > y) more = true;
  }
  if (less && more) return "concurrent";
  if (less) return "before";
  if (more) return "after";
  return "equal";
}

export function maxClock(a: VectorClock, b: VectorClock): VectorClock {
  const out: VectorClock = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return sortClock(out);
}

function sortClock(c: VectorClock): VectorClock {
  return Object.fromEntries(Object.entries(c).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
}

/** Total order for concurrent writes: later wall clock, then larger device id, then the value's JSON. */
function laterWrite(a: SyncRecord, b: SyncRecord): SyncRecord {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (a.d !== b.d) return a.d > b.d ? a : b;
  return JSON.stringify(a.v) >= JSON.stringify(b.v) ? a : b;
}

export function mergeRecords<V>(a: SyncRecord<V>, b: SyncRecord<V>): SyncRecord<V> {
  if (a.c !== b.c || a.id !== b.id) throw new Error("merging different records");
  const order = compareClocks(a.clock, b.clock);
  const winner = order === "after" ? a : order === "before" ? b : (laterWrite(a, b) as SyncRecord<V>);
  return { c: winner.c, id: winner.id, v: winner.v, t: winner.t, d: winner.d, clock: maxClock(a.clock, b.clock) };
}

/** A new local write on top of `prev` (or a first write). */
export function localWrite<V>(prev: SyncRecord<V> | undefined, c: Collection, id: string, v: V | null, device: string, now: number): SyncRecord<V> {
  const clock = { ...(prev?.clock ?? {}) };
  clock[device] = (clock[device] ?? 0) + 1;
  // Monotonic per record: a device with a slow clock still produces a write that sorts after what it saw.
  const t = Math.max(now, (prev?.t ?? 0) + 1);
  return { c, id, v, clock: sortClock(clock), t, d: device };
}

export const recordKey = (c: Collection, id: string) => `${c}\u0000${id}`;

export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

/** JSON with sorted object keys, so equal values compare equal regardless of key order. */
export function stableJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  return `{${Object.keys(v as object)
    .sort()
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
