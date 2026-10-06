/**
 * Settings sync endpoints (/v1/sync/*) on D1. The protocol, authentication and size caps live in
 * @clip-wallet/link/sync-server (handleSync); this file is the D1 store, Ed25519 verification with WebCrypto and
 * rate limiting. The server only ever stores opaque record ids and XChaCha20-Poly1305 ciphertext.
 */
import { handleSync, SyncHttpError, type SyncStore } from "@clip-wallet/link/sync-server";
import { RULES, enforce } from "./ratelimit.js";
import { HttpError, readTextCapped, sha256Hex } from "./util.js";

/** @clip-wallet/link SYNC_LIMITS.maxBodyBytes (not exported from the sync-server entry). */
const SYNC_MAX_BODY_BYTES = 512 * 1024;

export class D1SyncStore implements SyncStore {
  constructor(
    private readonly db: D1Database,
    private readonly now: () => number,
  ) {}

  async usage(space: string) {
    const r = await this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(ct)), 0) AS b FROM sync_records WHERE space = ?1").bind(space).first<{ n: number; b: number }>();
    return { records: r?.n ?? 0, bytes: r?.b ?? 0 };
  }

  async changes(space: string, since: number, limit: number) {
    const head = await this.db.prepare("SELECT seq FROM sync_spaces WHERE space = ?1").bind(space).first<{ seq: number }>();
    const { results } = await this.db
      .prepare("SELECT rid, seq, ct FROM sync_records WHERE space = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3")
      .bind(space, since, limit)
      .all<{ rid: string; seq: number; ct: string }>();
    return { seq: head?.seq ?? 0, records: results };
  }

  async put(space: string, rid: string, base: number, ct: string) {
    const row = await this.db
      .prepare("INSERT INTO sync_spaces (space, seq, updated_at) VALUES (?1, 1, ?2) ON CONFLICT (space) DO UPDATE SET seq = seq + 1, updated_at = ?2 RETURNING seq")
      .bind(space, this.now())
      .first<{ seq: number }>();
    const seq = row!.seq;
    const r =
      base === 0
        ? await this.db.prepare("INSERT INTO sync_records (space, rid, seq, ct) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (space, rid) DO NOTHING").bind(space, rid, seq, ct).run()
        : await this.db.prepare("UPDATE sync_records SET seq = ?3, ct = ?4 WHERE space = ?1 AND rid = ?2 AND seq = ?5").bind(space, rid, seq, ct, base).run();
    if (r.meta.changes) return { ok: true as const, seq };
    const cur = await this.db.prepare("SELECT rid, seq, ct FROM sync_records WHERE space = ?1 AND rid = ?2").bind(space, rid).first<{ rid: string; seq: number; ct: string }>();
    return { ok: false as const, current: cur ?? null };
  }

  async useNonce(space: string, nonce: string, expiresAt: number) {
    const r = await this.db
      .prepare("INSERT INTO sync_nonces (space, nonce, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT (space, nonce) DO NOTHING")
      .bind(space, await sha256Hex(nonce), expiresAt)
      .run();
    return r.meta.changes > 0;
  }

  async wipe(space: string) {
    await this.db.batch([
      this.db.prepare("DELETE FROM sync_records WHERE space = ?1").bind(space),
      this.db.prepare("DELETE FROM sync_spaces WHERE space = ?1").bind(space),
      this.db.prepare("DELETE FROM sync_nonces WHERE space = ?1").bind(space),
    ]);
  }
}

async function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (publicKey.length !== 32 || signature.length !== 64) return false;
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "Ed25519" }, key, signature, message);
}

export async function syncRoute(req: Request, env: { DB: D1Database }, now: () => number, ip: string): Promise<Response> {
  await enforce(env.DB, RULES.syncPerIp, ip, now());
  const url = new URL(req.url);
  // Read capped (audit BKP-01); handleSync checks the exact limit (SYNC_LIMITS.maxBodyBytes) and answers 413 itself.
  const body = req.method === "GET" || req.method === "DELETE" ? "" : await readTextCapped(req, SYNC_MAX_BODY_BYTES + 1);
  try {
    const r = await handleSync(
      { method: req.method, pathAndQuery: url.pathname + url.search, authorization: req.headers.get("authorization"), body },
      {
        store: new D1SyncStore(env.DB, now),
        verify: verifyEd25519,
        now,
        onAuthenticated: (space) => enforce(env.DB, RULES.syncPerSpace, space, now()),
      },
    );
    return new Response(r.body === null ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: r.body === null ? {} : { "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof SyncHttpError) throw new HttpError(e.status, e.code, e.message);
    throw e;
  }
}

export async function cleanupSync(db: D1Database, now: number) {
  await db.prepare("DELETE FROM sync_nonces WHERE expires_at < ?1").bind(now).run();
}
