#!/usr/bin/env node
/**
 * Clip Wallet harness: the rules in AGENTS.md that a coding agent must not break, checked mechanically.
 *
 *   node tools/harness/check.mjs [root]        (pnpm harness)
 *   node tools/harness/check.mjs --json [root]
 *
 * Node built-ins only. Exits 1 when any rule fails; warnings never fail the run.
 * Unit tests: node --test tools/harness/test/*.test.mjs
 *
 * The checks are lexical (comments stripped, strings understood), not a full parser. They catch the
 * mistakes agents actually make: importing key-material libraries outside the vault, importing the
 * vault from the wrong place, logging secrets, committing .env files, losing the vault's test vectors.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------ configuration */

export const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|svelte|vue)$/;
export const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".output", ".wxt", "coverage", ".turbo", ".next", "build"]);
/** Paths (relative, posix) never scanned when checking the real repo: they hold deliberate violations. */
export const SKIP_PATHS = ["tools/harness/test/fixtures/"];

/** Only these may import key-material libraries. */
export const VAULT_DIRS = ["packages/vault/"];

/** Only these may import @clip-wallet/vault (besides the vault itself). */
export const VAULT_IMPORT_ALLOW = [
  /^packages\/vault\//,
  /^apps\/extension\/(?:src\/)?(?:entrypoints\/)?background(?:\/|\.[cm]?[jt]sx?$)/,
  // The onboarding screen (packages/ui/src/screens/Onboarding.tsx) or an onboarding folder in the UI or extension.
  /^(?:packages\/ui|apps\/extension)\/(?:.*\/)?onboarding(?:\/|\.[cm]?[jt]sx?$)/i,
];

/** Where literal BIP-39 phrases may appear (the public test vectors). */
export const PHRASE_LITERAL_ALLOW = [/^packages\/vault\/test\//, /^tools\/harness\/test\//];

/**
 * Key-material APIs. `any: true` = any import of the module counts; otherwise only the listed symbols, imported by
 * name or used as `<binding>.<symbol>` (also `<binding>.utils.<symbol>`) or destructured from a binding.
 */
export const KEY_MATERIAL = [
  {
    module: /^@scure\/sr25519$/,
    symbols: ["secretFromSeed", "sign", "getSharedSecret", "fromKeypair", "HDKD", "vrf"],
    what: "sr25519 private-key or signing APIs (@scure/sr25519); verify is fine",
  },
  {
    module: /^@scure\/starknet$/,
    symbols: ["sign", "grindKey", "getStarkKey", "getPublicKey", "getSharedSecret", "ethSigToPrivate"],
    what: "Stark private-key or signing APIs (@scure/starknet); verify and pedersen are fine",
  },
  { module: /^@scure\/bip39(?:\/.*)?$/, any: true, what: "seed phrases (@scure/bip39)" },
  { module: /^@scure\/bip32(?:\/.*)?$/, any: true, what: "HD key derivation (@scure/bip32)" },
  { module: /^ed25519-hd-key$/, any: true, what: "HD key derivation (ed25519-hd-key)" },
  { module: /^micro-key-producer(?:\/.*)?$/, any: true, what: "key derivation (micro-key-producer)" },
  {
    module: /^@noble\/curves\/(?:secp256k1|ed25519|ed448|p256|nist)(?:\.js)?$/,
    symbols: ["sign", "getPublicKey", "getSharedSecret", "keygen", "randomPrivateKey", "randomSecretKey", "precompute"],
    what: "private-key or signing APIs of @noble/curves (verification and public-key maths are fine)",
  },
  {
    module: /^@noble\/(?:secp256k1|ed25519)$/,
    symbols: ["sign", "signAsync", "getPublicKey", "getPublicKeyAsync", "getSharedSecret", "keygen", "randomPrivateKey", "randomSecretKey"],
    what: "private-key or signing APIs of @noble/secp256k1 / @noble/ed25519",
  },
  { module: /^hash-wasm$/, symbols: ["argon2id", "argon2i", "argon2d", "argon2Verify"], what: "password hashing for the vault (hash-wasm argon2)" },
  {
    module: /^viem\/accounts$/,
    symbols: ["privateKeyToAccount", "mnemonicToAccount", "hdKeyToAccount", "generatePrivateKey", "generateMnemonic"],
    what: "private-key accounts (viem/accounts)",
  },
  { module: /^ethers$/, symbols: ["Wallet", "HDNodeWallet", "Mnemonic", "SigningKey"], what: "private-key wallets (ethers)" },
  { module: /^@(?:hashgraph|hiero-ledger)\/sdk$/, symbols: ["PrivateKey", "Mnemonic"], what: "private keys (Hedera SDK)" },
  { module: /^@solana\/web3\.js$/, symbols: ["Keypair"], what: "keypairs (@solana/web3.js)" },
];

const SECRET_NAME = /(phrase|mnemonic|seed|private_?key|secret)/i;
const CONSOLE_CALL = /\bconsole\s*\.\s*(log|error|warn|info|debug|trace|dir|table)\s*\(/g;

/* ------------------------------------------------------------------ lexing */

/**
 * Split source into code with comments blanked (same length, newlines kept) and a list of string literals with
 * their offsets. Template literal text counts as a string; `${...}` stays code. Regex literals are not detected.
 */
export function lex(src) {
  let code = "";
  const strings = [];
  let i = 0;
  const n = src.length;
  const tplStack = [];
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      const j = src.indexOf("\n", i);
      const end = j < 0 ? n : j;
      code += " ".repeat(end - i);
      i = end;
    } else if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j < 0 ? n : j + 2;
      code += src.slice(i, end).replace(/[^\n]/g, " ");
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      strings.push({ start: i, value: src.slice(i + 1, j) });
      code += c + " ".repeat(Math.max(0, j - i - 1)) + (j < n ? c : "");
      i = j + 1;
    } else if (c === "`" || (c === "}" && tplStack.length && tplStack[tplStack.length - 1] === 0)) {
      if (c === "}") tplStack.pop();
      let j = i + 1;
      while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) j += src[j] === "\\" ? 2 : 1;
      strings.push({ start: i, value: src.slice(i + 1, j) });
      code += c + src.slice(i + 1, j).replace(/[^\n]/g, " ");
      if (src[j] === "$") {
        code += "${";
        tplStack.push(0);
        i = j + 2;
      } else {
        code += j < n ? "`" : "";
        i = j + 1;
      }
    } else {
      if (tplStack.length) {
        if (c === "{") tplStack[tplStack.length - 1]++;
        else if (c === "}") tplStack[tplStack.length - 1]--;
      }
      code += c;
      i++;
    }
  }
  return { code, strings };
}

export function lineOf(src, offset) {
  let line = 1;
  for (let k = 0; k < offset && k < src.length; k++) if (src.charCodeAt(k) === 10) line++;
  return line;
}

/**
 * Imports of a file: static `import ... from`, side-effect `import "x"`, `export ... from`, `import("x")` and
 * `require("x")`. Module specifiers are read from the original source at the offsets of the blanked strings.
 */
export function findImports(src, lexed = lex(src)) {
  const { code, strings } = lexed;
  const at = new Map(strings.map((s) => [s.start, s.value]));
  const out = [];
  const re = /\b(?:import|export)\s*(type\s+)?([\w$\s{},*]*?)\s*from\s*(["'])|\bimport\s*(["'])|\bimport\s*\(\s*(["'`])|\brequire\s*\(\s*(["'`])/g;
  let m;
  while ((m = re.exec(code))) {
    const quoteIdx = m.index + m[0].length - 1;
    const spec = at.get(quoteIdx);
    if (spec === undefined) continue;
    const clause = m[2] ?? "";
    out.push({ module: spec, clause, typeOnly: Boolean(m[1]), offset: m.index, dynamic: !m[2] && !m[3] && !m[4] });
  }
  return out;
}

/** Local bindings of an import clause: { name, imported, namespace }. */
export function bindings(clause) {
  const out = [];
  const c = clause.trim();
  const ns = /\*\s*as\s+([\w$]+)/.exec(c);
  if (ns) out.push({ name: ns[1], imported: "*", namespace: true });
  const braces = /\{([^}]*)\}/.exec(c);
  if (braces) {
    for (const part of braces[1].split(",")) {
      const p = part.trim().replace(/^type\s+/, "");
      if (!p) continue;
      const [imported, local] = p.split(/\s+as\s+/).map((s) => s.trim());
      out.push({ name: local ?? imported, imported, namespace: false });
    }
  }
  const def = /^([\w$]+)\s*(?:,|$)/.exec(c);
  if (def && def[1] !== "type") out.push({ name: def[1], imported: "default", namespace: true });
  return out;
}

/* ------------------------------------------------------------------ files */

const posix = (p) => p.split(sep).join("/");

export function listFiles(root, { skipPaths = SKIP_PATHS } = {}) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = posix(relative(root, abs));
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (skipPaths.some((s) => `${rel}/`.startsWith(s))) continue;
        walk(abs);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

function packageDirOf(rel) {
  const m = /^((?:packages|apps|templates)\/[^/]+)\//.exec(rel);
  return m ? m[1] : undefined;
}

function loadWordlist(root) {
  const candidates = [];
  const pnpmDir = join(root, "node_modules", ".pnpm");
  try {
    for (const d of readdirSync(pnpmDir)) {
      if (d.startsWith("@scure+bip39@")) candidates.push(join(pnpmDir, d, "node_modules/@scure/bip39/wordlists/english.js"));
    }
  } catch {
    /* no install */
  }
  candidates.push(join(root, "packages/vault/node_modules/@scure/bip39/wordlists/english.js"));
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, "utf8");
    const body = /`([a-z\n]+)`/.exec(text);
    if (body) {
      const words = body[1].split("\n").filter(Boolean);
      if (words.length === 2048) return new Set(words);
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ rules */

function keyMaterialHits(imp, code) {
  const hits = [];
  for (const rule of KEY_MATERIAL) {
    if (!rule.module.test(imp.module)) continue;
    if (imp.typeOnly) continue;
    if (rule.any) {
      hits.push(rule);
      continue;
    }
    const bs = bindings(imp.clause);
    if (imp.dynamic || bs.length === 0) {
      // import("x") / require("x") / side-effect import: can't see bindings, so judge by whole-file usage.
      const used = rule.symbols.some((s) => new RegExp(`\\.\\s*${s}\\s*\\(|\\b${s}\\b`).test(code));
      if (used) hits.push(rule);
      continue;
    }
    let hit = false;
    for (const b of bs) {
      if (!b.namespace && rule.symbols.includes(b.imported)) hit = true;
      const name = b.name.replace(/\$/g, "\\$");
      const sym = rule.symbols.join("|");
      // binding.sign(…), binding.utils.randomSecretKey(…), ns.secp256k1.sign(…)
      if (new RegExp(`\\b${name}\\s*(?:\\.\\s*[\\w$]+\\s*)?\\.\\s*(?:utils\\s*\\.\\s*)?(?:${sym})\\b`).test(code)) hit = true;
      // const { sign } = binding
      const destr = new RegExp(`\\{([^}]*)\\}\\s*=\\s*${name}\\b`, "g");
      let dm;
      while ((dm = destr.exec(code))) {
        if (dm[1].split(",").some((p) => rule.symbols.includes(p.split(":")[0].trim()))) hit = true;
      }
    }
    if (hit) hits.push(rule);
  }
  return hits;
}

function consoleSecretHits(code) {
  const hits = [];
  CONSOLE_CALL.lastIndex = 0;
  let m;
  while ((m = CONSOLE_CALL.exec(code))) {
    let depth = 1;
    let j = m.index + m[0].length;
    const start = j;
    while (j < code.length && depth > 0) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
      j++;
    }
    const args = code.slice(start, j - 1);
    const ids = args.match(/[A-Za-z_$][\w$]*/g) ?? [];
    const bad = ids.find((id) => SECRET_NAME.test(id));
    if (bad) hits.push({ offset: m.index, method: m[1], name: bad });
  }
  return hits;
}

function phraseLiteralHits(strings, wordlist) {
  const hits = [];
  for (const s of strings) {
    const words = s.value.trim().split(/\s+/);
    if (words.length < 12 || words.length > 24 || words.length % 3 !== 0) continue;
    if (!words.every((w) => /^[a-z]{3,8}$/.test(w))) continue;
    if (wordlist && !words.every((w) => wordlist.has(w))) continue;
    hits.push({ offset: s.start, words: words.length });
  }
  return hits;
}

function trackedFiles(root) {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return out.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

/** The public BIP-39 vector "abandon x11 about" (built, so the harness doesn't trip its own phrase rule). */
const KAT_PHRASE = `${"abandon ".repeat(11)}about`;

/* ------------------------------------------------------------------ runner */

/**
 * Run every rule over `root`. `tracked` overrides `git ls-files` and `wordlistFrom` is where node_modules lives
 * (tests). Returns { failures, warnings } with
 * { rule, file, line, message } entries.
 */
export function runChecks({ root, tracked, skipPaths = SKIP_PATHS, wordlistFrom = root } = {}) {
  const failures = [];
  const warnings = [];
  const fail = (rule, file, line, message) => failures.push({ rule, file, line, message });
  const warn = (rule, file, line, message) => warnings.push({ rule, file, line, message });

  const files = listFiles(root, { skipPaths });
  const sources = files.filter((f) => SOURCE_EXT.test(f) && !f.endsWith(".d.ts"));
  const wordlist = loadWordlist(wordlistFrom);

  // Chain-module packages: packages/chains-*, or a package (not an app) with a class that implements ChainModule.
  // A type annotation like `: ChainModule` is not enough: the app background holds modules AND the vault.
  const chainPackages = new Set(files.map(packageDirOf).filter((p) => p && /^packages\/chains-/.test(p)));
  const parsed = new Map();
  for (const f of sources) {
    const src = readFileSync(join(root, f), "utf8");
    const lexed = lex(src);
    parsed.set(f, { src, lexed });
    const pkg = packageDirOf(f);
    if (pkg && pkg !== "packages/core" && !pkg.startsWith("apps/") && /implements\s+ChainModule\b/.test(lexed.code)) chainPackages.add(pkg);
  }

  for (const [f, { src, lexed }] of parsed) {
    const inVault = VAULT_DIRS.some((d) => f.startsWith(d));
    const pkg = packageDirOf(f);
    const line = (off) => lineOf(src, off);

    for (const imp of findImports(src, lexed)) {
      if (!inVault) {
        for (const rule of keyMaterialHits(imp, lexed.code)) {
          fail(
            "key-material-outside-vault",
            f,
            line(imp.offset),
            `Only packages/vault may handle keys: this file uses ${rule.what} via "${imp.module}". Move the code into packages/vault and call it through the Vault interface from @clip-wallet/core.`,
          );
        }
      }
      if (/^@clip-wallet\/vault(?:\/.*)?$/.test(imp.module) && !imp.typeOnly) {
        if (pkg && chainPackages.has(pkg)) {
          fail(
            "chain-module-imports-vault",
            f,
            line(imp.offset),
            `Chain modules never import the vault: ${pkg} implements ChainModule but imports @clip-wallet/vault. Return a SignablePayload from prepare() and let the background ask the vault to sign it.`,
          );
        } else if (!VAULT_IMPORT_ALLOW.some((re) => re.test(f))) {
          fail(
            "vault-import-not-allowed",
            f,
            line(imp.offset),
            "Only the extension background and the onboarding screen may import @clip-wallet/vault. Send a message to the background instead (type-only imports are fine).",
          );
        }
      }
    }

    for (const h of consoleSecretHits(lexed.code)) {
      fail(
        "logs-secret",
        f,
        line(h.offset),
        `Never log key material: console.${h.method} prints "${h.name}", which looks like a phrase, seed, private key or secret. Remove the log or log something that isn't secret.`,
      );
    }

    if (!PHRASE_LITERAL_ALLOW.some((re) => re.test(f))) {
      for (const h of phraseLiteralHits(lexed.strings, wordlist)) {
        fail(
          "phrase-literal",
          f,
          line(h.offset),
          `This string looks like a ${h.words}-word recovery phrase. Phrases may appear only in packages/vault/test (the public BIP-39 test vectors).`,
        );
      }
    }
  }

  // package.json: a chain module must not even depend on the vault.
  for (const pkg of chainPackages) {
    const pj = join(root, pkg, "package.json");
    if (!existsSync(pj)) continue;
    const text = readFileSync(pj, "utf8");
    const idx = text.indexOf('"@clip-wallet/vault"');
    if (idx >= 0) {
      fail(
        "chain-module-imports-vault",
        `${pkg}/package.json`,
        lineOf(text, idx),
        `Chain modules never depend on the vault: remove @clip-wallet/vault from ${pkg}/package.json.`,
      );
    }
  }

  // .env files must never be tracked.
  const tf = tracked ?? trackedFiles(root);
  if (!tf) {
    warn("env-tracked", ".", 0, "Not a git checkout, so tracked .env files were not checked.");
  } else {
    for (const f of tf) {
      const base = f.split("/").pop();
      if (/^\.env(?:\..+)?$/.test(base) && !/^\.env\.(?:example|sample|template)$/.test(base)) {
        fail("env-tracked", f, 0, `${f} is tracked by git. .env files hold secrets: run \`git rm --cached ${f}\` and keep it in .gitignore.`);
      }
    }
  }

  // The vault's known-answer tests must exist.
  if (!existsSync(join(root, "packages/vault"))) {
    warn("vault-kat-missing", "packages/vault", 0, "packages/vault is not in this checkout, so its test vectors were not checked.");
  } else {
    const tests = files.filter((f) => f.startsWith("packages/vault/") && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f));
    const withKat = tests.filter((f) => readFileSync(join(root, f), "utf8").includes(KAT_PHRASE));
    if (withKat.length === 0) {
      fail(
        "vault-kat-missing",
        "packages/vault",
        0,
        `The vault has no known-answer tests: add a test under packages/vault/test that uses the public BIP-39 vector "${KAT_PHRASE}".`,
      );
    }
  }

  if (!wordlist) {
    warn("phrase-literal", ".", 0, "The BIP-39 wordlist isn't installed (run pnpm install), so phrase literals were matched by shape only.");
  }
  return { failures, warnings, scanned: sources.length };
}

export function format({ failures, warnings, scanned }) {
  const loc = (x) => (x.line ? `${x.file}:${x.line}` : x.file);
  const lines = [];
  for (const w of warnings) lines.push(`warning  ${loc(w)}  ${w.message}`);
  for (const f of failures) lines.push(`FAIL     ${loc(f)}  ${f.message}  [${f.rule}]`);
  lines.push(
    failures.length
      ? `\nharness: ${failures.length} problem${failures.length === 1 ? "" : "s"} in ${scanned} source files. Fix them before committing.`
      : `harness: ok (${scanned} source files, ${warnings.length} warning${warnings.length === 1 ? "" : "s"})`,
  );
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const rootArg = args.find((a) => !a.startsWith("--"));
  const root = rootArg ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`harness: ${root} is not a directory`);
    process.exit(2);
  }
  const result = runChecks({ root });
  console.log(json ? JSON.stringify(result, null, 2) : format(result));
  process.exit(result.failures.length ? 1 : 0);
}
