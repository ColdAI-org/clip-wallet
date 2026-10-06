#!/usr/bin/env node
/**
 * pnpm pack-all: build every publishable package, check the manifests, and pack each one into ./.packs exactly as
 * `pnpm publish` would (publishConfig applied, workspace:* replaced by versions). Publishes nothing.
 *
 *   node tools/release/pack-all.mjs [--no-build]
 *
 * Every tarball is then opened and checked: package.json points only at files inside it, nothing from src/, test/
 * or a .env file is included, and no @clip-wallet dependency is left as workspace:*. The list is written to
 * .packs/manifest.json ({ name, version, file }) for tools/kit/e2e.mjs and the template overrides.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./manifest.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const out = join(root, ".packs");
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();

if (!process.argv.includes("--no-build")) {
  process.stdout.write("Building publishable packages…\n");
  execFileSync("pnpm", ["-r", "--filter", "./packages/**", "--workspace-concurrency=4", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
}
execFileSync(process.execPath, [join(root, "tools/release/check-manifests.mjs"), "--dist"], { cwd: root, stdio: "inherit" });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const problems = [];
const packed = [];
for (const { dir, path, pkg } of publishablePackages(root)) {
  run("pnpm", ["pack", "--pack-destination", out], path);
  const file = readdirSync(out).find((f) => f.endsWith(".tgz") && !packed.some((p) => p.file === f));
  if (!file) {
    problems.push(`${dir}: pnpm pack wrote no tarball`);
    continue;
  }
  const list = run("tar", ["-tzf", join(out, file)]).split("\n").filter(Boolean).map((f) => f.replace(/^package\//, ""));
  const manifest = JSON.parse(run("tar", ["-xzOf", join(out, file), "package/package.json"]));
  for (const f of list) {
    if (/^(?:src|test)\//.test(f) && pkg.name !== "create-clip-wallet") problems.push(`${file}: ships ${f} (only dist/ belongs in the tarball)`);
    if (/(?:^|\/)\.env(?:\..+)?$/.test(f) && !/\.env\.example$/.test(f) && !/env\.example$/.test(f)) problems.push(`${file}: ships ${f}`);
    if (/\.pem$|(?:^|\/)node_modules\//.test(f)) problems.push(`${file}: ships ${f}`);
  }
  for (const f of ["LICENSE", "NOTICE"]) if (!list.includes(f)) problems.push(`${file}: doesn't ship ${f} (Apache-2.0 section 4)`);
  const targets = [];
  const walk = (v) => (typeof v === "string" ? targets.push(v) : v && typeof v === "object" ? Object.values(v).forEach(walk) : undefined);
  walk(manifest.exports);
  walk(manifest.main);
  walk(manifest.types);
  walk(manifest.bin);
  for (const t of targets) if (!list.includes(t.replace(/^\.\//, ""))) problems.push(`${file}: package.json points at ${t}, which isn't in the tarball`);
  if (JSON.stringify(manifest.exports ?? {}).includes('"development"')) problems.push(`${file}: the published exports still carry the development (source) condition`);
  for (const [dep, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    if (String(range).startsWith("workspace:")) problems.push(`${file}: ${dep} is still ${range}`);
  }
  if (!manifest.publishConfig?.provenance || manifest.publishConfig?.access !== "public") problems.push(`${file}: publishConfig needs access: public and provenance: true`);
  packed.push({ name: manifest.name, version: manifest.version, file, kB: Math.round(statSync(join(out, file)).size / 1024) });
}

writeFileSync(join(out, "manifest.json"), `${JSON.stringify(packed, null, 2)}\n`);
for (const p of packed) process.stdout.write(`  ${p.name.padEnd(32)} ${p.version.padEnd(10)} ${String(p.kB).padStart(6)} kB  .packs/${p.file}\n`);
if (problems.length) {
  process.stderr.write(`\n${problems.join("\n")}\n\npack-all: ${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write(`pack-all: ${packed.length} tarballs in .packs (nothing published)\n`);
