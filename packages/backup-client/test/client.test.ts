import { describe, expect, it } from "vitest";
import { BackupClient, BLOB_MAX_BYTES, BLOB_MIN_BYTES, b64url, fromB64url, isPasskeyBackupBlob, normaliseEmail, sha256b64url, tokenFromLink } from "../src/index.js";

/** A structurally valid blob (random bytes after the header; nothing here is a real backup). */
function blob(len = BLOB_MIN_BYTES): Uint8Array {
  const b = new Uint8Array(len);
  b.set([0x43, 0x4c, 0x50, 0x42, 1]);
  for (let i = 5; i < len; i++) b[i] = (i * 37) & 0xff;
  return b;
}

function recorder(responses: [number, unknown][]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const [status, body] = responses.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe("protocol helpers", () => {
  it("accepts only 12/24-word CLPB v1 blobs", () => {
    expect(isPasskeyBackupBlob(blob())).toBe(true);
    expect(isPasskeyBackupBlob(blob(BLOB_MAX_BYTES))).toBe(true);
    expect(isPasskeyBackupBlob(blob(100))).toBe(false);
    const wrongVersion = blob();
    wrongVersion[4] = 2;
    expect(isPasskeyBackupBlob(wrongVersion)).toBe(false);
    expect(isPasskeyBackupBlob(new Uint8Array(BLOB_MIN_BYTES))).toBe(false);
  });
  it("normalises emails", () => {
    expect(normaliseEmail("  Me@Example.COM ")).toBe("me@example.com");
    for (const e of ["", "me", "me@x", "a b@c.de", "<x>@y.zz", `${"a".repeat(250)}@x.com`]) expect(normaliseEmail(e)).toBeNull();
  });
  it("b64url round-trips and rejects junk", () => {
    const b = blob();
    expect(fromB64url(b64url(b))).toEqual(b);
    expect(fromB64url("not base64!")).toBeNull();
  });
  it("extracts the token from a pasted link", () => {
    const t = "A".repeat(43);
    expect(tokenFromLink(`https://wallet.example/#/backup/sign-in?token=${t}`)).toBe(t);
    expect(tokenFromLink(`  ${t} `)).toBe(t);
    expect(tokenFromLink("https://evil.example/?token=short")).toBeNull();
  });
  it("PKCE challenge is SHA-256 of the verifier (RFC 7636 S256 test vector)", async () => {
    expect(await sha256b64url("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("BackupClient", () => {
  it("sign-in sends the challenge, never the verifier, until verify", async () => {
    const { f, calls } = recorder([
      [202, { ok: true }],
      [200, { session: "S".repeat(43), expiresAt: Date.now() + 1000 }],
    ]);
    const c = new BackupClient({ baseUrl: "https://backup.example/", fetch: f });
    const pending = await c.startSignIn("Me@Example.com");
    const startBody = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe("https://backup.example/v1/auth/start");
    expect(startBody).toEqual({ email: "me@example.com", challenge: await sha256b64url(pending.verifier) });
    expect(JSON.stringify(startBody)).not.toContain(pending.verifier);
    await c.completeSignIn(`https://x/#token=${"T".repeat(43)}`, pending);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ token: "T".repeat(43), verifier: pending.verifier });
    expect(c.signedIn).toBe(true);
  });

  it("refuses bad emails and bad blobs before any network call", async () => {
    const { f, calls } = recorder([]);
    const c = new BackupClient({ baseUrl: "https://b", fetch: f, session: { token: "x", expiresAt: Date.now() + 1e6 } });
    await expect(c.startSignIn("nope")).rejects.toMatchObject({ code: "backup/bad-email" });
    await expect(c.upload(new Uint8Array(10), { credentialId: "AA", rpId: null })).rejects.toMatchObject({ code: "backup/bad-blob" });
    expect(calls).toHaveLength(0);
  });

  it("maps server errors to plain words and drops the session on 401", async () => {
    const { f } = recorder([
      [429, { error: "rate-limited", message: "slow down" }],
      [401, { error: "unauthorized", message: "no" }],
    ]);
    const c = new BackupClient({ baseUrl: "https://b", fetch: f, session: { token: "x", expiresAt: Date.now() + 1e6 } });
    await expect(c.list()).rejects.toMatchObject({ code: "backup/rate-limited", userMessage: expect.stringMatching(/Too many tries/) });
    await expect(c.list()).rejects.toMatchObject({ code: "backup/unauthorized" });
    expect(c.signedIn).toBe(false);
  });

  it("download validates the blob it gets back", async () => {
    const good = blob();
    const { f } = recorder([
      [200, { id: "a", createdAt: 1, credentialId: "AQ", rpId: null, blob: b64url(good) }],
      [200, { id: "b", createdAt: 1, credentialId: "AQ", rpId: null, blob: "AAAA" }],
    ]);
    const c = new BackupClient({ baseUrl: "https://b", fetch: f, session: { token: "x", expiresAt: Date.now() + 1e6 } });
    const r = await c.download("a");
    expect(r.blob).toEqual(good);
    expect(r.meta).toEqual({ id: "a", createdAt: 1, credentialId: "AQ", rpId: null });
    await expect(c.download("b")).rejects.toMatchObject({ code: "backup/bad-blob" });
  });
});

describe("social sign-in (Google / Apple)", () => {
  const STATE = "S".repeat(43);
  const HANDOFF = "H".repeat(43);
  const RETURN = "https://abcdefghijklmnop.chromiumapp.org/backup";

  it("providers() reports what the service has switched on, and none when unreachable", async () => {
    const r = recorder([[200, { email: false, google: true, apple: false }]]);
    expect(await new BackupClient({ baseUrl: "https://b.test", fetch: r.f }).providers()).toEqual({ email: false, google: true, apple: false });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await new BackupClient({ baseUrl: "https://b.test", fetch: down }).providers()).toEqual({ email: false, google: false, apple: false });
  });

  it("start sends only the challenge; finish sends the verifier with state + handoff from the fragment", async () => {
    const r = recorder([
      [200, { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${STATE}&nonce=x` }],
      [200, { session: "T".repeat(43), expiresAt: Date.now() + 60_000, provider: "google" }],
    ]);
    const c = new BackupClient({ baseUrl: "https://b.test", fetch: r.f, randomBytes: (n) => new Uint8Array(n).fill(9) });
    const { authorizationUrl, pending } = await c.startSocialSignIn("google", RETURN);
    expect(authorizationUrl).toContain("accounts.google.com");
    const startBody = JSON.parse(String(r.calls[0]!.init.body));
    expect(startBody).toEqual({ provider: "google", challenge: await sha256b64url(pending.verifier), returnTo: RETURN });
    expect(JSON.stringify(startBody)).not.toContain(pending.verifier);
    await c.completeSocialSignIn(`${RETURN}#state=${STATE}&handoff=${HANDOFF}`, pending);
    expect(JSON.parse(String(r.calls[1]!.init.body))).toEqual({ state: STATE, handoff: HANDOFF, verifier: pending.verifier });
    expect(c.signedIn).toBe(true);
  });

  it("refuses a return for another attempt, and maps cancel/fail to plain words", async () => {
    const pending = { provider: "apple" as const, verifier: "v".repeat(43), state: STATE, startedAt: 0 };
    const c = new BackupClient({ baseUrl: "https://b.test", fetch: recorder([]).f });
    await expect(c.completeSocialSignIn(`${RETURN}#state=${"X".repeat(43)}&handoff=${HANDOFF}`, pending)).rejects.toMatchObject({ code: "backup/state-invalid" });
    await expect(c.completeSocialSignIn(`${RETURN}#state=${STATE}&error=cancelled`, pending)).rejects.toMatchObject({ code: "backup/social-cancelled" });
    await expect(c.completeSocialSignIn(`${RETURN}#state=${STATE}&error=failed`, pending)).rejects.toMatchObject({ code: "backup/social-failed", userMessage: expect.stringMatching(/use your email/) });
  });
});
