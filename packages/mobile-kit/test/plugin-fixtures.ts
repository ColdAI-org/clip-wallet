/**
 * Clip Plugin fixtures for jest and vitest: a plugin bundle, its manifest and an npm tarball built in memory, served
 * by a fake registry. No keys involved (npm integrity is a plain SHA-512 of the tarball).
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
export const sri = (b: Uint8Array) => `sha512-${createHash("sha512").update(b).digest("base64")}`;

/** Names the burn address in requests (like packages/plugins/examples/address-label). */
export const LABEL_SOURCE = `module.exports.onTransaction = async ({ request }) => {
  const burn = request.lines.some((l) => /0x0{36}dead/i.test(l.value)) || request.lines.some((l) => /dEaD$/.test(l.value));
  return burn ? { lines: [{ label: "Address", value: "Burn address" }], warnings: [{ level: "danger", message: "Anything sent to the burn address is gone for good." }] } : { lines: [], warnings: [] };
};`;

export function manifest(source: string, permissions: Record<string, unknown> = { transactionInsight: true }, name = "Address labels", version = "1.0.0") {
  return { manifestVersion: 1, name, version, author: "Clip Wallet tests", description: "Names well-known addresses.", permissions, bundle: { path: "dist/bundle.js", sha256: sha256(source) } };
}

function tarHeader(path: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();
  const put = (s: string, off: number) => h.set(enc.encode(s), off);
  put(path, 0);
  put("0000644\0", 100);
  put("0000000\0", 108);
  put("0000000\0", 116);
  put(size.toString(8).padStart(11, "0") + "\0", 124);
  put("00000000000\0", 136);
  put("        ", 148);
  h[156] = "0".charCodeAt(0);
  put("ustar\0", 257);
  put("00", 263);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

export function tar(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
    parts.push(tarHeader(path, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const tgz = (files: Record<string, string | Uint8Array>) => new Uint8Array(gzipSync(tar(files)));

export function pluginTarball(name: string, source = LABEL_SOURCE, permissions?: Record<string, unknown>, version = "1.0.0") {
  return tgz({
    "package/package.json": JSON.stringify({ name, version }),
    "package/clip.plugin.json": JSON.stringify(manifest(source, permissions, undefined, version)),
    "package/dist/bundle.js": source,
  });
}

/** A fake npm registry serving one package version; records the URLs asked for. */
export function fakeRegistry(name: string, version: string, tarball: Uint8Array, opts: { integrity?: string } = {}) {
  const urls: string[] = [];
  const tarUrl = `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
  const json = (v: unknown) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v), arrayBuffer: async () => new ArrayBuffer(0) });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (init?.credentials !== "omit") throw new Error("registry requests must omit credentials");
    if (url === `https://registry.npmjs.org/${name.replace("/", "%2f")}`) {
      return json({ name, "dist-tags": { latest: version }, versions: { [version]: { dist: { tarball: tarUrl, integrity: opts.integrity ?? sri(tarball) } } } });
    }
    if (url === tarUrl) return { ok: true, status: 200, arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength), text: async () => "" };
    return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" };
  }) as unknown as typeof fetch;
  return { f, urls };
}
