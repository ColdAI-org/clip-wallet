import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env, exports as workerExports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { BackupClient, BLOB_MAX_BYTES, BLOB_MIN_BYTES, b64url, tokenFromLink } from "@clip-wallet/backup-client";
import { createApp, MemoryEmailSender, ResendEmailSender, type Env } from "../src/index";

const E = env as unknown as Env & { TEST_MIGRATIONS: D1Migration[] };
/** The deployed entry point (src/index.ts default export), as wired by wrangler.jsonc. */
const worker = (workerExports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;

beforeAll(async () => {
  await applyD1Migrations(E.DB, E.TEST_MIGRATIONS);
});

/** Structurally valid CLPB blob with arbitrary bytes (the server can't tell; nothing here is a real backup). */
function blob(len: number = BLOB_MIN_BYTES, seed = 1): Uint8Array {
  const b = new Uint8Array(len);
  b.set([0x43, 0x4c, 0x50, 0x42, 1]);
  for (let i = 5; i < len; i++) b[i] = (i * 31 + seed) & 0xff;
  return b;
}

let ipCounter = 0;
function harness(opts: { now?: () => number } = {}) {
  const mail = new MemoryEmailSender();
  const app = createApp({ email: mail, ...(opts.now ? { now: opts.now } : {}) });
  const ip = `203.0.113.${++ipCounter}`;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(input), init);
    req.headers.set("cf-connecting-ip", ip);
    return app.fetch(req, E);
  }) as typeof fetch;
  const client = () => new BackupClient({ baseUrl: "https://backup.test", fetch: f });
  return { mail, app, f, client, ip };
}

let emailCounter = 0;
const freshEmail = () => `person${++emailCounter}-${crypto.randomUUID().slice(0, 8)}@example.com`;

async function signedIn(h: ReturnType<typeof harness>, email = freshEmail()) {
  const c = h.client();
  const pending = await c.startSignIn(email);
  const link = /https:\S+/.exec(h.mail.outbox.at(-1)!.text)![0];
  await c.completeSignIn(link, pending);
  return { c, email, pending, link };
}

describe("sign-in by email link (PKCE-bound)", () => {
  it("emails a one-time link to the fragment of APP_URL and signs in the device that asked", async () => {
    const h = harness();
    const { c, email } = await signedIn(h);
    const msg = h.mail.outbox[0]!;
    expect(msg.to).toBe(email);
    expect(msg.text).toMatch(/^https:\/\/wallet\.example\/backup#\/backup\/sign-in\?token=[A-Za-z0-9_-]{43}$/m);
    expect(msg.text).toMatch(/never ask you for your recovery phrase/);
    expect(c.signedIn).toBe(true);
    expect(await c.list()).toEqual([]);
  });

  it("the database holds no email address and no raw tokens", async () => {
    const h = harness();
    const { email, link } = await signedIn(h);
    const token = tokenFromLink(link)!;
    for (const table of ["accounts", "magic_links", "sessions", "rate_limits"]) {
      const { results } = await E.DB.prepare(`SELECT * FROM ${table}`).all();
      const dump = JSON.stringify(results);
      expect(dump).not.toContain(email);
      expect(dump).not.toContain(token);
    }
  });

  it("a link is single-use", async () => {
    const h = harness();
    const { link, pending } = await signedIn(h);
    await expect(h.client().completeSignIn(link, pending)).rejects.toMatchObject({ code: "backup/link-invalid" });
  });

  it("a link opened without the starting device's verifier fails (phished link is useless)", async () => {
    const h = harness();
    const victim = h.client();
    const pending = await victim.startSignIn(freshEmail());
    const link = /https:\S+/.exec(h.mail.outbox[0]!.text)![0];
    const attacker = h.client();
    await expect(attacker.completeSignIn(link, { ...pending, verifier: b64url(new Uint8Array(32).fill(7)) })).rejects.toMatchObject({ code: "backup/link-other-device" });
    // still usable by the right device…
    await victim.completeSignIn(link, pending);
    expect(victim.signedIn).toBe(true);
  });

  it("locks a link after too many wrong verifiers", async () => {
    const h = harness();
    const c = h.client();
    const pending = await c.startSignIn(freshEmail());
    const link = /https:\S+/.exec(h.mail.outbox[0]!.text)![0];
    for (let i = 0; i < 5; i++) await c.completeSignIn(link, { ...pending, verifier: b64url(new Uint8Array(32).fill(i)) }).catch(() => undefined);
    await expect(c.completeSignIn(link, pending)).rejects.toMatchObject({ code: "backup/link-invalid" });
  });

  it("links expire after 15 minutes", async () => {
    let t = 1_000_000;
    const h = harness({ now: () => t });
    const c = h.client();
    const pending = await c.startSignIn(freshEmail());
    const link = /https:\S+/.exec(h.mail.outbox[0]!.text)![0];
    t += 15 * 60_000 + 1;
    await expect(c.completeSignIn(link, pending)).rejects.toMatchObject({ code: "backup/link-invalid" });
  });

  it("rate-limits sign-in emails per address", async () => {
    const h = harness();
    const email = freshEmail();
    const c = h.client();
    for (let i = 0; i < 5; i++) await c.startSignIn(email);
    await expect(c.startSignIn(email)).rejects.toMatchObject({ code: "backup/rate-limited" });
    expect(h.mail.outbox).toHaveLength(5);
  });

  it("rate-limits sign-in per IP across addresses, with Retry-After", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) await h.client().startSignIn(freshEmail());
    const res = await h.f("https://backup.test/v1/auth/start", { method: "POST", body: JSON.stringify({ email: freshEmail(), challenge: "A".repeat(43) }) });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("rejects malformed requests without sending email", async () => {
    const h = harness();
    const post = (body: unknown) => h.f("https://backup.test/v1/auth/start", { method: "POST", body: JSON.stringify(body) });
    expect((await post({ email: "nope", challenge: "A".repeat(43) })).status).toBe(400);
    expect((await post({ email: freshEmail() })).status).toBe(400);
    expect((await h.f("https://backup.test/v1/auth/start", { method: "POST", body: "[" })).status).toBe(400);
    expect((await h.f("https://backup.test/v1/auth/start", { method: "POST", body: "x".repeat(10_000) })).status).toBe(413);
    expect(h.mail.outbox).toHaveLength(0);
  });
});

describe("backups", () => {
  it("stores and returns only the ciphertext blob plus public passkey ids", async () => {
    const h = harness();
    const { c } = await signedIn(h);
    const b = blob(BLOB_MAX_BYTES);
    const { id } = await c.upload(b, { credentialId: "Y3JlZC1pZA", rpId: "wallet.example" });
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const list = await c.list();
    expect(list).toEqual([{ id, createdAt: expect.any(Number), credentialId: "Y3JlZC1pZA", rpId: "wallet.example" }]);
    const r = await c.download(id);
    expect(r.blob).toEqual(b);
    const stored = await E.BLOBS.get(`b/${id}`);
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(b);
  });

  it("restore on a new device: sign in again with the same email and download", async () => {
    const h = harness();
    const email = freshEmail();
    const first = await signedIn(h, email);
    const { id } = await first.c.upload(blob(), { credentialId: "AQID", rpId: null });
    const second = await signedIn(harness(), email);
    expect((await second.c.list()).map((x) => x.id)).toEqual([id]);
    expect((await second.c.download(id)).meta.rpId).toBeNull();
  });

  it("another account can't see, fetch or delete it", async () => {
    const h = harness();
    const a = await signedIn(h);
    const b = await signedIn(harness());
    const { id } = await a.c.upload(blob(), { credentialId: "AQID", rpId: null });
    expect(await b.c.list()).toEqual([]);
    await expect(b.c.download(id)).rejects.toMatchObject({ code: "backup/not-found" });
    await expect(b.c.remove(id)).rejects.toMatchObject({ code: "backup/not-found" });
    expect(await a.c.list()).toHaveLength(1);
  });

  it("refuses non-backup data, bad ids and oversize bodies (no general storage)", async () => {
    const h = harness();
    const { c } = await signedIn(h);
    const post = (body: unknown) =>
      h.f("https://backup.test/v1/backups", { method: "POST", headers: { authorization: `Bearer ${c.session!.token}` }, body: JSON.stringify(body) });
    const notClpb = new Uint8Array(BLOB_MIN_BYTES).fill(65);
    expect((await post({ blob: b64url(notClpb), credentialId: "AQID", rpId: null })).status).toBe(400);
    expect((await post({ blob: b64url(blob(200)), credentialId: "AQID", rpId: null })).status).toBe(400);
    expect((await post({ blob: b64url(blob()), credentialId: "", rpId: null })).status).toBe(400);
    expect((await post({ blob: b64url(blob()), credentialId: "AQID", rpId: "Not A Domain/" })).status).toBe(400);
    expect((await post({ blob: b64url(blob()), credentialId: "AQID", rpId: null, pad: "x".repeat(5000) })).status).toBe(413);
  });

  it("caps backups per account", async () => {
    const h = harness();
    const { c } = await signedIn(h);
    for (let i = 0; i < 10; i++) await c.upload(blob(BLOB_MIN_BYTES, i), { credentialId: "AQID", rpId: null });
    await expect(c.upload(blob(), { credentialId: "AQID", rpId: null })).rejects.toMatchObject({ code: "backup/too-many-backups" });
  });

  it("audit BKP-01: concurrent uploads can't get past the per-account cap (count and insert are one statement)", async () => {
    const h = harness();
    const { c } = await signedIn(h);
    for (let i = 0; i < 9; i++) await c.upload(blob(BLOB_MIN_BYTES, i), { credentialId: "AQID", rpId: null });
    const post = (i: number) =>
      h.f("https://backup.test/v1/backups", {
        method: "POST",
        headers: { authorization: `Bearer ${c.session!.token}` },
        body: JSON.stringify({ blob: b64url(blob(BLOB_MIN_BYTES, 100 + i)), credentialId: "AQID", rpId: null }),
      });
    const statuses = (await Promise.all([0, 1, 2, 3, 4, 5].map(post))).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await c.list()).toHaveLength(10);
    // Nothing orphaned in R2 by the refused ones.
    const listed = await E.BLOBS.list({ prefix: "b/" });
    const ids = new Set((await c.list()).map((b) => `b/${b.id}`));
    const { results } = await E.DB.prepare("SELECT id FROM backups").all<{ id: string }>();
    const known = new Set(results.map((r) => `b/${r.id}`));
    expect(listed.objects.filter((o) => !known.has(o.key))).toEqual([]);
    expect(ids.size).toBe(10);
  });

  it("audit BKP-01: a chunked body (no Content-Length) is cut off at the size limit, not read whole", async () => {
    const h = harness();
    const { c } = await signedIn(h);
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode(`{"pad":"${"x".repeat(1000)}`);
    const body = new ReadableStream<Uint8Array>(
      {
        pull(ctl) {
          if (pulled > 5_000_000) return ctl.close();
          pulled += chunk.length;
          ctl.enqueue(chunk.slice());
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const res = await h.f("https://backup.test/v1/backups", {
      method: "POST",
      headers: { authorization: `Bearer ${c.session!.token}` },
      body,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(4096 + chunk.length);
    expect(cancelled).toBe(true);
  });

  it("delete one, then delete the whole account (blobs gone from R2 too)", async () => {
    const h = harness();
    const { c, email } = await signedIn(h);
    const one = await c.upload(blob(), { credentialId: "AQID", rpId: null });
    const two = await c.upload(blob(BLOB_MIN_BYTES, 9), { credentialId: "AQID", rpId: null });
    await c.remove(one.id);
    expect(await E.BLOBS.get(`b/${one.id}`)).toBeNull();
    await c.deleteAccount();
    expect(await E.BLOBS.get(`b/${two.id}`)).toBeNull();
    const again = await signedIn(harness(), email);
    expect(await again.c.list()).toEqual([]);
  });

  it("requires a live session", async () => {
    const h = harness();
    expect((await h.f("https://backup.test/v1/backups")).status).toBe(401);
    expect((await h.f("https://backup.test/v1/backups", { headers: { authorization: `Bearer ${"x".repeat(43)}` } })).status).toBe(401);
    const { c } = await signedIn(h);
    await c.signOut();
    const res = await h.f("https://backup.test/v1/backups", { headers: { authorization: "Bearer stale" } });
    expect(res.status).toBe(401);
  });

  it("sessions expire", async () => {
    let t = Date.now();
    const h = harness({ now: () => t });
    const { c } = await signedIn(h);
    const token = c.session!.token;
    t += 31 * 24 * 60 * 60_000;
    const res = await h.f("https://backup.test/v1/backups", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});

describe("HTTP surface", () => {
  it("deployed default has no email provider: sign-in is 503, nothing stored", async () => {
    const res = await worker.fetch(
      new Request("https://backup.test/v1/auth/start", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.200" }, body: JSON.stringify({ email: freshEmail(), challenge: "B".repeat(43) }) }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "email-unavailable", message: expect.any(String) });
    const { results } = await E.DB.prepare("SELECT * FROM magic_links WHERE challenge = ?1").bind("B".repeat(43)).all();
    expect(results).toHaveLength(0);
  });

  it("deployed default refuses before writing anything, even rate-limit counters", async () => {
    const before = await E.DB.prepare("SELECT (SELECT COUNT(*) FROM rate_limits) + (SELECT COUNT(*) FROM magic_links) + (SELECT COUNT(*) FROM accounts) AS n").first<{ n: number }>();
    const res = await worker.fetch(new Request("https://backup.test/v1/auth/start", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.201" }, body: "{}" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "email-unavailable", message: "Email isn't configured." });
    const after = await E.DB.prepare("SELECT (SELECT COUNT(*) FROM rate_limits) + (SELECT COUNT(*) FROM magic_links) + (SELECT COUNT(*) FROM accounts) AS n").first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });

  it("health reports whether email sign-in is ready", async () => {
    expect(await (await worker.fetch(new Request("https://b/v1/health"))).json()).toEqual({ ok: true, emailSignIn: false, sync: true });
    const app = createApp({ email: new MemoryEmailSender() });
    expect(await (await app.fetch(new Request("https://b/v1/health"), E)).json()).toEqual({ ok: true, emailSignIn: true, sync: true });
  });

  it("Resend sender posts the documented request and reports failures without the provider's body", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(status === 200 ? JSON.stringify({ id: "x" }) : "secret detail", { status });
    }) as typeof fetch;
    const s = new ResendEmailSender("re_test_not_a_key", "Clip Wallet <backup@example.com>", fake);
    await s.send({ to: "a@example.com", subject: "S", text: "T" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer re_test_not_a_key");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ from: "Clip Wallet <backup@example.com>", to: ["a@example.com"], subject: "S", text: "T" });
    status = 422;
    await expect(s.send({ to: "a@example.com", subject: "S", text: "T" })).rejects.toThrow(/422/);
    const app = createApp({ email: s });
    const res = await app.fetch(new Request("https://b/v1/auth/start", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.202" }, body: JSON.stringify({ email: freshEmail(), challenge: "D".repeat(43) }) }), E);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toMatch(/secret detail/);
  });

  it("fails closed without the pepper", async () => {
    const app = createApp({ email: new MemoryEmailSender() });
    const res = await app.fetch(new Request("https://b/v1/auth/start", { method: "POST", body: JSON.stringify({ email: freshEmail(), challenge: "C".repeat(43) }) }), { ...E, EMAIL_PEPPER: undefined });
    expect(res.status).toBe(503);
  });

  it("security headers, no-store, CORS only for allowed origins", async () => {
    const ok = await worker.fetch(new Request("https://b/v1/health", { headers: { origin: "chrome-extension://clipwallettestextensionid" } }));
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(ok.headers.get("access-control-allow-origin")).toBe("chrome-extension://clipwallettestextensionid");
    const bad = await worker.fetch(new Request("https://b/v1/health", { headers: { origin: "https://evil.example" } }));
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await worker.fetch(new Request("https://b/v1/backups", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(pre.status).toBe(403);
    expect((await worker.fetch(new Request("https://b/nope"))).status).toBe(404);
  });

  it("cron cleanup drops expired rows", async () => {
    let t = Date.now();
    const h = harness({ now: () => t });
    await h.client().startSignIn(freshEmail());
    t += 2 * 24 * 60 * 60_000;
    await h.app.cleanup(E);
    const { results } = await E.DB.prepare("SELECT * FROM magic_links WHERE expires_at < ?1").bind(t - 24 * 60 * 60_000).all();
    expect(results).toHaveLength(0);
  });
});
