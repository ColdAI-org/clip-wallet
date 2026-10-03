/**
 * "Continue with Google" / "Sign in with Apple" for the backup service (OpenID Connect, authorization code).
 *
 * Social sign-in only answers "which backup account is this?": the account key becomes
 * HMAC(EMAIL_PEPPER, "<provider>:<sub>"). It never holds or unlocks a key; backups stay passkey-encrypted
 * ciphertext. Each provider is on only when its own client id + secret are set (Worker secrets / vars).
 *
 * Flow (the Worker is a confidential client; its callback is the redirect_uri registered with the provider):
 *   1. wallet: verifier v (random, stays on the device); POST /v1/auth/oidc/start { provider, challenge = b64url(SHA-256(v)), returnTo }
 *      → { authorizationUrl } with state (random), nonce = challenge, and for Google PKCE S256 with the Worker's
 *        own verifier (Apple publishes no code_challenge_methods_supported, so its leg has no PKCE).
 *   2. browser → provider → GET/POST /v1/auth/oidc/callback?state&code
 *      Worker: exchanges the code, verifies the ID token (JWKS signature RS256, iss, aud, exp/iat, nonce = challenge),
 *      marks the attempt ready, and 303-redirects to `returnTo#state=…&handoff=…` (one-time, fragment only).
 *   3. wallet: POST /v1/auth/oidc/finish { state, handoff, verifier } → session. Needs BOTH the handoff (only the
 *      browser that finished the provider login has it) and v (only the device that started has it), so an
 *      authorization URL sent to someone else, or a stolen redirect, signs nobody in.
 *
 * Sources (checked 2026-10-03): https://accounts.google.com/.well-known/openid-configuration,
 * https://developers.google.com/identity/openid-connect/openid-connect (ID token validation),
 * https://appleid.apple.com/.well-known/openid-configuration,
 * https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens.
 */
import { sha256b64url } from "@clip-wallet/backup-client/protocol";
import { HttpError, hmacHex, randomToken, safeEqual, sha256Hex } from "./util.js";

export type Provider = "google" | "apple";
export const PROVIDERS: readonly Provider[] = ["google", "apple"];

export interface OidcEnv {
  EMAIL_PEPPER?: string;
  /** This Worker's public base URL; the callback is `${PUBLIC_URL}/v1/auth/oidc/callback`. */
  PUBLIC_URL?: string;
  /** Comma-separated exact URLs the wallet may be sent back to (e.g. https://<extension id>.chromiumapp.org/backup). */
  OIDC_RETURN_URLS?: string;
  GOOGLE_CLIENT_ID?: string;
  /** Secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Apple Services ID. */
  APPLE_CLIENT_ID?: string;
  /** Secret: the ES256 client-secret JWT (≤ 6 months; see docs/phase25/deploy.md to mint and rotate). */
  APPLE_CLIENT_SECRET?: string;
}

interface ProviderSpec {
  authorize: string;
  token: string;
  jwks: string;
  issuers: string[];
  scope: string | null;
  pkce: boolean;
  /** Apple returns to the callback with an HTML form POST. */
  responseMode: "query" | "form_post";
}

export const SPECS: Record<Provider, ProviderSpec> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    // Google requires openid plus email or profile; the email claim is ignored and never stored.
    scope: "openid email",
    pkce: true,
    responseMode: "query",
  },
  apple: {
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    jwks: "https://appleid.apple.com/auth/keys",
    issuers: ["https://appleid.apple.com"],
    // No scope: we ask Apple for neither name nor email, only the stable `sub`.
    scope: null,
    pkce: false,
    responseMode: "form_post",
  },
};

export const OIDC_TTL_MS = 10 * 60_000;
const MAX_FINISH_ATTEMPTS = 5;
const CLOCK_SKEW_S = 60;

function credentials(env: OidcEnv, p: Provider): { id: string; secret: string } | null {
  const id = (p === "google" ? env.GOOGLE_CLIENT_ID : env.APPLE_CLIENT_ID)?.trim();
  const secret = p === "google" ? env.GOOGLE_CLIENT_SECRET : env.APPLE_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

function returnUrls(env: OidcEnv): string[] {
  return (env.OIDC_RETURN_URLS ?? "").split(",").map((s) => s.trim()).filter((s) => /^https:\/\/[^\s#]+$/.test(s));
}

/** True when this provider can be used: its credentials, the pepper, the public URL and a return URL are set. */
export function providerEnabled(env: OidcEnv, p: Provider): boolean {
  return !!credentials(env, p) && (env.EMAIL_PEPPER?.length ?? 0) >= 32 && /^https:\/\//.test(env.PUBLIC_URL ?? "") && returnUrls(env).length > 0;
}

const callbackUrl = (env: OidcEnv) => `${env.PUBLIC_URL!.replace(/\/+$/, "")}/v1/auth/oidc/callback`;

/* ------------------------------------------------------------------ JWT / JWKS */

interface Jwk {
  kty: string;
  kid?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();

/** Test hook: forget cached keys. */
export function clearJwksCache(): void {
  jwksCache.clear();
}

async function jwks(url: string, f: typeof fetch, now: number, force: boolean): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  // Keys rotate rarely; refetch at most once a minute when a token names a kid we don't have.
  if (hit && (!force || now - hit.fetchedAt < 60_000) && now - hit.fetchedAt < 6 * 3600_000) return hit.keys;
  const res = await f(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new HttpError(502, "provider-unavailable", "The sign-in provider didn't answer.");
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(url, { keys, fetchedAt: now });
  return keys;
}

function fromB64urlBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function jsonPart(s: string): Record<string, unknown> {
  const v = JSON.parse(new TextDecoder().decode(fromB64urlBytes(s))) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
  return v as Record<string, unknown>;
}

export interface VerifiedIdToken {
  sub: string;
}

/**
 * Verifies an OIDC ID token: RS256 signature against the provider's JWKS, `iss`, `aud` (= our client id),
 * `exp`/`iat` with 60 s skew, and `nonce` (= the device's challenge). Throws HttpError("id-token-invalid").
 */
export async function verifyIdToken(
  token: string,
  o: { provider: Provider; clientId: string; nonce: string; now: number; fetch: typeof fetch },
): Promise<VerifiedIdToken> {
  const bad = () => new HttpError(400, "id-token-invalid", "The sign-in provider's answer couldn't be verified.");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw bad();
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = jsonPart(parts[0]!);
    claims = jsonPart(parts[1]!);
  } catch {
    throw bad();
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw bad();
  const spec = SPECS[o.provider];
  let key = (await jwks(spec.jwks, o.fetch, o.now, false)).find((k) => k.kid === header.kid);
  if (!key) key = (await jwks(spec.jwks, o.fetch, o.now, true)).find((k) => k.kid === header.kid);
  if (!key || key.kty !== "RSA" || !key.n || !key.e || (key.alg && key.alg !== "RS256") || (key.use && key.use !== "sig")) throw bad();
  const cryptoKey = await crypto.subtle.importKey("jwk", { kty: "RSA", n: key.n, e: key.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, fromB64urlBytes(parts[2]!), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad();

  const nowS = Math.floor(o.now / 1000);
  const aud = claims.aud;
  const audOk = aud === o.clientId || (Array.isArray(aud) && aud.includes(o.clientId) && claims.azp === o.clientId);
  if (typeof claims.iss !== "string" || !spec.issuers.includes(claims.iss)) throw bad();
  if (!audOk) throw bad();
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) throw bad();
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_S > nowS || nowS - claims.iat > OIDC_TTL_MS / 1000) throw bad();
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, o.nonce)) throw bad();
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw bad();
  return { sub: claims.sub };
}

/* ------------------------------------------------------------------ endpoints */

export interface OidcDeps {
  fetch: typeof fetch;
  now: () => number;
}

export async function oidcStart(env: OidcEnv & { DB: D1Database }, body: Partial<{ provider: string; challenge: string; returnTo: string }>, d: OidcDeps) {
  const provider = body.provider as Provider;
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, "bad-request", "Unknown sign-in provider.");
  if (typeof body.challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) throw new HttpError(400, "bad-request", "challenge is required.");
  if (!providerEnabled(env, provider)) throw new HttpError(503, "provider-unavailable", "That sign-in option isn't set up.");
  if (typeof body.returnTo !== "string" || !returnUrls(env).includes(body.returnTo)) throw new HttpError(400, "bad-return", "That return address isn't allowed.");
  const spec = SPECS[provider];
  const creds = credentials(env, provider)!;
  const state = randomToken();
  const pkceVerifier = spec.pkce ? randomToken() : null;
  await env.DB.prepare("INSERT INTO oidc_states (state_hash, provider, challenge, pkce_verifier, return_to, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(await sha256Hex(state), provider, body.challenge, pkceVerifier, body.returnTo, d.now() + OIDC_TTL_MS)
    .run();
  const q = new URLSearchParams({ client_id: creds.id, redirect_uri: callbackUrl(env), response_type: "code", state, nonce: body.challenge, response_mode: spec.responseMode });
  if (spec.scope) q.set("scope", spec.scope);
  if (pkceVerifier) {
    q.set("code_challenge", await sha256b64url(pkceVerifier));
    q.set("code_challenge_method", "S256");
  }
  if (provider === "google") q.set("prompt", "select_account");
  return { authorizationUrl: `${spec.authorize}?${q}` };
}

interface StateRow {
  provider: Provider;
  challenge: string;
  pkce_verifier: string | null;
  return_to: string;
  expires_at: number;
  status: string;
  account: string | null;
  handoff_hash: string | null;
  attempts: number;
}

function redirect(to: string): Response {
  return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

/** Provider → Worker. Always ends in a redirect to the wallet (or a plain 400 when the attempt is unknown). */
export async function oidcCallback(env: OidcEnv & { DB: D1Database }, params: URLSearchParams, d: OidcDeps): Promise<Response> {
  const state = params.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new HttpError(400, "state-invalid", "This sign-in expired. Go back to the wallet and try again.");
  const stateHash = await sha256Hex(state);
  const row = await env.DB.prepare("SELECT * FROM oidc_states WHERE state_hash = ?1").bind(stateHash).first<StateRow>();
  if (!row || row.status !== "pending" || row.expires_at <= d.now()) throw new HttpError(400, "state-invalid", "This sign-in expired. Go back to the wallet and try again.");
  // One callback per attempt, whatever happens next.
  const claimed = await env.DB.prepare("UPDATE oidc_states SET status = 'exchanging' WHERE state_hash = ?1 AND status = 'pending'").bind(stateHash).run();
  if (!claimed.meta.changes) throw new HttpError(400, "state-invalid", "This sign-in expired. Go back to the wallet and try again.");
  const back = (frag: Record<string, string>) => redirect(`${row.return_to}#${new URLSearchParams({ state, ...frag })}`);
  const fail = async (code: string) => {
    await env.DB.prepare("UPDATE oidc_states SET status = 'failed' WHERE state_hash = ?1").bind(stateHash).run();
    return back({ error: code });
  };
  const code = params.get("code");
  if (params.get("error") || !code || code.length > 2048) return fail(params.get("error") === "access_denied" || params.get("error") === "user_cancelled_authorize" ? "cancelled" : "failed");
  const creds = credentials(env, row.provider);
  if (!creds || !providerEnabled(env, row.provider)) return fail("failed");
  const spec = SPECS[row.provider];
  const form = new URLSearchParams({ grant_type: "authorization_code", code, client_id: creds.id, client_secret: creds.secret, redirect_uri: callbackUrl(env) });
  if (row.pkce_verifier) form.set("code_verifier", row.pkce_verifier);
  let idToken: string;
  try {
    const res = await d.fetch(spec.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString() });
    if (!res.ok) return fail("failed");
    const t = (await res.json()) as { id_token?: unknown };
    if (typeof t.id_token !== "string" || t.id_token.length > 8192) return fail("failed");
    idToken = t.id_token;
  } catch {
    return fail("failed");
  }
  let sub: string;
  try {
    ({ sub } = await verifyIdToken(idToken, { provider: row.provider, clientId: creds.id, nonce: row.challenge, now: d.now(), fetch: d.fetch }));
  } catch {
    return fail("failed");
  }
  const account = await hmacHex(env.EMAIL_PEPPER!, `${row.provider}:${sub}`);
  const handoff = randomToken();
  await env.DB.prepare("UPDATE oidc_states SET status = 'ready', account = ?2, handoff_hash = ?3, pkce_verifier = NULL WHERE state_hash = ?1")
    .bind(stateHash, account, await sha256Hex(handoff))
    .run();
  return back({ handoff });
}

/** Wallet → Worker: trade the handoff + the device's verifier for a session (the account must already be ready). */
export async function oidcFinish(
  env: OidcEnv & { DB: D1Database },
  body: Partial<{ state: string; handoff: string; verifier: string }>,
  d: OidcDeps,
): Promise<{ account: string; provider: Provider }> {
  const t43 = /^[A-Za-z0-9_-]{43}$/;
  if (typeof body.state !== "string" || !t43.test(body.state) || typeof body.handoff !== "string" || !t43.test(body.handoff) || typeof body.verifier !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)) {
    throw new HttpError(400, "bad-request", "state, handoff and verifier are required.");
  }
  const stateHash = await sha256Hex(body.state);
  const row = await env.DB.prepare("SELECT * FROM oidc_states WHERE state_hash = ?1").bind(stateHash).first<StateRow>();
  if (!row || row.status !== "ready" || !row.account || !row.handoff_hash || row.expires_at <= d.now() || row.attempts >= MAX_FINISH_ATTEMPTS) {
    throw new HttpError(400, "state-invalid", "This sign-in expired. Try again.");
  }
  const handoffOk = safeEqual(await sha256Hex(body.handoff), row.handoff_hash);
  const verifierOk = safeEqual(await sha256b64url(body.verifier), row.challenge);
  if (!handoffOk || !verifierOk) {
    await env.DB.prepare("UPDATE oidc_states SET attempts = attempts + 1 WHERE state_hash = ?1").bind(stateHash).run();
    throw new HttpError(400, "link-other-device", "Finish signing in on the device where you started.");
  }
  const used = await env.DB.prepare("UPDATE oidc_states SET status = 'used' WHERE state_hash = ?1 AND status = 'ready'").bind(stateHash).run();
  if (!used.meta.changes) throw new HttpError(400, "state-invalid", "This sign-in expired. Try again.");
  return { account: row.account, provider: row.provider };
}

