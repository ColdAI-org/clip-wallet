import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createSandboxRuntime, type SesApi } from "../src/runtime.js";
import type { Channel, ChannelFactory } from "../src/sandbox.js";
import type { InstalledPlugin } from "../src/host.js";
import { parseManifest, type PluginManifest } from "../src/manifest.js";

/**
 * An in-process stand-in for the iframe: messages cross as structured clones (like postMessage), and the
 * sandbox side is the real runtime under real SES. `sent`/`received` record the raw traffic.
 */
export function memoryChannels(ses: SesApi) {
  const log: { dir: "in" | "out"; msg: unknown }[] = [];
  const channels: { id: string; inject(raw: unknown): void }[] = [];
  const factory: ChannelFactory = (id) => {
    let toHost: ((raw: unknown) => void) | null = null;
    let alive = true;
    const runtime = createSandboxRuntime({
      ...ses,
      post: (msg) => {
        const c = structuredClone(msg);
        log.push({ dir: "in", msg: c });
        queueMicrotask(() => alive && toHost?.(c));
      },
    });
    const ch: Channel = {
      send(msg) {
        const c = structuredClone(msg);
        log.push({ dir: "out", msg: c });
        queueMicrotask(() => alive && runtime.receive(c));
      },
      onMessage(cb) {
        toHost = cb;
      },
      destroy() {
        alive = false;
      },
    };
    channels.push({ id, inject: (raw) => toHost?.(raw) });
    return ch;
  };
  return { factory, log, channels };
}

export const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export function manifestFor(source: string, permissions: PluginManifest["permissions"], name = "Test plugin"): PluginManifest {
  return parseManifest({
    manifestVersion: 1,
    name,
    version: "1.0.0",
    author: "Tests",
    description: "A test plugin.",
    permissions,
    bundle: { path: "dist/bundle.js", sha256: sha256(source) },
  });
}

export function installed(source: string, permissions: PluginManifest["permissions"], id = "clip-plugin-test", name = "Test plugin"): InstalledPlugin {
  return { id, version: "1.0.0", manifest: manifestFor(source, permissions, name), source, integrity: "sha512-x", installedAt: 0, enabled: true };
}

export const EXAMPLE_DIR = new URL("../examples/address-label/", import.meta.url);
export const exampleSource = () => readFileSync(new URL("dist/bundle.js", EXAMPLE_DIR), "utf8");
export const exampleManifest = () => JSON.parse(readFileSync(new URL("clip.plugin.json", EXAMPLE_DIR), "utf8")) as unknown;

/* ------------------------------------------------------------------ npm tarball fixtures (no keys involved) */

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

export function tgz(files: Record<string, string | Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
    parts.push(tarHeader(path, body.length), body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const tar = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    tar.set(p, o);
    o += p.length;
  }
  return new Uint8Array(gzipSync(tar));
}

export const sri = (b: Uint8Array) => `sha512-${createHash("sha512").update(b).digest("base64")}`;

/** A fake npm registry serving one package version. */
export function fakeRegistry(name: string, version: string, tarball: Uint8Array, opts: { integrity?: string; tarballUrl?: string } = {}) {
  const urls: string[] = [];
  const tarUrl = opts.tarballUrl ?? `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`;
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (init?.credentials !== "omit") throw new Error("registry requests must omit credentials");
    if (url === `https://registry.npmjs.org/${name.replace("/", "%2f")}`) {
      return Response.json({ name, "dist-tags": { latest: version }, versions: { [version]: { dist: { tarball: tarUrl, integrity: opts.integrity ?? sri(tarball) } } } });
    }
    if (url === tarUrl) return new Response(tarball as BodyInit);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { f, urls };
}
