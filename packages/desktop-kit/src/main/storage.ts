/**
 * Where things live on a computer (Electron `app.getPath("userData")`):
 *
 *   vault.json   the vault record (Argon2id-sealed ciphertext + public metadata, exactly what the extension keeps
 *                in chrome.storage), wrapped once more with the OS secret store through Electron safeStorage:
 *                macOS Keychain, Windows DPAPI, Linux libsecret / kwallet. Copying the file to another machine or
 *                user account gives an attacker nothing they can even start guessing passwords against.
 *                When the OS store isn't available (Linux without a keyring: safeStorage reports "basic_text"),
 *                the record is kept as the vault wrote it and Settings → About says so; the vault's own
 *                encryption still applies.
 *   app.json     app data (prefs, permissions, activity, public accounts, bookmarks): the engine's KV. Public only.
 *
 * Writes are atomic (write to a temp file, then rename) and serialised, so a crash never leaves half a vault.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KV } from "@clip-wallet/engine";
import type { VaultStorage } from "@clip-wallet/vault";

/** The slice of Electron's safeStorage used here (injected so tests run without Electron). */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(enc: Buffer): string;
  /** Linux only: "basic_text" means no keyring (a hard-coded key), i.e. no real protection. */
  getSelectedStorageBackend?(): string;
}

export type StorageProtection = "keychain" | "dpapi" | "libsecret" | "kwallet" | "basic" | "none";

export function protectionOf(safe: SafeStorageLike, platform: NodeJS.Platform): StorageProtection {
  if (!safe.isEncryptionAvailable()) return "none";
  if (platform === "darwin") return "keychain";
  if (platform === "win32") return "dpapi";
  const backend = safe.getSelectedStorageBackend?.() ?? "unknown";
  if (backend === "basic_text" || backend === "unknown") return "basic";
  return backend.startsWith("kwallet") ? "kwallet" : "libsecret";
}

function atomicWrite(file: string, data: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** JSON file KV: the engine's app data. Reads are from memory; every write persists the whole (small) file. */
export class FileKV implements KV {
  private data: Record<string, unknown>;
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {
    this.data = readJson(file);
  }
  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data[key];
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    await this.flush();
  }
  async remove(key: string): Promise<void> {
    delete this.data[key];
    await this.flush();
  }
  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data);
    this.chain = this.chain.then(() => atomicWrite(this.file, snapshot));
    return this.chain;
  }
}

/** Marker of a safeStorage-wrapped value in vault.json. */
const WRAPPED = "safe:v1:";

/**
 * The vault's storage. Values are what ClipVault hands us (already sealed); with an OS store they are wrapped
 * with safeStorage before they touch the disk. A value written while the OS store was unavailable is still read
 * (and re-wrapped on the next write once it is available).
 */
export class SafeVaultStorage implements VaultStorage {
  private data: Record<string, string>;
  constructor(
    private readonly file: string,
    private readonly safe: SafeStorageLike,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {
    const raw = readJson(file);
    this.data = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
  }

  get protection(): StorageProtection {
    return protectionOf(this.safe, this.platform);
  }

  private get wraps(): boolean {
    const p = this.protection;
    return p !== "none" && p !== "basic";
  }

  get(key: string): string | undefined {
    const v = this.data[key];
    if (v === undefined) return undefined;
    if (!v.startsWith(WRAPPED)) return v;
    // Unwrapping failures (another user / machine, keyring reset) surface as "no vault here" rather than a crash;
    // the file itself is left alone so nothing is lost.
    try {
      return this.safe.decryptString(Buffer.from(v.slice(WRAPPED.length), "base64"));
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string): void {
    this.data[key] = this.wraps ? WRAPPED + this.safe.encryptString(value).toString("base64") : value;
    atomicWrite(this.file, JSON.stringify(this.data));
  }

  remove(key: string): void {
    delete this.data[key];
    atomicWrite(this.file, JSON.stringify(this.data));
  }
}

export function storagePaths(userData: string) {
  return { vault: join(userData, "vault.json"), app: join(userData, "app.json") };
}

/** Test helper / reset: removes both files. */
export function removeStorage(userData: string) {
  const p = storagePaths(userData);
  for (const f of [p.vault, p.app]) rmSync(f, { force: true });
}
