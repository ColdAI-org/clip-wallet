/**
 * Backup API (v1). See README.md for the threat model.
 *
 *   POST   /v1/auth/start     { email, challenge }      → 202   emails a one-time link (always 202: no account probing)
 *   POST   /v1/auth/verify    { token, verifier }       → 200 { session, expiresAt }
 *   POST   /v1/auth/sign-out                            → 204
 *   GET    /v1/backups                                  → 200 { backups: BackupMeta[] }
 *   POST   /v1/backups        { blob, credentialId, rpId } → 201 { id }
 *   GET    /v1/backups/:id                              → 200 BackupRecord
 *   DELETE /v1/backups/:id                              → 204
 *   DELETE /v1/account                                  → 204   (every backup and session for this email)
 *   GET    /v1/auth/providers                           → 200 { email, google, apple }   which sign-in methods are switched on
 *   POST   /v1/auth/oidc/start  { provider, challenge, returnTo } → 200 { authorizationUrl }   (src/oidc.ts)
 *   GET|POST /v1/auth/oidc/callback  (from Google / Apple)  → 303 returnTo#state=…&handoff=…
 *   POST   /v1/auth/oidc/finish { state, handoff, verifier } → 200 { session, expiresAt, provider }
 *   GET    /v1/health                                   → 200
 */
import {
  type BackupMeta,
  type StartSignInBody,
  type UploadBody,
  type VerifyBody,
  LIMITS,
  fromB64url,
  isPasskeyBackupBlob,
  normaliseEmail,
  sha256b64url,
} from "@clip-wallet/backup-client/protocol";
import { EmailUnavailableError, UnconfiguredEmailSender, signInEmail, type EmailSender } from "./email.js";
import { PROVIDERS, oidcCallback, oidcFinish, oidcStart, providerEnabled, type OidcEnv } from "./oidc.js";
import { RULES, cleanupWindows, enforce } from "./ratelimit.js";
import { HttpError, hmacHex, randomToken, readJson, safeEqual, sha256Hex } from "./util.js";

export interface Env extends OidcEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
  /** Secret. Keys accounts by HMAC(email); without it the service refuses to run (fails closed). */
  EMAIL_PEPPER?: string;
  APP_URL: string;
  ALLOWED_ORIGINS?: string;
  /** Secret. Resend API key; with EMAIL_FROM set, the deployed entry point sends sign-in links through Resend. */
  RESEND_API_KEY?: string;
  /** Sender for sign-in emails, on a domain verified in Resend, e.g. "Clip Wallet <backup@example.com>". */
  EMAIL_FROM?: string;
}

export interface AppDeps {
  email?: EmailSender;
  now?: () => number;
  /** Outbound fetch for the OIDC token and JWKS endpoints (tests pass a mock). */
  fetch?: typeof fetch;
  walletName?: string;
}

const B64URL_ID = /^[A-Za-z0-9_-]{22}$/;
const CRED_ID = /^[A-Za-z0-9_-]{1,1400}$/;
const RP_ID = /^[a-z0-9.-]{1,253}$/;

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...(body === null ? {} : { "content-type": "application/json" }), ...extra },
  });
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

export function createApp(deps: AppDeps = {}) {
  const email = deps.email ?? new UnconfiguredEmailSender();
  const now = deps.now ?? Date.now;
  const outbound: typeof fetch = deps.fetch ?? ((...a) => fetch(...a));
  const oidcDeps = { fetch: outbound, now };

  async function accountOf(env: Env, rawEmail: string): Promise<{ email: string; account: string }> {
    const e = normaliseEmail(rawEmail);
    if (!e) throw new HttpError(400, "bad-email", "That email address doesn't look right.");
    if (!env.EMAIL_PEPPER || env.EMAIL_PEPPER.length < 32) throw new HttpError(503, "unavailable", "Service not configured.");
    return { email: e, account: await hmacHex(env.EMAIL_PEPPER, e) };
  }

  async function sessionAccount(req: Request, env: Env): Promise<string> {
    const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "");
    if (!m) throw new HttpError(401, "unauthorized", "Sign in first.");
    const row = await env.DB.prepare("SELECT account, expires_at FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(m[1]!)).first<{ account: string; expires_at: number }>();
    if (!row || row.expires_at <= now()) throw new HttpError(401, "unauthorized", "Sign in first.");
    await enforce(env.DB, RULES.apiPerAccount, row.account, now());
    return row.account;
  }

  async function start(req: Request, env: Env): Promise<Response> {
    // No provider: refuse before touching the database (no link, no rate-limit row, nothing stored).
    if (email instanceof UnconfiguredEmailSender) throw new HttpError(503, "email-unavailable", "Email isn't configured.");
    const body = await readJson<Partial<StartSignInBody>>(req);
    if (typeof body.email !== "string" || typeof body.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) {
      throw new HttpError(400, "bad-request", "email and challenge are required.");
    }
    await enforce(env.DB, RULES.startPerIp, clientIp(req), now());
    const { email: addr, account } = await accountOf(env, body.email);
    await enforce(env.DB, RULES.startPerEmail, account, now());
    const token = randomToken();
    await env.DB.prepare("INSERT INTO magic_links (token_hash, account, challenge, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await sha256Hex(token), account, body.challenge, now() + LIMITS.linkTtlMs)
      .run();
    const link = `${env.APP_URL.replace(/#.*$/, "")}#/backup/sign-in?token=${token}`;
    try {
      await email.send(signInEmail(addr, link, deps.walletName));
    } catch (e) {
      await env.DB.prepare("DELETE FROM magic_links WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
      if (e instanceof EmailUnavailableError) throw new HttpError(503, "email-unavailable", "Email isn't configured.");
      throw new HttpError(502, "email-unavailable", "Couldn't send the email.");
    }
    return json(202, { ok: true });
  }

  async function verify(req: Request, env: Env): Promise<Response> {
    await enforce(env.DB, RULES.verifyPerIp, clientIp(req), now());
    const body = await readJson<Partial<VerifyBody>>(req);
    if (typeof body.token !== "string" || typeof body.verifier !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || !/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)) {
      throw new HttpError(400, "bad-request", "token and verifier are required.");
    }
    const tokenHash = await sha256Hex(body.token);
    const link = await env.DB.prepare("SELECT account, challenge, expires_at, attempts, used FROM magic_links WHERE token_hash = ?1")
      .bind(tokenHash)
      .first<{ account: string; challenge: string; expires_at: number; attempts: number; used: number }>();
    if (!link || link.used || link.expires_at <= now() || link.attempts >= LIMITS.maxVerifyAttemptsPerLink) {
      throw new HttpError(400, "link-invalid", "That link has expired or was already used.");
    }
    if (!safeEqual(await sha256b64url(body.verifier), link.challenge)) {
      await env.DB.prepare("UPDATE magic_links SET attempts = attempts + 1 WHERE token_hash = ?1").bind(tokenHash).run();
      throw new HttpError(400, "link-other-device", "Open the link on the device that asked for it.");
    }
    // Single use: only the request that flips `used` gets a session.
    const claimed = await env.DB.prepare("UPDATE magic_links SET used = 1 WHERE token_hash = ?1 AND used = 0").bind(tokenHash).run();
    if (!claimed.meta.changes) throw new HttpError(400, "link-invalid", "That link has expired or was already used.");
    return json(200, await createSession(env, link.account));
  }

  async function createSession(env: Env, account: string): Promise<{ session: string; expiresAt: number }> {
    const session = randomToken();
    const expiresAt = now() + LIMITS.sessionTtlMs;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (id, created_at) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING").bind(account, now()),
      env.DB.prepare("INSERT INTO sessions (token_hash, account, expires_at) VALUES (?1, ?2, ?3)").bind(await sha256Hex(session), account, expiresAt),
    ]);
    return { session, expiresAt };
  }

  function emailEnabled(env: Env): boolean {
    return !(email instanceof UnconfiguredEmailSender) && (env.EMAIL_PEPPER?.length ?? 0) >= 32;
  }

  /** No provider is switched on: social sign-in endpoints refuse before touching D1 (nothing is stored). */
  function requireAnyProvider(env: Env) {
    if (!PROVIDERS.some((p) => providerEnabled(env, p))) throw new HttpError(503, "provider-unavailable", "That sign-in option isn't set up.");
  }

  async function socialStart(req: Request, env: Env): Promise<Response> {
    const body = await readJson<{ provider?: string; challenge?: string; returnTo?: string }>(req);
    // A switched-off provider is refused before the rate limiter writes its row, like email sign-in.
    if (PROVIDERS.includes(body.provider as never) && !providerEnabled(env, body.provider as never)) {
      throw new HttpError(503, "provider-unavailable", "That sign-in option isn't set up.");
    }
    await enforce(env.DB, RULES.startPerIp, clientIp(req), now());
    return json(200, await oidcStart(env, body, oidcDeps));
  }

  async function socialCallback(req: Request, env: Env): Promise<Response> {
    requireAnyProvider(env);
    await enforce(env.DB, RULES.verifyPerIp, clientIp(req), now());
    let params = new URL(req.url).searchParams;
    if (req.method === "POST") {
      // Apple answers with an HTML form POST (response_mode=form_post).
      const text = await req.text();
      if (text.length > 8192) throw new HttpError(413, "too-large", "Request body too large.");
      params = new URLSearchParams(text);
    }
    return oidcCallback(env, params, oidcDeps);
  }

  async function socialFinish(req: Request, env: Env): Promise<Response> {
    requireAnyProvider(env);
    await enforce(env.DB, RULES.verifyPerIp, clientIp(req), now());
    const body = await readJson<{ state?: string; handoff?: string; verifier?: string }>(req);
    const { account, provider } = await oidcFinish(env, body, oidcDeps);
    return json(200, { ...(await createSession(env, account)), provider });
  }

  async function listBackups(env: Env, account: string): Promise<Response> {
    const { results } = await env.DB.prepare("SELECT id, created_at, credential_id, rp_id FROM backups WHERE account = ?1 ORDER BY created_at DESC")
      .bind(account)
      .all<{ id: string; created_at: number; credential_id: string; rp_id: string | null }>();
    const backups: BackupMeta[] = results.map((r) => ({ id: r.id, createdAt: r.created_at, credentialId: r.credential_id, rpId: r.rp_id }));
    return json(200, { backups });
  }

  async function upload(req: Request, env: Env, account: string): Promise<Response> {
    await enforce(env.DB, RULES.uploadPerAccount, account, now());
    const body = await readJson<Partial<UploadBody>>(req, 4096);
    const blob = typeof body.blob === "string" ? fromB64url(body.blob) : null;
    if (!blob || !isPasskeyBackupBlob(blob)) throw new HttpError(400, "bad-blob", "Not a Clip passkey backup.");
    const credBytes = typeof body.credentialId === "string" && CRED_ID.test(body.credentialId) ? fromB64url(body.credentialId) : null;
    if (!credBytes || credBytes.length === 0 || credBytes.length > LIMITS.maxCredentialIdBytes) throw new HttpError(400, "bad-request", "credentialId is required.");
    const rpId = body.rpId ?? null;
    if (rpId !== null && (typeof rpId !== "string" || !RP_ID.test(rpId))) throw new HttpError(400, "bad-request", "rpId must be a domain or null.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM backups WHERE account = ?1").bind(account).first<{ n: number }>();
    if ((count?.n ?? 0) >= LIMITS.maxBackupsPerAccount) throw new HttpError(409, "too-many-backups", "Delete an old backup first.");
    const id = randomToken(16);
    await env.BLOBS.put(`b/${id}`, blob, { httpMetadata: { contentType: "application/octet-stream" } });
    await env.DB.prepare("INSERT INTO backups (id, account, credential_id, rp_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, account, body.credentialId!, rpId, now())
      .run();
    return json(201, { id });
  }

  async function getBackup(env: Env, account: string, id: string): Promise<Response> {
    const row = await env.DB.prepare("SELECT id, created_at, credential_id, rp_id FROM backups WHERE id = ?1 AND account = ?2")
      .bind(id, account)
      .first<{ id: string; created_at: number; credential_id: string; rp_id: string | null }>();
    if (!row) throw new HttpError(404, "not-found", "No such backup.");
    const obj = await env.BLOBS.get(`b/${id}`);
    if (!obj) throw new HttpError(404, "not-found", "No such backup.");
    const bytes = new Uint8Array(await obj.arrayBuffer());
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    const blob = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return json(200, { id: row.id, createdAt: row.created_at, credentialId: row.credential_id, rpId: row.rp_id, blob });
  }

  async function deleteBackup(env: Env, account: string, id: string): Promise<Response> {
    const r = await env.DB.prepare("DELETE FROM backups WHERE id = ?1 AND account = ?2").bind(id, account).run();
    if (!r.meta.changes) throw new HttpError(404, "not-found", "No such backup.");
    await env.BLOBS.delete(`b/${id}`);
    return json(204, null);
  }

  async function deleteAccount(env: Env, account: string): Promise<Response> {
    const { results } = await env.DB.prepare("SELECT id FROM backups WHERE account = ?1").bind(account).all<{ id: string }>();
    if (results.length) await env.BLOBS.delete(results.map((r) => `b/${r.id}`));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM backups WHERE account = ?1").bind(account),
      env.DB.prepare("DELETE FROM sessions WHERE account = ?1").bind(account),
      env.DB.prepare("DELETE FROM magic_links WHERE account = ?1").bind(account),
      env.DB.prepare("DELETE FROM oidc_states WHERE account = ?1").bind(account),
      env.DB.prepare("DELETE FROM accounts WHERE id = ?1").bind(account),
    ]);
    return json(204, null);
  }

  async function route(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "");
    const m = req.method;
    if (m === "GET" && p === "/v1/health") return json(200, { ok: true, emailSignIn: emailEnabled(env) });
    if (m === "GET" && p === "/v1/auth/providers") {
      return json(200, { email: emailEnabled(env), ...Object.fromEntries(PROVIDERS.map((x) => [x, providerEnabled(env, x)])) });
    }
    if (m === "POST" && p === "/v1/auth/oidc/start") return socialStart(req, env);
    if ((m === "GET" || m === "POST") && p === "/v1/auth/oidc/callback") return socialCallback(req, env);
    if (m === "POST" && p === "/v1/auth/oidc/finish") return socialFinish(req, env);
    if (m === "POST" && p === "/v1/auth/start") return start(req, env);
    if (m === "POST" && p === "/v1/auth/verify") return verify(req, env);
    if (m === "POST" && p === "/v1/auth/sign-out") {
      const tok = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.get("authorization") ?? "")?.[1];
      if (tok) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(tok)).run();
      return json(204, null);
    }
    if (p === "/v1/backups" && m === "GET") return listBackups(env, await sessionAccount(req, env));
    if (p === "/v1/backups" && m === "POST") return upload(req, env, await sessionAccount(req, env));
    const bm = /^\/v1\/backups\/([^/]+)$/.exec(p);
    if (bm) {
      const id = decodeURIComponent(bm[1]!);
      if (!B64URL_ID.test(id)) throw new HttpError(404, "not-found", "No such backup.");
      if (m === "GET") return getBackup(env, await sessionAccount(req, env), id);
      if (m === "DELETE") return deleteBackup(env, await sessionAccount(req, env), id);
    }
    if (m === "DELETE" && p === "/v1/account") return deleteAccount(env, await sessionAccount(req, env));
    throw new HttpError(404, "not-found", "Not found.");
  }

  return {
    async fetch(req: Request, env: Env): Promise<Response> {
      const c = cors(req, env);
      if (req.method === "OPTIONS") return new Response(null, { status: c["access-control-allow-origin"] ? 204 : 403, headers: { ...BASE_HEADERS, ...c } });
      try {
        const res = await route(req, env);
        for (const [k, v] of Object.entries(c)) res.headers.set(k, v);
        return res;
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, { error: e.code, message: e.message }, { ...e.headers, ...c });
        // Never echo internal errors (they could include query text).
        return json(500, { error: "unavailable", message: "Something went wrong." }, c);
      }
    },

    /** Cron: drop expired links, sessions and old rate-limit windows. */
    async cleanup(env: Env): Promise<void> {
      const t = now();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM magic_links WHERE expires_at < ?1").bind(t - 24 * 60 * 60_000),
        env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(t),
        env.DB.prepare("DELETE FROM oidc_states WHERE expires_at < ?1").bind(t - 60 * 60_000),
      ]);
      await cleanupWindows(env.DB, t);
    },
  };
}
