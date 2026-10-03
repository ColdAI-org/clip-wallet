import { env, exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { mediaProxyUrl } from "@clip-wallet/media-client";
import { createProxy, type Env } from "../src/index";

const E = env as unknown as Env;
const worker = (workerExports as unknown as { default: { fetch(req: Request): Promise<Response> } }).default;

const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const MP4 = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypisom"), 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

type Route = { status?: number; body?: Uint8Array | ReadableStream<Uint8Array> | null; headers?: Record<string, string> };

function upstream(routes: Record<string, Route>) {
  const seen: { url: string; headers: Headers; redirect: string | undefined }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    const r = routes[url];
    if (!r) return new Response("nope", { status: 404 });
    return new Response(r.body ?? null, { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { f, seen };
}

const proxied = (raw: string, kind?: "image" | "video") => mediaProxyUrl("https://media.test", raw, kind ? { kind } : {})!.src;

async function get(routes: Record<string, Route>, raw: string, kind?: "image" | "video", extraEnv: Partial<Env> = {}) {
  const { f, seen } = upstream(routes);
  const p = createProxy({ fetch: f, cache: null });
  const res = await p.fetch(new Request(proxied(raw, kind)), { ...E, ...extraEnv });
  return { res, seen };
}

describe("media proxy", () => {
  it("serves an image with fresh, locked-down headers (nothing copied from upstream)", async () => {
    const { res, seen } = await get(
      { "https://cdn.example/a.png": { body: PNG, headers: { "content-type": "text/html", "set-cookie": "a=b", "access-control-allow-credentials": "true", "x-evil": "1" } } },
      "https://cdn.example/a.png",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-evil")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    // Upstream request: manual redirects, no cookies/referrer forwarded.
    expect(seen[0]!.redirect).toBe("manual");
    expect(seen[0]!.headers.get("cookie")).toBeNull();
    expect(seen[0]!.headers.get("referer")).toBeNull();
  });

  it("ipfs:// goes through the configured gateway and is cached as immutable", async () => {
    const { res, seen } = await get({ [`https://gw.example/ipfs/${CID}/1.png`]: { body: PNG } }, `ipfs://${CID}/1.png`, undefined, { IPFS_GATEWAY: "https://gw.example/" });
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe(`https://gw.example/ipfs/${CID}/1.png`);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("ar:// goes through the Arweave gateway", async () => {
    const tx = "bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U";
    const { res, seen } = await get({ [`https://arweave.net/${tx}`]: { body: PNG } }, `ar://${tx}`);
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe(`https://arweave.net/${tx}`);
  });

  it("serves SVG as image/svg+xml under a script-blocking CSP sandbox", async () => {
    const { res } = await get({ "https://cdn.example/a.svg": { body: SVG } }, "https://cdn.example/a.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  });

  it("serves video when kind=video", async () => {
    const { res } = await get({ "https://cdn.example/v.mp4": { body: MP4 } }, "https://cdn.example/v.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
  });

  it("refuses HTML/JS whatever the URL or Content-Type says", async () => {
    const { res } = await get({ "https://cdn.example/a.png": { body: HTML, headers: { "content-type": "image/png" } } }, "https://cdn.example/a.png");
    expect(res.status).toBe(415);
  });

  it("refuses a kind mismatch (video bytes asked for as image)", async () => {
    const { res } = await get({ "https://cdn.example/a": { body: MP4 } }, "https://cdn.example/a", "image");
    expect(res.status).toBe(415);
  });

  it("enforces the size cap from Content-Length", async () => {
    const { res } = await get({ "https://cdn.example/big.png": { body: PNG, headers: { "content-length": String(20 * 1024 * 1024) } } }, "https://cdn.example/big.png");
    expect(res.status).toBe(413);
  });

  it("enforces the size cap while streaming when Content-Length lies", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(PNG);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ > 12) return c.close();
        c.enqueue(sent === 1 ? chunk : new Uint8Array(1024 * 1024));
      },
    });
    const { res } = await get({ "https://cdn.example/liar.png": { body, headers: { "content-length": "100" } } }, "https://cdn.example/liar.png");
    expect(res.status).toBe(200);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it("follows a safe redirect and re-validates each hop", async () => {
    const ok = await get(
      { "https://a.example/x.png": { status: 302, headers: { location: "https://b.example/y.png" } }, "https://b.example/y.png": { body: PNG } },
      "https://a.example/x.png",
    );
    expect(ok.res.status).toBe(200);
    expect(ok.seen.map((s) => s.url)).toEqual(["https://a.example/x.png", "https://b.example/y.png"]);
    for (const loc of ["http://169.254.169.254/latest/meta-data", "http://localhost/x.png", "javascript:alert(1)", "file:///etc/passwd"]) {
      const bad = await get({ "https://a.example/x.png": { status: 301, headers: { location: loc } } }, "https://a.example/x.png");
      expect(bad.res.status).toBe(403);
      expect(bad.seen).toHaveLength(1);
    }
  });

  it("stops after 3 redirects", async () => {
    const routes: Record<string, Route> = {};
    for (let i = 0; i < 6; i++) routes[`https://r.example/${i}.png`] = { status: 302, headers: { location: `https://r.example/${i + 1}.png` } };
    const { res, seen } = await get(routes, "https://r.example/0.png");
    expect(res.status).toBe(502);
    expect(seen).toHaveLength(4);
  });

  it("maps upstream failures", async () => {
    expect((await get({}, "https://cdn.example/missing.png")).res.status).toBe(404);
    expect((await get({ "https://cdn.example/e.png": { status: 500, body: PNG } }, "https://cdn.example/e.png")).res.status).toBe(502);
    const throwing = createProxy({ fetch: (async () => { throw new Error("dns"); }) as unknown as typeof fetch, cache: null });
    expect((await throwing.fetch(new Request(proxied("https://cdn.example/a.png")), E)).status).toBe(502);
  });

  it("rate-limits per client IP when the binding is present", async () => {
    const limiter = { limit: async ({ key }: { key: string }) => ({ success: key !== "198.51.100.9" }) };
    const p = createProxy({ fetch: upstream({ "https://cdn.example/a.png": { body: PNG } }).f, cache: null });
    const req = (ip: string) => new Request(proxied("https://cdn.example/a.png"), { headers: { "cf-connecting-ip": ip } });
    expect((await p.fetch(req("198.51.100.9"), { ...E, MEDIA_LIMITER: limiter })).status).toBe(429);
    expect((await p.fetch(req("198.51.100.10"), { ...E, MEDIA_LIMITER: limiter })).status).toBe(200);
  });

  it("caches successful responses (second request doesn't hit upstream)", async () => {
    const { f, seen } = upstream({ "https://cdn.example/cached.png": { body: PNG } });
    const p = createProxy({ fetch: f, cache: await caches.open("media-test") });
    const r1 = await p.fetch(new Request(proxied("https://cdn.example/cached.png")), E);
    await r1.arrayBuffer();
    const r2 = await p.fetch(new Request(proxied("https://cdn.example/cached.png")), E);
    expect(r2.status).toBe(200);
    expect(new Uint8Array(await r2.arrayBuffer())).toEqual(PNG);
    expect(seen).toHaveLength(1);
  });
});

describe("deployed entry point (validation only, no outbound fetch)", () => {
  it.each([
    "/v1/media?src=javascript%3Aalert(1)&kind=image",
    "/v1/media?src=http%3A%2F%2F127.0.0.1%2Fa.png&kind=image",
    "/v1/media?src=http%3A%2F%2F10.0.0.1%2Fa.png&kind=image",
    "/v1/media?src=https%3A%2F%2Fexample.com%2Fa.png&kind=html",
    "/v1/media?kind=image",
  ])("rejects %s", async (path) => {
    const res = await worker.fetch(new Request(`https://media.test${path}`));
    expect(res.status).toBe(400);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("only GET/HEAD on /v1/media, 404 elsewhere", async () => {
    expect((await worker.fetch(new Request("https://media.test/v1/media?src=x&kind=image", { method: "POST" }))).status).toBe(405);
    expect((await worker.fetch(new Request("https://media.test/other"))).status).toBe(404);
    expect((await worker.fetch(new Request("https://media.test/v1/health"))).status).toBe(200);
  });
});
