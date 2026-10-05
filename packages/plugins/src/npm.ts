/**
 * Install a plugin from the npm registry, verifying everything before the user is asked anything:
 *
 *  1. GET https://registry.npmjs.org/<name> (abbreviated metadata) → the version, its `dist.tarball` and
 *     `dist.integrity` (Subresource-Integrity sha512, https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json#packages).
 *  2. The tarball must live on the same registry origin; it is downloaded (size-capped) and its SHA-512 must
 *     equal `dist.integrity`.
 *  3. gunzip + untar in memory; `package/package.json` must name the same package and version.
 *  4. `package/clip.plugin.json` must validate (manifest.ts) and its version must match.
 *  5. The bundle file's SHA-256 must equal `manifest.bundle.sha256`.
 *
 * Nothing from the package runs here. The result is a PendingInstall the UI shows as a permission prompt.
 */
import { sha256 as nobleSha256, sha512 as nobleSha512 } from "@noble/hashes/sha2.js";
import { MANIFEST_FILE, MAX_BUNDLE_BYTES, ManifestError, describePermissions, parseManifest, type PluginManifest } from "./manifest.js";

export const NPM_REGISTRY = "https://registry.npmjs.org";
export const MAX_TARBALL_BYTES = 5_000_000;
const MAX_UNPACKED_BYTES = 20_000_000;

export class InstallError extends Error {
  constructor(
    readonly code: "bad-name" | "not-found" | "unreachable" | "integrity" | "bad-package" | "bad-manifest" | "too-large",
    message: string,
  ) {
    super(message);
  }
}

export interface PendingInstall {
  /** npm package name; also the plugin's id. */
  id: string;
  version: string;
  manifest: PluginManifest;
  /** The verified bundle source. */
  source: string;
  /** npm `dist.integrity` that was checked. */
  integrity: string;
  /** Plain-words permission lines for the prompt. */
  permissions: string[];
}

/** npm package-name rules (validate-npm-package-name, new packages): lowercase, ≤ 214, url-safe, optional scope. */
export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name);
}

/** Stable id usable inside messages (the npm name, made safe). */
export function pluginIdOf(name: string): string {
  return name.replace(/^@/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

function toHex(b: Uint8Array): string {
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * SHA-256 / SHA-512 with @noble/hashes rather than crypto.subtle: the same code then runs in the extension and
 * in React Native (Hermes has no WebCrypto). Async to keep the original signature.
 */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return toHex(nobleSha256(data));
}

/**
 * Strict UTF-8 decoding. `TextDecoder(..., { fatal: true })` where the platform has it; otherwise (the
 * fast-text-encoding polyfill on React Native refuses `fatal`) decode leniently and require that re-encoding
 * gives back the same bytes, which fails exactly when a U+FFFD replacement was inserted.
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  let fatal: TextDecoder | null = null;
  try {
    fatal = new TextDecoder("utf-8", { fatal: true });
  } catch {
    fatal = null;
  }
  if (fatal) return fatal.decode(bytes);
  const s = new TextDecoder("utf-8").decode(bytes);
  const back = new TextEncoder().encode(s);
  if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new TypeError("invalid UTF-8");
  return s;
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

/** Checks an SRI string ("sha512-…", possibly several, space-separated). Only sha512 is accepted. */
export async function checkIntegrity(bytes: Uint8Array, integrity: string): Promise<boolean> {
  const wanted = integrity
    .split(/\s+/)
    .filter((s) => s.startsWith("sha512-"))
    .map((s) => s.slice(7));
  if (!wanted.length) return false;
  const got = b64(nobleSha512(bytes));
  return wanted.includes(got);
}

async function gunzip(bytes: Uint8Array, custom?: NpmOptions["gunzip"]): Promise<Uint8Array> {
  if (custom) return custom(bytes, MAX_UNPACKED_BYTES);
  if (typeof DecompressionStream !== "function") throw new InstallError("bad-package", "This version can't unpack plugins.");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED_BYTES) throw new InstallError("too-large", "That plugin is too large.");
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Minimal ustar reader (what `npm pack` produces). Returns regular files by path. */
export function untar(tar: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const str = (o: number, n: number) => dec.decode(tar.subarray(o, o + n)).replace(/\0.*$/s, "");
  let off = 0;
  let paxPath: string | null = null;
  while (off + 512 <= tar.length) {
    if (tar.subarray(off, off + 512).every((b) => b === 0)) break;
    const name = str(off, 100);
    const size = parseInt(str(off + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(tar[off + 156] ?? 0);
    const prefix = str(off + 345, 155);
    if (!Number.isFinite(size) || size < 0) throw new InstallError("bad-package", "That plugin package is damaged.");
    const body = tar.subarray(off + 512, off + 512 + size);
    if (type === "x") {
      const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(body));
      paxPath = m ? m[1]! : null;
    } else if (type === "0" || type === "\0") {
      const path = paxPath ?? (prefix ? `${prefix}/${name}` : name);
      files.set(path, body.slice());
      paxPath = null;
    } else {
      paxPath = null;
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export interface NpmOptions {
  fetch?: typeof fetch;
  registry?: string;
  /**
   * gunzip for platforms without DecompressionStream (React Native / Hermes). Must throw once the output passes
   * `maxBytes` (a small tarball can inflate to gigabytes).
   */
  gunzip?: (bytes: Uint8Array, maxBytes: number) => Uint8Array | Promise<Uint8Array>;
}

export { MAX_UNPACKED_BYTES };

/** Downloads and verifies a plugin. Throws InstallError (plain message) on any problem. */
export async function prepareInstallFromNpm(name: string, opts: NpmOptions & { version?: string } = {}): Promise<PendingInstall> {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const registry = (opts.registry ?? NPM_REGISTRY).replace(/\/+$/, "");
  const pkg = name.trim();
  if (!isValidPackageName(pkg)) throw new InstallError("bad-name", "That isn't a valid npm package name.");

  let meta: { "dist-tags"?: Record<string, string>; versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }> };
  try {
    const res = await f(`${registry}/${pkg.replace("/", "%2f")}`, { headers: { accept: "application/vnd.npm.install-v1+json" }, credentials: "omit" });
    if (res.status === 404) throw new InstallError("not-found", "No plugin with that name on npm.");
    if (!res.ok) throw new InstallError("unreachable", "We couldn't reach npm. Try again.");
    meta = (await res.json()) as typeof meta;
  } catch (e) {
    if (e instanceof InstallError) throw e;
    throw new InstallError("unreachable", "We couldn't reach npm. Try again.");
  }
  const version = opts.version ?? meta["dist-tags"]?.latest;
  const dist = version ? meta.versions?.[version]?.dist : undefined;
  if (!version || !dist?.tarball || !dist.integrity) throw new InstallError("not-found", "No plugin with that name on npm.");
  if (new URL(dist.tarball).origin !== new URL(registry).origin) throw new InstallError("bad-package", "That plugin's download isn't on npm.");

  const res = await f(dist.tarball, { credentials: "omit" }).catch(() => null);
  if (!res?.ok) throw new InstallError("unreachable", "We couldn't download that plugin. Try again.");
  const tgz = new Uint8Array(await res.arrayBuffer());
  if (tgz.length > MAX_TARBALL_BYTES) throw new InstallError("too-large", "That plugin is too large.");
  if (!(await checkIntegrity(tgz, dist.integrity))) throw new InstallError("integrity", "That plugin's download didn't match npm's checksum, so it wasn't installed.");

  let files: Map<string, Uint8Array>;
  try {
    files = untar(await gunzip(tgz, opts.gunzip));
  } catch (e) {
    if (e instanceof InstallError) throw e;
    throw new InstallError("bad-package", "That plugin package is damaged.");
  }
  const readJson = (path: string): unknown => {
    const b = files.get(`package/${path}`);
    if (!b) return undefined;
    try {
      return JSON.parse(decodeUtf8Strict(b));
    } catch {
      return undefined;
    }
  };
  const pj = readJson("package.json") as { name?: string; version?: string } | undefined;
  if (!pj || pj.name !== pkg || pj.version !== version) throw new InstallError("bad-package", "That package isn't what npm said it was.");
  const rawManifest = readJson(MANIFEST_FILE);
  if (rawManifest === undefined) throw new InstallError("bad-manifest", "That package isn't a Clip Wallet plugin.");
  let manifest: PluginManifest;
  try {
    manifest = parseManifest(rawManifest);
  } catch (e) {
    throw new InstallError("bad-manifest", `That plugin's manifest is invalid: ${(e as ManifestError).message}.`);
  }
  if (manifest.version !== version) throw new InstallError("bad-manifest", "That plugin's manifest is for a different version.");
  const bundle = files.get(`package/${manifest.bundle.path}`);
  if (!bundle) throw new InstallError("bad-manifest", "That plugin's code is missing.");
  if (bundle.length > MAX_BUNDLE_BYTES) throw new InstallError("too-large", "That plugin is too large.");
  if ((await sha256Hex(bundle)) !== manifest.bundle.sha256) throw new InstallError("integrity", "That plugin's code doesn't match its manifest, so it wasn't installed.");
  let source: string;
  try {
    source = decodeUtf8Strict(bundle);
  } catch {
    throw new InstallError("bad-package", "That plugin package is damaged.");
  }
  return { id: pkg, version, manifest, source, integrity: dist.integrity, permissions: describePermissions(manifest) };
}
