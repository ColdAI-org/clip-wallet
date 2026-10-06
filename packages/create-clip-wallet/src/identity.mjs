// A wallet's own identity, written into a project made from the Scaffold-HBAR Clip Wallet template. One clip.config.ts
// at the project root drives every platform (packages/extension, packages/desktop, packages/mobile):
//   wallet.identity.json                     name, description, rdns, homepage, icon, appId, extension.key (public)
//   .keys/extension.pem                      the extension's private key (gitignored, 0600; never printed)
//   clip.config.ts                           theme accent, networks and languages (only when given)
//   icon.svg | icon.png + every platform's icons (icons.mjs: extension, macOS/Windows/Linux, iOS/Android, splash)
//   packages/extension/src/entrypoints/{popup,tab}/index.html      page titles
//   .env, packages/nextjs/.env.local                               WalletConnect project id (never committed)
//   docs/listings/*.md                                             listing-submission drafts for this identity
// `npx create-clip-wallet my-wallet` runs it after copying the template; in a project made with create-scaffold-hbar,
// `pnpm wallet:identity` runs the same code.
import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { CLIP_WALLET_RDNS, WALLETCONNECT_ENV, validateConfig, walletKey } from "@clip-wallet/config";
import { renderIcons } from "./icons.mjs";
import { writeListings } from "./listings.mjs";

export const CONFIG_FILE = "clip.config.ts";
export const IDENTITY_FILE = "wallet.identity.json";
export const KEY_FILE = join(".keys", "extension.pem");
export const CHECKLIST_FILE = "MAINNET.md";
export const EXTENSION_DIR = join("packages", "extension");
export const NEXT_DIR = join("packages", "nextjs");
/** Where each platform lives in a project. */
export const PLATFORM_DIRS = /** @type {const} */ ({ extension: join("packages", "extension"), desktop: join("packages", "desktop"), mobile: join("packages", "mobile") });
export const DEFAULT_ACCENT = "#4F46E5";
export const DEFAULT_NETWORKS = ["evm:*", "hedera", "solana", "bitcoin"];

/** "my-wallet" -> "My Wallet" @param {string} dir */
export function titleFromDir(dir) {
  const words = basename(dir).replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : "My Wallet";
}

/** npm-safe package name from a name or folder. @param {string} s */
export function slugOf(s) {
  return (
    basename(s)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "my-wallet"
  );
}

/** Placeholder reverse domain until you set one you own. @param {string} slug */
export function placeholderRdns(slug) {
  return `com.example.${slug.replace(/[^a-z0-9]/g, "") || "wallet"}`;
}

/** "evm:*, hedera" -> ["evm:*", "hedera"] (also languages, platforms). @param {string} text */
export function parseNetworks(text) {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Chrome extension id for a base64 SubjectPublicKeyInfo. @param {string} key */
export function extensionIdFromKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest();
  let id = "";
  for (const b of digest.subarray(0, 16)) id += String.fromCharCode(97 + (b >> 4), 97 + (b & 15));
  return id;
}

/** The platforms a project has (by folder). @param {string} root @returns {("extension" | "desktop" | "mobile")[]} */
export function projectPlatforms(root) {
  return /** @type {const} */ (["extension", "desktop", "mobile"]).filter((p) => existsSync(join(root, PLATFORM_DIRS[p], "package.json")));
}

/**
 * @typedef {{ name: string, rdns: string, accent?: string, networks?: string[], languages?: string[], appId?: string,
 *   description?: string, homepage?: string, icon?: string, walletConnectProjectId?: string, newKey?: boolean }} IdentityAnswers
 */

/**
 * Plain-word problems with these answers (empty when fine), checked with the real clip.config schema plus the
 * kit's own rule: a kit-built wallet never announces Clip Wallet's identity.
 * @param {IdentityAnswers} a
 */
export function checkIdentity(a) {
  const r = validateConfig({
    name: a.name,
    rdns: a.rdns,
    ...(a.description ? { description: a.description } : {}),
    ...(a.homepage ? { homepage: a.homepage } : {}),
    ...(a.accent ? { theme: { accent: a.accent } } : {}),
    ...(a.networks ? { networks: a.networks } : {}),
    ...(a.languages ? { languages: a.languages } : {}),
    ...(a.appId ? { appId: a.appId } : {}),
    ...(a.walletConnectProjectId ? { walletConnect: { projectId: a.walletConnectProjectId } } : {}),
  });
  const problems = r.ok ? [] : [...r.problems];
  if (a.rdns === CLIP_WALLET_RDNS || /^org\.coldai\./.test(a.rdns)) problems.push(`rdns: ${a.rdns} belongs to Clip Wallet; use a reverse domain you own`);
  if (a.appId && /^org\.coldai\./.test(a.appId)) problems.push(`appId: ${a.appId} belongs to Clip Wallet; use a reverse domain you own`);
  if (a.name.trim().toLowerCase() === "clip wallet") problems.push("name: Clip Wallet is taken; give your wallet its own name");
  if (a.icon && !existsSync(a.icon)) problems.push(`logo: ${a.icon} isn't there`);
  if (a.icon && !/\.(?:svg|png)$/i.test(a.icon)) problems.push("logo: use an .svg or a .png file (a 1024×1024 PNG works everywhere)");
  return problems;
}

/** Is this SVG the starter mark create-clip-wallet draws (any accent)? @param {string} text */
export function isStarterSvg(text) {
  return /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#[0-9A-Fa-f]{3,6}"\/><circle cx="64" cy="64" r="33\.5" fill="none" stroke="#FFFFFF" stroke-width="13"\/><circle cx="64" cy="64" r="10" fill="#FFFFFF"\/><\/svg>\s*$/.test(text);
}

/**
 * The first `key: [ … ]` array literal in a config file, replaced with `items` (a scan, not a regex: linear on any input).
 * @param {string} text @param {string} key @param {readonly string[]} items
 */
function setArray(text, key, items) {
  for (let from = 0; ; ) {
    const i = text.indexOf(`${key}:`, from);
    if (i < 0) return text;
    let j = i + key.length + 1;
    while (j < text.length && /\s/.test(text[j] ?? "")) j++;
    if (text[j] === "[") {
      const end = text.indexOf("]", j);
      if (end < 0) return text;
      return `${text.slice(0, i)}${key}: [${items.map((n) => JSON.stringify(n)).join(", ")}]${text.slice(end + 1)}`;
    }
    from = i + 1;
  }
}

/** @param {string} file @param {(text: string) => string} fn */
function edit(file, fn) {
  if (!existsSync(file)) return;
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
}

/** Set KEY=value in a dotenv file, creating it; other lines are kept. @param {string} file @param {string} key @param {string} value */
function setEnv(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.length && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length, 0, `${key}=${value}`);
  writeFileSync(file, `${lines.filter((l, j) => l !== "" || j < lines.length - 1).join("\n")}\n`, { mode: 0o600 });
}

/** Read the project's identity file (undefined when the project has none). @param {string} root */
export function readIdentity(root) {
  const f = join(root, IDENTITY_FILE);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
}

/** The accent colour clip.config.ts sets. @param {string} root */
export function accentOf(root) {
  const f = join(root, CONFIG_FILE);
  return existsSync(f) ? /accent:\s*"(#[0-9a-fA-F]{3,6})"/.exec(readFileSync(f, "utf8"))?.[1] : undefined;
}

/** Is `root` a wallet project (clip.config.ts and wallet.identity.json at its root)? @param {string} root */
export function isProject(root) {
  return existsSync(join(root, CONFIG_FILE)) && existsSync(join(root, IDENTITY_FILE));
}

/**
 * Write a new identity into the project at `root`. Validates first and writes nothing on bad answers.
 * @param {string} root @param {IdentityAnswers} answers
 * @returns {{ name: string, rdns: string, slug: string, key: string, extensionId: string, keyFile: string | undefined,
 *   listings: string[], icons: string[], warnings: string[] }}
 */
export function applyIdentity(root, answers) {
  const problems = checkIdentity(answers);
  if (problems.length) throw new Error(`Can't set the wallet's identity:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  if (!existsSync(join(root, CONFIG_FILE))) throw new Error(`${root} isn't a Clip Wallet project (no ${CONFIG_FILE}).`);
  const slug = slugOf(answers.name);
  const previous = readIdentity(root) ?? {};
  const platforms = projectPlatforms(root);

  // The extension key (it fixes the extension id, also for a wallet that adds its extension later): keep the one the
  // project has unless asked for a new one.
  let key = answers.newKey ? undefined : previous.extension?.key;
  let keyFile;
  if (!key) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    keyFile = join(root, KEY_FILE);
    mkdirSync(join(root, ".keys"), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
  }

  // Icons for every platform from one logo, or the starter mark in the accent colour: when a logo is given, when the
  // accent changes, and the first time.
  const accent = answers.accent ?? accentOf(root) ?? DEFAULT_ACCENT;
  let icon = previous.icon ?? "./icon.svg";
  /** @type {string[]} */
  let icons = [];
  /** @type {string[]} */
  let warnings = [];
  if (answers.icon || answers.accent || !previous.extension?.key) {
    // Re-rendering for a new accent keeps a logo the wallet already has; only the starter mark is redrawn.
    const current = previous.icon && existsSync(join(root, previous.icon)) ? join(root, previous.icon) : undefined;
    const logo = answers.icon ?? (current && !isStarterSvg(readFileSync(current, "utf8")) ? current : undefined);
    const r = renderIcons(root, { logo, accent, platforms });
    icons = r.written;
    warnings = r.warnings;
    icon = logo ? `./icon${extname(logo).toLowerCase()}` : "./icon.svg";
  }

  const appId = answers.appId ?? previous.appId;
  /** @type {{ name: string, description: string, rdns: string, homepage?: string, icon: string, appId?: string, extension: { key: string } }} */
  const identity = {
    name: answers.name.trim(),
    description: answers.description ?? previous.description ?? `${answers.name.trim()}: a non-custodial wallet built on the Clip Wallet kit.`,
    rdns: answers.rdns,
    ...((answers.homepage ?? previous.homepage) ? { homepage: answers.homepage ?? previous.homepage } : {}),
    icon,
    ...(appId ? { appId } : {}),
    extension: { key },
  };
  writeFileSync(join(root, IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`);

  edit(join(root, CONFIG_FILE), (t) => {
    let out = t;
    if (answers.accent) out = out.replace(/accent:\s*"#[0-9a-fA-F]{3,6}"/, `accent: ${JSON.stringify(answers.accent)}`);
    if (answers.networks) out = setArray(out, "networks", answers.networks);
    if (answers.languages) out = setArray(out, "languages", answers.languages);
    return out;
  });
  for (const page of ["popup", "tab"]) {
    edit(join(root, EXTENSION_DIR, "src", "entrypoints", page, "index.html"), (t) => t.replace(/<title>[^<]*<\/title>/, `<title>${identity.name.replace(/[<&]/g, "")}</title>`));
  }

  if (answers.walletConnectProjectId) {
    setEnv(join(root, ".env"), WALLETCONNECT_ENV, answers.walletConnectProjectId);
    if (existsSync(join(root, NEXT_DIR))) setEnv(join(root, NEXT_DIR, ".env.local"), "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", answers.walletConnectProjectId);
  }

  const extensionId = extensionIdFromKey(key);
  const networks = answers.networks ?? networksOf(root);
  const listings = writeListings(root, {
    name: identity.name,
    description: identity.description,
    rdns: identity.rdns,
    homepage: identity.homepage,
    extensionId,
    key: walletKey({ name: identity.name, rdns: identity.rdns }),
    slug,
    networks,
    version: kitVersion(root),
  });
  return { name: identity.name, rdns: identity.rdns, slug, key, extensionId, keyFile, listings, icons, warnings };
}

/** The networks line of clip.config.ts. @param {string} root */
export function networksOf(root) {
  return listOf(root, "networks") ?? DEFAULT_NETWORKS;
}

/** A string-array setting in clip.config.ts (networks, languages). @param {string} root @param {string} field */
export function listOf(root, field) {
  const t = readFileSync(join(root, CONFIG_FILE), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const m = new RegExp(`${field}:\\s*\\[([^\\]]*)\\]`).exec(t);
  return m ? [...String(m[1]).matchAll(/"([^"]+)"/g)].map((x) => String(x[1])) : undefined;
}

/** The @clip-wallet/* version the project pins. @param {string} root */
export function kitVersion(root) {
  for (const f of ["package.json", ...Object.values(PLATFORM_DIRS).map((d) => join(d, "package.json"))]) {
    if (!existsSync(join(root, f))) continue;
    const pkg = JSON.parse(readFileSync(join(root, f), "utf8"));
    const v = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).find(([n]) => n.startsWith("@clip-wallet/"))?.[1];
    if (v) return String(v);
  }
  return "0.0.0";
}
