import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BackupClient, BLOB_MIN_BYTES, sha256b64url } from "@clip-wallet/backup-client";
import { createApp, MemoryEmailSender, type Env } from "../src/index";
import { clearJwksCache } from "../src/oidc";
import { APPLE_CLIENT_ID, CHALLENGE, GOOGLE_CLIENT_ID, ID_TOKENS, JWKS_BOTH, JWKS_KEY1, NOW_S, VERIFIER } from "./oidc-fixtures";

const BASE = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
const NOW = NOW_S * 1000;
const PUBLIC_URL = "https://clip-backup.example.workers.dev";
const RETURN = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/backup";
/** Test-only stand-ins (not real credentials). */
const SECRETS = { GOOGLE_CLIENT_SECRET: "test-google-secret-not-real", APPLE_CLIENT_SECRET: "test-apple-client-secret-jwt-not-real" };

const SOCIAL_ENV: Partial<Env> = {
  PUBLIC_URL,
  OIDC_RETURN_URLS: `${RETURN}, https://other.example/cb`,
  GOOGLE_CLIENT_ID,
  APPLE_CLIENT_ID,
  ...SECRETS,
};

beforeAll(async () => {
  await applyD1Migrations(BASE.DB, BASE.TEST_MIGRATIONS);
});
beforeEach(() => clearJwksCache());

let ip = 0;
/** A Worker app with mocked Google/Apple endpoints. `idToken` is what the token endpoint hands back. */
function harness(o: { env?: Partial<Env>; idToken?: string; jwks?: () => unknown; tokenStatus?: number; now?: () => number } = {}) {
  const E = { ...BASE, ...SOCIAL_ENV, ...(o.env ?? {}) } as Env;
  const out: { url: string; body: string }[] = [];
  let jwksFetches = 0;
  const providerFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    out.push({ url, body: String(init?.body ?? "") });
    if (url === "https://oauth2.googleapis.com/token" || url === "https://appleid.apple.com/auth/token") {
      return Response.json(o.tokenStatus && o.tokenStatus !== 200 ? { error: "invalid_grant" } : { access_token: "at", token_type: "Bearer", id_token: o.idToken ?? ID_TOKENS.google }, { status: o.tokenStatus ?? 200 });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs" || url === "https://appleid.apple.com/auth/keys") {
      jwksFetches++;
      return Response.json(o.jwks ? o.jwks() : JWKS_BOTH);
    }
    return new Response("unexpected", { status: 599 });
  }) as typeof fetch;
  const app = createApp({ email: new MemoryEmailSender(), fetch: providerFetch, now: o.now ?? (() => NOW) });
  const myIp = `198.51.100.${++ip}`;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), { ...init, redirect: "manual" });
    req.headers.set("cf-connecting-ip", myIp);
    return app.fetch(req, E);
  }) as typeof fetch;
  const client = () => new BackupClient({ baseUrl: PUBLIC_URL, fetch: f, now: o.now ?? (() => NOW), randomBytes: (n) => new Uint8Array(n).fill(9) });
  return { E, f, client, out, jwksFetches: () => jwksFetches };
}

/** Plays the provider: the browser lands on our callback with `code`, and follows the 303. */
async function providerReturns(h: ReturnType<typeof harness>, authorizationUrl: string, how: "query" | "form_post" = "query", extra: Record<string, string> = {}) {
  const state = new URL(authorizationUrl).searchParams.get("state")!;
  const params = new URLSearchParams({ state, code: "auth-code-from-provider", ...extra });
  const res =
    how === "query"
      ? await h.f(`${PUBLIC_URL}/v1/auth/oidc/callback?${params}`)
      : await h.f(`${PUBLIC_URL}/v1/auth/oidc/callback`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params.toString() });
  return res;
}

function blob(seed = 1): Uint8Array {
  const b = new Uint8Array(BLOB_MIN_BYTES);
  b.set([0x43, 0x4c, 0x50, 0x42, 1]);
  for (let i = 5; i < b.length; i++) b[i] = (i * 13 + seed) & 0xff;
  return b;
}

describe("which sign-in methods are on", () => {
  it("each provider is off until its own client id and secret are set", async () => {
    const off = harness({ env: { GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, APPLE_CLIENT_ID: undefined, APPLE_CLIENT_SECRET: undefined } });
    expect(await off.client().providers()).toEqual({ email: true, google: false, apple: false });
    const googleOnly = harness({ env: { APPLE_CLIENT_SECRET: undefined } });
    expect(await googleOnly.client().providers()).toEqual({ email: true, google: true, apple: false });
    const noReturn = harness({ env: { OIDC_RETURN_URLS: "" } });
    expect(await noReturn.client().providers()).toMatchObject({ google: false, apple: false });
  });

  it("a switched-off provider says so plainly and stores nothing", async () => {
    const h = harness({ env: { APPLE_CLIENT_SECRET: undefined } });
    await expect(h.client().startSocialSignIn("apple", RETURN)).rejects.toMatchObject({ code: "backup/provider-unavailable", userMessage: expect.stringMatching(/Use your email/) });
    expect(h.out).toEqual([]);
  });

  it("only returns to allow-listed wallet URLs", async () => {
    const h = harness();
    await expect(h.client().startSocialSignIn("google", "https://evil.example/cb")).rejects.toMatchObject({ code: "backup/bad-return" });
  });
});

describe("Continue with Google", () => {
  it("authorization request: code flow, PKCE S256, nonce = the device's challenge, our callback", async () => {
    const h = harness();
    const { authorizationUrl, pending } = await h.client().startSocialSignIn("google", RETURN);
    expect(pending.verifier).toBe(VERIFIER);
    const u = new URL(authorizationUrl);
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const q = Object.fromEntries(u.searchParams);
    expect(q).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${PUBLIC_URL}/v1/auth/oidc/callback`,
      response_type: "code",
      scope: "openid email",
      nonce: CHALLENGE,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    expect(q.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl).not.toContain(VERIFIER);
    expect(authorizationUrl).not.toContain(SECRETS.GOOGLE_CLIENT_SECRET);
  });

  it("end to end: callback exchanges the code (with PKCE), verifies the ID token, and the wallet gets a session", async () => {
    const h = harness();
    const c = h.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    const res = await providerReturns(h, authorizationUrl);
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location).toMatch(new RegExp(`^${RETURN.replace(/[.]/g, "\\.")}#state=[A-Za-z0-9_-]{43}&handoff=[A-Za-z0-9_-]{43}$`));

    const tokenCall = h.out.find((x) => x.url === "https://oauth2.googleapis.com/token")!;
    const form = new URLSearchParams(tokenCall.body);
    expect(Object.fromEntries(form)).toMatchObject({
      grant_type: "authorization_code",
      code: "auth-code-from-provider",
      client_id: GOOGLE_CLIENT_ID,
      client_secret: SECRETS.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${PUBLIC_URL}/v1/auth/oidc/callback`,
    });
    expect(await sha256b64url(form.get("code_verifier")!)).toBe(new URL(authorizationUrl).searchParams.get("code_challenge"));

    expect(await c.completeSocialSignIn(location, pending)).toEqual({ provider: "google" });
    expect(c.signedIn).toBe(true);
    const { id } = await c.upload(blob(), { credentialId: "Y3JlZA", rpId: null });
    expect((await c.list()).map((b) => b.id)).toEqual([id]);

    // The server keeps only hashes: no email, no provider subject, no state/handoff/code in D1.
    const handoff = new URLSearchParams(location.split("#")[1]).get("handoff")!;
    for (const table of ["accounts", "sessions", "oidc_states", "rate_limits", "backups"]) {
      const dump = JSON.stringify((await h.E.DB.prepare(`SELECT * FROM ${table}`).all()).results);
      for (const secret of ["someone@example.com", "110000000000000000001", handoff, pending.state, "auth-code-from-provider", SECRETS.GOOGLE_CLIENT_SECRET]) {
        expect(dump).not.toContain(secret);
      }
    }
  });

  it("the same Google account finds its backups again; another account doesn't see them", async () => {
    const h = harness();
    const first = h.client();
    let s = await first.startSocialSignIn("google", RETURN);
    await first.completeSocialSignIn((await providerReturns(h, s.authorizationUrl)).headers.get("location")!, s.pending);
    const { id } = await first.upload(blob(7), { credentialId: "Y3JlZA", rpId: null });

    const again = h.client();
    s = await again.startSocialSignIn("google", RETURN);
    await again.completeSocialSignIn((await providerReturns(h, s.authorizationUrl)).headers.get("location")!, s.pending);
    expect((await again.list()).map((b) => b.id)).toContain(id);

    const other = harness({ idToken: ID_TOKENS.googleOtherUser });
    const oc = other.client();
    s = await oc.startSocialSignIn("google", RETURN);
    await oc.completeSocialSignIn((await providerReturns(other, s.authorizationUrl)).headers.get("location")!, s.pending);
    expect((await oc.list()).map((b) => b.id)).not.toContain(id);
  });

  it("follows a JWKS key rotation (an unknown kid triggers one refetch, at most once a minute)", async () => {
    // Warm the cache with key 1 only.
    const c0 = harness({ jwks: () => JWKS_KEY1 });
    const w = await c0.client().startSocialSignIn("google", RETURN);
    expect((await providerReturns(c0, w.authorizationUrl)).headers.get("location")).toContain("handoff=");
    // Same minute: a token signed by the new key is refused (no JWKS hammering)…
    const soon = harness({ idToken: ID_TOKENS.googleRotatedKey, jwks: () => JWKS_BOTH });
    const s1 = await soon.client().startSocialSignIn("google", RETURN);
    expect((await providerReturns(soon, s1.authorizationUrl)).headers.get("location")).toContain("error=failed");
    expect(soon.jwksFetches()).toBe(0);
    // …two minutes later the unknown kid makes the Worker refetch, and it verifies.
    const later = harness({ idToken: ID_TOKENS.googleRotatedKey, jwks: () => JWKS_BOTH, now: () => NOW + 120_000 });
    const c = later.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    const loc = (await providerReturns(later, authorizationUrl)).headers.get("location")!;
    expect(loc).toContain("handoff=");
    await c.completeSocialSignIn(loc, pending);
    expect(later.jwksFetches()).toBe(1);
  });
});

describe("Sign in with Apple", () => {
  it("form_post callback, no PKCE (Apple doesn't publish it), no name/email scope; works end to end", async () => {
    const h = harness({ idToken: ID_TOKENS.apple });
    const c = h.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("apple", RETURN);
    const u = new URL(authorizationUrl);
    expect(u.origin + u.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: APPLE_CLIENT_ID, response_type: "code", response_mode: "form_post", nonce: CHALLENGE });
    expect(u.searchParams.has("scope")).toBe(false);
    expect(u.searchParams.has("code_challenge")).toBe(false);
    const res = await providerReturns(h, authorizationUrl, "form_post");
    expect(res.status).toBe(303);
    const form = new URLSearchParams(h.out.find((x) => x.url === "https://appleid.apple.com/auth/token")!.body);
    expect(form.get("client_secret")).toBe(SECRETS.APPLE_CLIENT_SECRET);
    expect(form.has("code_verifier")).toBe(false);
    await c.completeSocialSignIn(res.headers.get("location")!, pending);
    expect(c.signedIn).toBe(true);
  });

  it("a Google ID token is not accepted for Apple (issuer/audience are per provider)", async () => {
    const h = harness({ idToken: ID_TOKENS.google });
    const { authorizationUrl } = await h.client().startSocialSignIn("apple", RETURN);
    const loc = (await providerReturns(h, authorizationUrl, "form_post")).headers.get("location")!;
    expect(loc).toContain("error=failed");
  });
});

describe("ID token verification and attacks", () => {
  const badTokens: [string, string][] = [
    ["another app's audience", ID_TOKENS.googleWrongAud],
    ["a nonce from another device", ID_TOKENS.googleWrongNonce],
    ["a foreign issuer", ID_TOKENS.googleWrongIss],
    ["a tampered payload", (() => {
      const [hd, , sig] = ID_TOKENS.google.split(".");
      const [, otherPayload] = ID_TOKENS.googleOtherUser.split(".");
      return `${hd}.${otherPayload}.${sig}`;
    })()],
    ["alg none", `${btoa(JSON.stringify({ alg: "none", kid: "test-key-1" })).replace(/=+$/, "")}.${ID_TOKENS.google.split(".")[1]}.`],
    ["garbage", "not-a-jwt"],
  ];
  it.each(badTokens)("refuses %s: the wallet is sent back with an error and no session exists", async (_why, token) => {
    const h = harness({ idToken: token });
    const c = h.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    const loc = (await providerReturns(h, authorizationUrl)).headers.get("location")!;
    expect(loc).toMatch(/#state=[^&]+&error=failed$/);
    await expect(c.completeSocialSignIn(loc, pending)).rejects.toMatchObject({ code: "backup/social-failed" });
  });

  it("refuses an expired ID token", async () => {
    const h = harness({ now: () => NOW + 2 * 3600_000 });
    const { authorizationUrl } = await h.client().startSocialSignIn("google", RETURN);
    expect((await providerReturns(h, authorizationUrl)).headers.get("location")).toContain("error=failed");
  });

  it("a failed code exchange never echoes the provider's answer or our secret", async () => {
    const h = harness({ tokenStatus: 400 });
    const { authorizationUrl } = await h.client().startSocialSignIn("google", RETURN);
    const res = await providerReturns(h, authorizationUrl);
    const loc = res.headers.get("location")!;
    expect(loc).toContain("error=failed");
    expect(loc).not.toContain("invalid_grant");
    expect(loc).not.toContain(SECRETS.GOOGLE_CLIENT_SECRET);
  });

  it("user cancelled at the provider", async () => {
    const h = harness();
    const c = h.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    const res = await h.f(`${PUBLIC_URL}/v1/auth/oidc/callback?state=${state}&error=access_denied`);
    await expect(c.completeSocialSignIn(res.headers.get("location")!, pending)).rejects.toMatchObject({ code: "backup/social-cancelled" });
  });

  it("login CSRF: an authorization URL someone else started is useless to them and to you", async () => {
    const h = harness();
    // The attacker starts sign-in on their device and sends the victim the authorization URL.
    const attacker = h.client();
    const { authorizationUrl, pending } = await attacker.startSocialSignIn("google", RETURN);
    // The victim signs in at Google; the redirect (with the handoff) lands in the victim's browser.
    const loc = (await providerReturns(h, authorizationUrl)).headers.get("location")!;
    const state = pending.state;
    // The attacker has the verifier but not the handoff:
    const guess = await h.f(`${PUBLIC_URL}/v1/auth/oidc/finish`, { method: "POST", body: JSON.stringify({ state, handoff: "A".repeat(43), verifier: pending.verifier }) });
    expect(guess.status).toBe(400);
    // The victim's browser has the handoff but not the attacker's verifier:
    const handoff = new URLSearchParams(loc.split("#")[1]).get("handoff")!;
    const victim = await h.f(`${PUBLIC_URL}/v1/auth/oidc/finish`, { method: "POST", body: JSON.stringify({ state, handoff, verifier: "B".repeat(43) }) });
    expect(victim.status).toBe(400);
    expect(((await victim.json()) as { error: string }).error).toBe("link-other-device");
  });

  it("each attempt's callback and finish work once", async () => {
    const h = harness();
    const c = h.client();
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    const loc = (await providerReturns(h, authorizationUrl)).headers.get("location")!;
    expect((await providerReturns(h, authorizationUrl)).status).toBe(400);
    await c.completeSocialSignIn(loc, pending);
    await expect(h.client().completeSocialSignIn(loc, pending)).rejects.toMatchObject({ code: "backup/state-invalid" });
  });

  it("attempts expire after 10 minutes", async () => {
    let t = NOW - 11 * 60_000;
    const h = harness({ now: () => t });
    const { authorizationUrl } = await h.client().startSocialSignIn("google", RETURN);
    t = NOW;
    expect((await providerReturns(h, authorizationUrl)).status).toBe(400);
  });

  it("deleting the account also forgets its social sign-in attempts", async () => {
    const h = harness();
    const c = h.client();
    const s = await c.startSocialSignIn("google", RETURN);
    await c.completeSocialSignIn((await providerReturns(h, s.authorizationUrl)).headers.get("location")!, s.pending);
    await c.deleteAccount();
    const { results } = await h.E.DB.prepare("SELECT COUNT(*) AS n FROM oidc_states o WHERE o.account IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = o.account)").all<{ n: number }>();
    expect(results[0]!.n).toBe(0);
  });
});
