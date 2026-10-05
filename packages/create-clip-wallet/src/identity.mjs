// A wallet's own identity, written into a project made from the Scaffold-HBAR Clip Wallet template:
//   packages/extension/wallet.identity.json   name, description, rdns, homepage, icon, extension.key (public)
//   packages/extension/.keys/extension.pem    the extension's private key (gitignored, 0600; never printed)
//   packages/extension/clip.config.ts         theme accent and networks (only when given)
//   packages/extension/icon.svg + public/icon/{16,32,48,128}.png   a starter icon in the accent colour
//   packages/extension/src/entrypoints/{popup,tab}/index.html      page titles
//   packages/extension/.env, packages/nextjs/.env.local           WalletConnect project id (never committed)
//   docs/listings/*.md                                             listing-submission drafts for this identity
// `npx create-clip-wallet my-wallet` runs it after copying the template; in a project made with create-scaffold-hbar,
// `pnpm wallet:identity` runs the same code.
import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { CLIP_WALLET_RDNS, WALLETCONNECT_ENV, validateConfig, walletKey } from "@clip-wallet/config";
import { ICON_SIZES, iconPng, iconSvg } from "./icon.mjs";
import { writeListings } from "./listings.mjs";

export const EXTENSION_DIR = join("packages", "extension");
export const IDENTITY_FILE = join(EXTENSION_DIR, "wallet.identity.json");
export const KEY_FILE = join(EXTENSION_DIR, ".keys", "extension.pem");
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

/** "evm:*, hedera" -> ["evm:*", "hedera"] @param {string} text */
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

/**
 * @typedef {{ name: string, rdns: string, accent?: string, networks?: string[], description?: string, homepage?: string,
 *   icon?: string, walletConnectProjectId?: string, newKey?: boolean }} IdentityAnswers
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
    ...(a.walletConnectProjectId ? { walletConnect: { projectId: a.walletConnectProjectId } } : {}),
  });
  const problems = r.ok ? [] : [...r.problems];
  if (a.rdns === CLIP_WALLET_RDNS || /^org\.coldai\./.test(a.rdns)) problems.push(`rdns: ${a.rdns} belongs to Clip Wallet; use a reverse domain you own`);
  if (a.name.trim().toLowerCase() === "clip wallet") problems.push("name: Clip Wallet is taken; give your wallet its own name");
  if (a.icon && !existsSync(a.icon)) problems.push(`icon: ${a.icon} isn't there`);
  if (a.icon && !/\.(?:svg|png)$/i.test(a.icon)) problems.push("icon: use an .svg or a .png file");
  return problems;
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

/**
 * Write a new identity into the project at `root`. Validates first and writes nothing on bad answers.
 * @param {string} root @param {IdentityAnswers} answers
 * @returns {{ name: string, rdns: string, slug: string, key: string, extensionId: string, keyFile: string | undefined, listings: string[] }}
 */
export function applyIdentity(root, answers) {
  const problems = checkIdentity(answers);
  if (problems.length) throw new Error(`Can't set the wallet's identity:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  const ext = join(root, EXTENSION_DIR);
  if (!existsSync(join(ext, "clip.config.ts"))) throw new Error(`${root} isn't a Clip Wallet project (no ${join(EXTENSION_DIR, "clip.config.ts")}).`);
  const slug = slugOf(answers.name);
  const previous = readIdentity(root) ?? {};

  // The extension key: keep the one the project has unless asked for a new one.
  let key = answers.newKey ? undefined : previous.extension?.key;
  let keyFile;
  if (!key) {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
    keyFile = join(root, KEY_FILE);
    mkdirSync(join(ext, ".keys"), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
  }

  // Icon: the given file, or a starter mark in the accent colour.
  const accent = answers.accent ?? /accent:\s*"(#[0-9a-fA-F]{3,6})"/.exec(readFileSync(join(ext, "clip.config.ts"), "utf8"))?.[1] ?? DEFAULT_ACCENT;
  let icon = previous.icon ?? "./icon.svg";
  mkdirSync(join(ext, "public", "icon"), { recursive: true });
  if (answers.icon) {
    const isPng = extname(answers.icon).toLowerCase() === ".png";
    icon = isPng ? "./icon.png" : "./icon.svg";
    copyFileSync(resolve(answers.icon), join(ext, icon));
    // PNG artwork works at every manifest size; for SVG artwork, keep starter PNGs until you export your own.
    for (const s of ICON_SIZES) writeFileSync(join(ext, "public", "icon", `${s}.png`), isPng ? readFileSync(resolve(answers.icon)) : iconPng(accent, s));
  } else if (answers.accent || !previous.extension?.key) {
    icon = "./icon.svg";
    writeFileSync(join(ext, "icon.svg"), iconSvg(accent));
    for (const s of ICON_SIZES) writeFileSync(join(ext, "public", "icon", `${s}.png`), iconPng(accent, s));
  }

  /** @type {{ name: string, description: string, rdns: string, homepage?: string, icon: string, extension: { key: string } }} */
  const identity = {
    name: answers.name.trim(),
    description: answers.description ?? previous.description ?? `${answers.name.trim()}: a non-custodial wallet built on the Clip Wallet kit.`,
    rdns: answers.rdns,
    ...((answers.homepage ?? previous.homepage) ? { homepage: answers.homepage ?? previous.homepage } : {}),
    icon,
    extension: { key },
  };
  writeFileSync(join(root, IDENTITY_FILE), `${JSON.stringify(identity, null, 2)}\n`);

  edit(join(ext, "clip.config.ts"), (t) => {
    let out = t;
    if (answers.accent) out = out.replace(/accent:\s*"#[0-9a-fA-F]{3,6}"/, `accent: ${JSON.stringify(answers.accent)}`);
    if (answers.networks) out = out.replace(/networks:\s*\[[^\]]*\]/, `networks: [${answers.networks.map((n) => JSON.stringify(n)).join(", ")}]`);
    return out;
  });
  for (const page of ["popup", "tab"]) {
    edit(join(ext, "src", "entrypoints", page, "index.html"), (t) => t.replace(/<title>[^<]*<\/title>/, `<title>${identity.name.replace(/[<&]/g, "")}</title>`));
  }

  if (answers.walletConnectProjectId) {
    setEnv(join(ext, ".env"), WALLETCONNECT_ENV, answers.walletConnectProjectId);
    setEnv(join(root, "packages", "nextjs", ".env.local"), "NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID", answers.walletConnectProjectId);
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
  return { name: identity.name, rdns: identity.rdns, slug, key, extensionId, keyFile, listings };
}

/** The networks line of clip.config.ts. @param {string} root */
export function networksOf(root) {
  const t = readFileSync(join(root, EXTENSION_DIR, "clip.config.ts"), "utf8");
  const m = /networks:\s*\[([^\]]*)\]/.exec(t);
  return m ? [...String(m[1]).matchAll(/"([^"]+)"/g)].map((x) => String(x[1])) : DEFAULT_NETWORKS;
}

/** The @clip-wallet/extension-kit version the project pins. @param {string} root */
export function kitVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, EXTENSION_DIR, "package.json"), "utf8"));
  return pkg.dependencies?.["@clip-wallet/extension-kit"] ?? "0.0.0";
}
