import { HttpError, sha256Hex } from "./util.js";

export interface Rule {
  scope: string;
  limit: number;
  windowMs: number;
}

/** Limits are deliberately tight: a person backs up a handful of times, ever. */
export const RULES = {
  startPerIp: { scope: "start-ip", limit: 10, windowMs: 60 * 60_000 },
  startPerEmail: { scope: "start-email", limit: 5, windowMs: 60 * 60_000 },
  verifyPerIp: { scope: "verify-ip", limit: 30, windowMs: 60 * 60_000 },
  apiPerAccount: { scope: "api-account", limit: 120, windowMs: 60 * 60_000 },
  uploadPerAccount: { scope: "upload-account", limit: 20, windowMs: 24 * 60 * 60_000 },
  // Settings sync: a device syncs on changes and every few minutes; a household's devices share one IP.
  syncPerIp: { scope: "sync-ip", limit: 2000, windowMs: 60 * 60_000 },
  syncPerSpace: { scope: "sync-space", limit: 600, windowMs: 60 * 60_000 },
} as const satisfies Record<string, Rule>;

/**
 * Fixed-window counter in D1 (one upsert per check). Subject values (IPs, account hashes) are hashed before
 * they are stored. Throws 429 with Retry-After when over the limit.
 */
export async function enforce(db: D1Database, rule: Rule, subject: string, now: number): Promise<void> {
  const window = Math.floor(now / rule.windowMs);
  const key = `${rule.scope}:${await sha256Hex(subject)}`;
  const row = await db
    .prepare("INSERT INTO rate_limits (key, win, count) VALUES (?1, ?2, 1) ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count")
    .bind(key, window)
    .first<{ count: number }>();
  if ((row?.count ?? 0) > rule.limit) {
    const retry = Math.ceil(((window + 1) * rule.windowMs - now) / 1000);
    throw new HttpError(429, "rate-limited", "Too many requests.", { "retry-after": String(Math.max(1, retry)) });
  }
}

export async function cleanupWindows(db: D1Database, now: number): Promise<void> {
  // Windows are per-rule, so drop anything older than the longest rule's previous window.
  const oldest = Math.floor(now / (24 * 60 * 60_000)) - 1;
  await db.prepare("DELETE FROM rate_limits WHERE win < ?1 AND key NOT LIKE 'upload-account:%'").bind(Math.floor(now / (60 * 60_000)) - 1).run();
  await db.prepare("DELETE FROM rate_limits WHERE win < ?1 AND key LIKE 'upload-account:%'").bind(oldest).run();
}
