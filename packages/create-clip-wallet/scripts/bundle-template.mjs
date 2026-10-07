// prepack: bundle templates/scaffold-hbar-clip-wallet into ./template, so the published CLI copies the same tree the
// template repository serves to create-scaffold-hbar. npm never packs files named .gitignore or .npmrc, so those
// travel as _gitignore / _npmrc and the CLI renames them back (src/template.mjs). `--clean` (postpack) removes it.
import { cpSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(pkg, "template");
rmSync(out, { recursive: true, force: true });
if (process.argv.includes("--clean")) process.exit(0);

const src = join(pkg, "..", "..", "templates", "scaffold-hbar-clip-wallet");
if (!existsSync(join(src, "template.json"))) throw new Error(`no template at ${src}`);
const SKIP = new Set(["node_modules", ".next", ".output", ".output-fixtures", ".wxt", ".keys", ".env", ".harness/runs", ".expo"]);
cpSync(src, out, {
  recursive: true,
  filter: (p) => !SKIP.has(basename(p)) && !/\.tsbuildinfo$/.test(p) && !/(?:^|\/)\.env\.(?!example$)[^/]+$/.test(p),
});
/** @param {string} dir */
const rename = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rename(p);
    else if (e.name === ".gitignore" || e.name === ".npmrc") renameSync(p, join(dir, `_${e.name.slice(1)}`));
  }
};
rename(out);
