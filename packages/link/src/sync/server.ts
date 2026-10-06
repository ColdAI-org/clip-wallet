/**
 * The settings-sync server, storage-agnostic. services/backup runs it on D1 (src/sync.ts there); tests run it on
 * MemorySyncStore. It authenticates requests with the Ed25519 sync key (verify only, injected), enforces size
 * caps, and stores ciphertext it cannot read. See protocol.ts for the wire format.
 *
 * @module
 */
import { fromB64url, toHex, sha256 } from "../bytes.js";
import type { VerifyFn } from "../keys.js";
import {
  CT,
  RID,
  SYNC_LIMITS,
  parseAuth,
  signedMessage,
  type ChangesResponse,
  type PushItem,
  type PushResponse,
  type WireRecord,
} from "./protocol.js";

export interface SyncStore {
  usage(space: string): Promise<{ records: number; bytes: number }>;
  changes(space: string, since: number, limit: number): Promise<{ seq: number; records: WireRecord[] }>;
  /** Compare-and-set: applies only if the stored seq for rid is `base` (0 = absent). Returns the new seq or the current row. */
  put(space: string, rid: string, base: number, ct: string): Promise<{ ok: true; seq: number } | { ok: false; current: WireRecord | null }>;
  /** False if this nonce was already used for this space (replay). */
  useNonce(space: string, nonce: string, expiresAt: number): Promise<boolean>;
  wipe(space: string): Promise<void>;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SyncRequest {
  method: string;
  /** Path plus query exactly as sent ("/v1/sync/changes?since=3"). */
  pathAndQuery: string;
  authorization: string | null;
  body: string;
}

export interface SyncServerDeps {
  store: SyncStore;
  verify: VerifyFn;
  now?: () => number;
  /** Called with the space once the request is authenticated (rate limiting per sync key). */
  onAuthenticated?: (space: string) => Promise<void>;
}

/** Authenticates and serves one request. Throws SyncHttpError for every refusal. */
export async function handleSync(req: SyncRequest, deps: SyncServerDeps): Promise<{ status: number; body: unknown }> {
  const now = (deps.now ?? Date.now)();
  if (req.body.length > SYNC_LIMITS.maxBodyBytes) throw new SyncHttpError(413, "too-large", "Request body too large.");
  const auth = parseAuth(req.authorization);
  if (!auth) throw new SyncHttpError(401, "unauthorized", "Missing or malformed sync signature.");
  if (Math.abs(auth.ts - now) > SYNC_LIMITS.clockSkewMs) throw new SyncHttpError(401, "clock-skew", "Request time is too far from the server's.");
  const pub = fromB64url(auth.pub);
  const sig = fromB64url(auth.sig);
  let ok = false;
  try {
    ok = await deps.verify(pub, signedMessage(req.method, req.pathAndQuery, auth.ts, auth.nonce, req.body), sig);
  } catch {
    ok = false;
  }
  if (!ok) throw new SyncHttpError(401, "unauthorized", "Bad sync signature.");
  const space = toHex(sha256(pub));
  if (!(await deps.store.useNonce(space, auth.nonce, now + SYNC_LIMITS.nonceTtlMs))) throw new SyncHttpError(401, "replay", "This request was already used.");
  await deps.onAuthenticated?.(space);

  const url = new URL(req.pathAndQuery, "https://sync.invalid");
  const p = url.pathname.replace(/\/+$/, "");
  const m = req.method.toUpperCase();
  if (m === "GET" && p === "/v1/sync/changes") {
    const since = Number(url.searchParams.get("since") ?? "0");
    if (!Number.isSafeInteger(since) || since < 0) throw new SyncHttpError(400, "bad-request", "since must be a non-negative integer.");
    const r = await deps.store.changes(space, since, SYNC_LIMITS.pageSize + 1);
    const more = r.records.length > SYNC_LIMITS.pageSize;
    const records = r.records.slice(0, SYNC_LIMITS.pageSize);
    const body: ChangesResponse = { seq: more ? records.at(-1)!.seq : r.seq, records, more };
    return { status: 200, body };
  }
  if (m === "POST" && p === "/v1/sync/push") return { status: 200, body: await push(space, req.body, deps.store) };
  if (m === "DELETE" && p === "/v1/sync") {
    await deps.store.wipe(space);
    return { status: 204, body: null };
  }
  throw new SyncHttpError(404, "not-found", "Not found.");
}

async function push(space: string, raw: string, store: SyncStore): Promise<PushResponse> {
  let body: { records?: unknown };
  try {
    body = JSON.parse(raw) as { records?: unknown };
  } catch {
    throw new SyncHttpError(400, "bad-request", "Expected a JSON object.");
  }
  const items = body?.records;
  if (!Array.isArray(items) || items.length === 0 || items.length > SYNC_LIMITS.maxPushRecords) {
    throw new SyncHttpError(400, "bad-request", `records must be 1 to ${SYNC_LIMITS.maxPushRecords} items.`);
  }
  const seen = new Set<string>();
  for (const it of items as PushItem[]) {
    if (!it || typeof it !== "object" || typeof it.rid !== "string" || !RID.test(it.rid) || typeof it.ct !== "string" || !Number.isSafeInteger(it.base) || it.base < 0) {
      throw new SyncHttpError(400, "bad-request", "Each record needs rid, base and ct.");
    }
    if (it.ct.length > SYNC_LIMITS.maxRecordCt) throw new SyncHttpError(413, "record-too-large", "A record is too large.");
    if (!CT.test(it.ct)) throw new SyncHttpError(400, "bad-request", "ct must be base64url ciphertext.");
    if (seen.has(it.rid)) throw new SyncHttpError(400, "bad-request", "A record appears twice.");
    seen.add(it.rid);
  }
  const usage = await store.usage(space);
  const added = (items as PushItem[]).filter((i) => i.base === 0).length;
  const bytes = (items as PushItem[]).reduce((n, i) => n + i.ct.length, 0);
  if (usage.records + added > SYNC_LIMITS.maxRecordsPerSpace) throw new SyncHttpError(409, "quota", "Too many synced items.");
  if (usage.bytes + bytes > SYNC_LIMITS.maxBytesPerSpace) throw new SyncHttpError(409, "quota", "Synced data is too large.");
  const out: PushResponse = { applied: [], conflicts: [] };
  for (const it of items as PushItem[]) {
    const r = await store.put(space, it.rid, it.base, it.ct);
    if (r.ok) out.applied.push({ rid: it.rid, seq: r.seq });
    else if (r.current) out.conflicts.push(r.current);
    else out.conflicts.push({ rid: it.rid, seq: 0, ct: "" });
  }
  return out;
}

/** In-memory store (tests, local dev). */
export class MemorySyncStore implements SyncStore {
  readonly spaces = new Map<string, { seq: number; rows: Map<string, WireRecord> }>();
  readonly nonces = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}

  private space(s: string) {
    let v = this.spaces.get(s);
    if (!v) this.spaces.set(s, (v = { seq: 0, rows: new Map() }));
    return v;
  }
  async usage(space: string) {
    const v = this.space(space);
    return { records: v.rows.size, bytes: [...v.rows.values()].reduce((n, r) => n + r.ct.length, 0) };
  }
  async changes(space: string, since: number, limit: number) {
    const v = this.space(space);
    const records = [...v.rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq).slice(0, limit);
    return { seq: v.seq, records: records.map((r) => ({ ...r })) };
  }
  async put(space: string, rid: string, base: number, ct: string) {
    const v = this.space(space);
    const cur = v.rows.get(rid);
    if ((cur?.seq ?? 0) !== base) return { ok: false as const, current: cur ? { ...cur } : null };
    const seq = ++v.seq;
    v.rows.set(rid, { rid, seq, ct });
    return { ok: true as const, seq };
  }
  async useNonce(space: string, nonce: string, expiresAt: number) {
    const k = `${space}:${nonce}`;
    const t = this.now();
    for (const [key, exp] of this.nonces) if (exp < t) this.nonces.delete(key);
    if (this.nonces.has(k)) return false;
    this.nonces.set(k, expiresAt);
    return true;
  }
  async wipe(space: string) {
    this.spaces.delete(space);
  }
}
