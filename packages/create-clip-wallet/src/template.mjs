// The copy step, done the way create-scaffold-hbar does it, so `npx create-clip-wallet my-wallet` and
// `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` start from the same tree:
// copy the template (skipping .git, node_modules, .next and .env), apply template.json's rename map and envVars, delete
// template.json, then `git init -b main` and a first commit. See create-scaffold-hbar 0.4.x copyTemplateFiles /
// processTemplateManifest.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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

const SKIP = new Set([".git", "node_modules", ".next", ".env", ".output", ".output-fixtures", ".wxt", ".keys"]);

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
