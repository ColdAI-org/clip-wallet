// The copy step, done the way create-scaffold-hbar does it, so `npx create-clip-wallet my-wallet` and
// `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` start from the same tree:
// copy the template (skipping .git, node_modules, .next and .env), apply template.json's rename map and envVars, delete
// template.json, then `git init -b main` and a first commit. See create-scaffold-hbar 0.4.x copyTemplateFiles /
// processTemplateManifest.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** npm never packs files named .gitignore or .npmrc, so the published template carries them with a leading "_". */
export const PACKED_DOTFILES = [".gitignore", ".npmrc"];

/** Where the template is: the monorepo's templates/ (development) or bundled in the package (npm). */
export function templateDir() {
  for (const d of [join(PKG_DIR, "..", "..", "templates", "scaffold-hbar-clip-wallet"), join(PKG_DIR, "template")]) {
    if (existsSync(join(d, "template.json"))) return d;
  }
  throw new Error("The wallet template isn't in this copy of create-clip-wallet. Reinstall it (npx create-clip-wallet@latest).");
}

const SKIP = new Set([".git", "node_modules", ".next", ".env", ".output", ".output-fixtures", ".wxt", ".keys", ".expo"]);

/** @param {string} src */
function shouldCopy(src) {
  const base = basename(src);
  if (SKIP.has(base)) return false;
  if (base === "cache" && basename(dirname(src)) === ".yarn") return false;
  return true;
}

/**
 * Copy the template into `targetDir` (which must be empty or missing) and restore packed dotfiles.
 * @param {string} from @param {string} targetDir
 */
export function copyTemplate(from, targetDir) {
  for (const entry of readdirSync(from)) {
    const src = join(from, entry);
    if (!shouldCopy(src)) continue;
    cpSync(src, join(targetDir, entry), { recursive: true, filter: shouldCopy });
  }
  restoreDotfiles(targetDir);
}

/** "_gitignore" -> ".gitignore" everywhere under dir (only where the dotted name isn't there already). @param {string} dir */
export function restoreDotfiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") restoreDotfiles(p);
    } else {
      const dotted = PACKED_DOTFILES.find((d) => e.name === `_${d.slice(1)}`);
      if (dotted && !existsSync(join(dir, dotted))) renameSync(p, join(dir, dotted));
    }
  }
}

/** All files under dir (absolute), skipping node_modules and .git. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/**
 * create-scaffold-hbar rewrites the root package.json after the copy (filterRootPackageJson: workspaces and scripts
 * for the chosen frameworks, written as JSON.stringify(pkg, null, 2) without a trailing newline). With this template's
 * choices (nextjs-app, no Solidity framework, pnpm) nothing is filtered, so only the formatting changes; do the same.
 * @param {string} projectDir
 */
export function normalizeRootPackageJson(projectDir) {
  const file = join(projectDir, "package.json");
  if (existsSync(file)) writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, "utf8")), null, 2));
}

/**
 * template.json, as create-scaffold-hbar reads it: apply `rename` ({{projectName}} = the folder name) and `envVars`
 * (.env.example), then delete the manifest. Returns the outro sections for the next-steps message.
 * @param {string} projectDir @param {string} projectName
 */
export function processTemplateManifest(projectDir, projectName) {
  const manifestPath = join(projectDir, "template.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const block = manifest["create-scaffold-hbar"] ?? manifest["create-hbar"] ?? {};
  for (const [placeholder, entry] of Object.entries(block.rename ?? {})) {
    const to = String(entry.to).replaceAll("{{projectName}}", projectName);
    for (const rel of entry.paths ?? []) {
      const dir = join(projectDir, rel);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      for (const f of filesUnder(dir)) {
        const text = readFileSync(f, "utf8");
        if (text.includes(placeholder)) writeFileSync(f, text.split(placeholder).join(to));
      }
    }
  }
  if (block.envVars?.length) {
    const lines = block.envVars.flatMap((/** @type {{key: string, description: string}} */ v) => [`# ${v.description}`, `${v.key}=`, ""]);
    writeFileSync(join(projectDir, ".env.example"), `${lines.join("\n").trimEnd()}\n`);
  }
  unlinkSync(manifestPath);
  return block.outro?.sections;
}

/** `git init -b main` and a first commit, like create-scaffold-hbar. Returns false when git isn't usable. @param {string} dir @param {string} message */
export function gitInit(dir, message) {
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", message, "--no-verify", "--no-gpg-sign"], { cwd: dir, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ platforms */

/** What a project can contain besides the wallet's config: the three platforms and the Scaffold-HBAR dapp. */
export const PARTS = /** @type {const} */ (["extension", "desktop", "mobile", "nextjs"]);

/**
 * Blocks of text that belong to one part, removed when that part isn't in the project. Markers sit on lines of their
 * own and stay when the part is kept (so a project with everything is byte-for-byte the template):
 *   <!-- platform:desktop --> … <!-- /platform:desktop -->      Markdown
 *   # platform:desktop … # /platform:desktop                    YAML, shell
 *   // platform:desktop … // /platform:desktop                  JavaScript
 *   | a table row | … <!-- only:desktop --> |                  one line (Markdown tables can't hold block markers)
 * Part names: extension, desktop, mobile, nextjs (the Scaffold-HBAR dapp).
 * @param {string} text @param {ReadonlySet<string>} keep
 */
export function stripParts(text, keep) {
  const lines = text.split("\n");
  const out = [];
  /** @type {string[]} */
  const stack = [];
  for (const line of lines) {
    const bare = line.trim();
    const open = /^(?:<!--|#|\/\/)\s*platform:([a-z]+)(?:\s*-->)?$/.exec(bare);
    const close = /^(?:<!--|#|\/\/)\s*\/platform:([a-z]+)(?:\s*-->)?$/.exec(bare);
    const dropping = stack.some((p) => !keep.has(p));
    if (open) {
      stack.push(/** @type {string} */ (open[1]));
      if (!dropping && keep.has(/** @type {string} */ (open[1]))) out.push(line);
      continue;
    }
    if (close) {
      const p = stack.pop();
      if (p === undefined || p !== close[1]) throw new Error(`mismatched platform markers: ${p ?? "none"} closed by ${close[1]}`);
      if (!stack.some((x) => !keep.has(x)) && keep.has(p)) out.push(line);
      continue;
    }
    const only = /<!--\s*only:([a-z]+)\s*-->/.exec(line);
    if (!dropping && (!only || keep.has(/** @type {string} */ (only[1])))) out.push(line);
  }
  if (stack.length) throw new Error(`unclosed platform marker: ${stack.join(", ")}`);
  return out.join("\n");
}

/**
 * Root package.json scripts without the parts that aren't there: scripts that run a removed package go, and so do
 * steps of composite scripts ("pnpm a && pnpm b") that call a removed script. @param {Record<string, string>} scripts
 * @param {readonly string[]} removed package folders (extension, desktop, mobile, nextjs)
 */
export function pruneScripts(scripts, removed) {
  const out = { ...scripts };
  const gone = new Set();
  for (const [k, v] of Object.entries(out)) {
    if (removed.some((p) => v.includes(`--filter @sh/${p}`))) {
      delete out[k];
      gone.add(k);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [k, v] of Object.entries(out)) {
      const steps = v.split(" && ");
      const kept = steps.filter((s) => !gone.has(s.trim().replace(/^pnpm\s+/, "").split(/\s+/)[0] ?? ""));
      if (kept.length === steps.length) continue;
      changed = true;
      if (kept.length) out[k] = kept.join(" && ");
      else {
        delete out[k];
        gone.add(k);
      }
    }
  }
  return out;
}

/** Files that carry platform markers. */
export const MARKED_FILES = ["README.md", "AGENTS.md", "llms.txt", "MAINNET.md", "docs/signing.md", ".github/workflows/ci.yaml", "tools/verify-provenance.mjs"];

/**
 * Keep only the chosen platforms (and the Scaffold-HBAR dapp when asked): remove the other packages, their scripts and
 * their sections of the docs. Everything chosen = the template unchanged. @param {string} projectDir
 * @param {{ platforms: readonly string[], scaffoldHbar: boolean }} o
 */
export function selectParts(projectDir, o) {
  const keep = new Set([...o.platforms, ...(o.scaffoldHbar ? ["nextjs"] : [])]);
  const removed = PARTS.filter((p) => !keep.has(p));
  for (const p of removed) rmSync(join(projectDir, "packages", p), { recursive: true, force: true });
  if (!removed.length) return removed;
  const pkgFile = join(projectDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  pkg.scripts = pruneScripts(pkg.scripts ?? {}, removed);
  writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  for (const f of MARKED_FILES) {
    const file = join(projectDir, f);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") continue; // a part's file that isn't in this project
      throw e;
    }
    writeFileSync(file, stripParts(text, keep));
  }
  return removed;
}
