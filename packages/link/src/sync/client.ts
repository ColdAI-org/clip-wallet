/**
 * The device side of settings sync: a local replica (sealed at rest with the sync data key), signed requests,
 * pull → merge → push with compare-and-set, and adapters ("sources") that map wallet state onto records.
 */
import { ClipError } from "@clip-wallet/core";
import { b64url, openJson, randomBytes, sealJson } from "../bytes.js";
import type { SyncKeyHandle } from "../keys.js";
import { COLLECTIONS, localWrite, mergeRecords, sameValue, stableJson, type Collection, type SyncRecord } from "./records.js";
import {
  SYNC_LIMITS,
  decryptRecord,
  encryptRecord,
  formatAuth,
  recordId,
  signedMessage,
  type ChangesResponse,
  type PushItem,
  type PushResponse,
} from "./protocol.js";

export interface LinkKV {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Row {
  r: SyncRecord;
  /** Server seq this row was last reconciled with (0 = never on the server). */
  seq: number;
  dirty: boolean;
}

interface Replica {
  v: 1;
  cursor: number;
  joined: boolean;
  rows: Record<string, Row>;
}

const emptyReplica = (): Replica => ({ v: 1, cursor: 0, joined: false, rows: {} });

/** Maps one part of wallet state to records (id → JSON value). */
export interface SyncSource {
  collection: Collection;
  read(): Promise<Record<string, unknown>>;
  /** Values that changed because another device wrote them (null = deleted there). */
  apply(changes: { id: string; value: unknown | null }[]): Promise<void>;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  /** Records whose value changed here because of another device. */
  changed: SyncRecord[];
}

export interface SyncEngineOptions {
  baseUrl: string;
  fetch: typeof fetch;
  keys: () => Promise<SyncKeyHandle>;
  kv: LinkKV;
  /** This device's id (random, stable, not secret). */
  device: string;
  now?: () => number;
  storageKey?: string;
}

export const SYNC_REPLICA_KEY = "clip/link/sync-replica";

const offline = () => new ClipError("Sync couldn't reach the server. Your settings are safe on this device; it will try again.", "sync/offline");

export class SyncEngine {
  private readonly now: () => number;
  private readonly key: string;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: SyncEngineOptions) {
    this.now = o.now ?? Date.now;
    this.key = o.storageKey ?? SYNC_REPLICA_KEY;
  }

  /** Serialises every operation on the replica. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => undefined);
    return next;
  }

  private async load(keys: SyncKeyHandle): Promise<Replica> {
    const sealed = await this.o.kv.get<string>(this.key);
    if (!sealed) return emptyReplica();
    try {
      const r = openJson<Replica>(keys.dataKey, sealed, "clip-sync/v1|replica");
      return r?.v === 1 ? r : emptyReplica();
    } catch {
      // Another wallet's replica (the phrase changed): start over.
      return emptyReplica();
    }
  }

  private async save(keys: SyncKeyHandle, r: Replica): Promise<void> {
    await this.o.kv.set(this.key, sealJson(keys.dataKey, r, "clip-sync/v1|replica"));
  }

  /** A local change. `value: null` deletes. */
  write(c: Collection, id: string, value: unknown | null): Promise<void> {
    return this.exclusive(async () => {
      const keys = await this.o.keys();
      const rep = await this.load(keys);
      this.writeInto(rep, keys, c, id, value);
      await this.save(keys, rep);
    });
  }

  private writeInto(rep: Replica, keys: SyncKeyHandle, c: Collection, id: string, value: unknown | null) {
    const rid = recordId(keys.idKey, c, id);
    const prev = rep.rows[rid];
    if (prev && sameValue(prev.r.v, value)) return;
    if (!prev && value === null) return;
    rep.rows[rid] = { r: localWrite(prev?.r, c, id, value, this.o.device, this.now()), seq: prev?.seq ?? 0, dirty: true };
  }

  /** Current values (tombstones omitted). */
  async values(c?: Collection): Promise<SyncRecord[]> {
    return this.exclusive(async () => {
      const rep = await this.load(await this.o.keys());
      return Object.values(rep.rows)
        .map((x) => x.r)
        .filter((r) => r.v !== null && (!c || r.c === c));
    });
  }

  /** Pull, merge, push. Safe to call often; concurrent calls queue. */
  sync(): Promise<SyncResult> {
    return this.exclusive(async () => {
      const keys = await this.o.keys();
      const rep = await this.load(keys);
      const res = await this.syncReplica(keys, rep);
      await this.save(keys, rep);
      return res;
    });
  }

  /**
   * Full round with adapters: on the first sync of this device the server wins (so a new device's defaults don't
   * overwrite settings from your other devices); afterwards local edits are diffed into records, synced, and
   * whatever another device changed is applied back through each source.
   */
  syncSources(sources: SyncSource[]): Promise<SyncResult> {
    return this.exclusive(async () => {
      const keys = await this.o.keys();
      const rep = await this.load(keys);
      const total: SyncResult = { pulled: 0, pushed: 0, changed: [] };
      if (!rep.joined) {
        const first = await this.pull(keys, rep);
        total.pulled += first.pulled;
        await applyChanges(sources, first.changed);
        total.changed.push(...first.changed);
        rep.joined = true;
      }
      for (const s of sources) {
        const local = await s.read();
        const known = new Map(Object.values(rep.rows).filter((x) => x.r.c === s.collection).map((x) => [x.r.id, x.r.v] as const));
        for (const [id, v] of Object.entries(local)) {
          if (!known.has(id) || !sameValue(known.get(id), v)) this.writeInto(rep, keys, s.collection, id, v);
        }
        for (const [id, v] of known) if (v !== null && !(id in local)) this.writeInto(rep, keys, s.collection, id, null);
      }
      const r = await this.syncReplica(keys, rep);
      await applyChanges(sources, r.changed);
      await this.save(keys, rep);
      return { pulled: total.pulled + r.pulled, pushed: r.pushed, changed: [...total.changed, ...r.changed] };
    });
  }

  /** Deletes everything this wallet stored on the sync server and the local replica. */
  async deleteRemote(): Promise<void> {
    return this.exclusive(async () => {
      const keys = await this.o.keys();
      const res = await this.call(keys, "DELETE", "/v1/sync");
      if (res.status !== 204) throw await httpError(res);
      await this.o.kv.remove(this.key);
    });
  }

  private async syncReplica(keys: SyncKeyHandle, rep: Replica): Promise<SyncResult> {
    const p = await this.pull(keys, rep);
    let pushed = 0;
    const changed = [...p.changed];
    for (let round = 0; round < 4; round++) {
      const dirty = Object.entries(rep.rows).filter(([, x]) => x.dirty);
      if (!dirty.length) break;
      for (let i = 0; i < dirty.length; i += SYNC_LIMITS.maxPushRecords) {
        const batch = dirty.slice(i, i + SYNC_LIMITS.maxPushRecords);
        const items: PushItem[] = batch.map(([rid, x]) => ({ rid, base: x.seq, ct: encryptRecord(keys.dataKey, rid, x.r) }));
        const res = await this.call(keys, "POST", "/v1/sync/push", JSON.stringify({ records: items }));
        if (res.status !== 200) throw await httpError(res);
        const body = (await res.json()) as PushResponse;
        for (const a of body.applied) {
          const row = rep.rows[a.rid];
          if (row) {
            row.seq = a.seq;
            row.dirty = false;
            pushed++;
          }
        }
        for (const c of body.conflicts) {
          const row = rep.rows[c.rid];
          if (!row) continue;
          if (!c.ct) {
            row.seq = 0; // gone on the server (deleted there): re-create
            continue;
          }
          const remote = safeDecrypt(keys, c.rid, c.ct);
          row.seq = c.seq;
          if (!remote) continue;
          const merged = mergeRecords(row.r, remote);
          if (!sameValue(merged.v, row.r.v)) changed.push(merged);
          row.r = merged;
          row.dirty = stableJson(merged) !== stableJson(remote);
        }
      }
    }
    return { pulled: p.pulled, pushed, changed: dedupe(changed) };
  }

  private async pull(keys: SyncKeyHandle, rep: Replica): Promise<{ pulled: number; changed: SyncRecord[] }> {
    let pulled = 0;
    const changed: SyncRecord[] = [];
    for (let page = 0; page < 100; page++) {
      const res = await this.call(keys, "GET", `/v1/sync/changes?since=${rep.cursor}`);
      if (res.status !== 200) throw await httpError(res);
      const body = (await res.json()) as ChangesResponse;
      for (const w of body.records) {
        const remote = safeDecrypt(keys, w.rid, w.ct);
        if (!remote) continue;
        pulled++;
        const row = rep.rows[w.rid];
        if (!row) {
          rep.rows[w.rid] = { r: remote, seq: w.seq, dirty: false };
          if (remote.v !== null) changed.push(remote);
          continue;
        }
        const merged = mergeRecords(row.r, remote);
        if (!sameValue(merged.v, row.r.v)) changed.push(merged);
        row.r = merged;
        row.seq = w.seq;
        row.dirty = stableJson(merged) !== stableJson(remote);
      }
      rep.cursor = Math.max(rep.cursor, body.seq);
      if (!body.more) break;
    }
    return { pulled, changed };
  }

  private async call(keys: SyncKeyHandle, method: string, path: string, body = ""): Promise<Response> {
    const ts = this.now();
    const nonce = b64url(randomBytes(16));
    const sig = await keys.sign(signedMessage(method, path, ts, nonce, body));
    try {
      return await this.o.fetch(`${this.o.baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers: { authorization: formatAuth({ pub: b64url(keys.publicKey), ts, nonce, sig: b64url(sig) }), ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body } : {}),
      });
    } catch {
      throw offline();
    }
  }
}

function safeDecrypt(keys: SyncKeyHandle, rid: string, ct: string): SyncRecord | null {
  try {
    return decryptRecord(keys.dataKey, rid, ct);
  } catch {
    return null; // not ours, tampered or damaged: ignore it rather than apply it
  }
}

function dedupe(rs: SyncRecord[]): SyncRecord[] {
  const m = new Map<string, SyncRecord>();
  for (const r of rs) m.set(`${r.c}\u0000${r.id}`, r);
  return [...m.values()];
}

async function applyChanges(sources: SyncSource[], changed: SyncRecord[]) {
  for (const s of sources) {
    const mine = changed.filter((r) => r.c === s.collection);
    if (mine.length) await s.apply(mine.map((r) => ({ id: r.id, value: r.v })));
  }
}

async function httpError(res: Response): Promise<ClipError> {
  let code = "unavailable";
  try {
    code = ((await res.json()) as { error?: string }).error ?? code;
  } catch {
    /* empty */
  }
  if (res.status === 429) return new ClipError("Sync is busy right now. It will try again in a while.", "sync/rate-limited");
  if (res.status === 409) return new ClipError("There's too much to sync. Remove some contacts or bookmarks and try again.", "sync/quota");
  if (res.status === 401) return new ClipError("Sync couldn't sign in. Check this device's clock and try again.", `sync/${code}`);
  return new ClipError("Sync didn't work this time. It will try again.", `sync/${code}`);
}

export { COLLECTIONS };
