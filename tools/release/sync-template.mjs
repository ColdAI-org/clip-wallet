#!/usr/bin/env node
/**
 * Keep the Scaffold-HBAR template (templates/scaffold-hbar-clip-wallet) in step with the kit:
 *   - the kit packages it pins (@clip-wallet/* in packages/extension, create-clip-wallet at the root) are the version
 *     the monorepo is about to publish (all published packages share one version, .changeset/config.json "fixed");
 *   - tools/harness/check.mjs is the monorepo's harness, byte for byte.
 * Runs after `changeset version` (pnpm version-packages). `--check` only reports (pnpm harness runs it).
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const tpl = join(root, "templates", "scaffold-hbar-clip-wallet");
const check = process.argv.includes("--check");
const version = JSON.parse(readFileSync(join(root, "packages", "extension-kit", "package.json"), "utf8")).version;
const problems = [];

function pin(file, fields) {
  const path = join(tpl, file);
  const text = readFileSync(path, "utf8");
  const pkg = JSON.parse(text);
  for (const field of fields) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (/^(?:@clip-wallet\/|create-clip-wallet$)/.test(name) && pkg[field][name] !== version) {
        problems.push(`${file}: ${name} is ${pkg[field][name]}, the kit is ${version}`);
        pkg[field][name] = version;
      }
    }
  }
  const next = `${JSON.stringify(pkg, null, 2)}\n`;
  if (!check && next !== text) writeFileSync(path, next);
}
pin("package.json", ["devDependencies"]);
pin("packages/extension/package.json", ["dependencies", "devDependencies"]);

const harness = join(root, "tools", "harness", "check.mjs");
const copy = join(tpl, "tools", "harness", "check.mjs");
if (readFileSync(harness, "utf8") !== readFileSync(copy, "utf8")) {
  problems.push("templates/scaffold-hbar-clip-wallet/tools/harness/check.mjs differs from tools/harness/check.mjs");
  if (!check) copyFileSync(harness, copy);
}

if (check && problems.length) {
  process.stderr.write(`${problems.join("\n")}\nRun node tools/release/sync-template.mjs\n`);
  process.exit(1);
}
process.stdout.write(check ? "sync-template: ok\n" : `sync-template: template pinned to ${version}${problems.length ? ` (${problems.length} updated)` : ""}\n`);
