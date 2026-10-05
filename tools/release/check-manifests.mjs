#!/usr/bin/env node
/**
 * Publishable packages are what kit users install, so their manifests must be right:
 *   1. package.json is in the published shape (normalize-manifests.mjs --check);
 *   2. every bare import in src/ is a dependency or peer (the build keeps them external, so a missing one breaks
 *      installs outside the monorepo); type-only imports may come from devDependencies;
 *   3. with --dist: every published export target exists after `pnpm build`.
 *
 *   node tools/release/check-manifests.mjs [--dist]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findImports, lex, listFiles } from "../harness/check.mjs";
import { NO_BUILD, publishablePackages } from "./manifest.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const problems = [];

try {
  execFileSync(process.execPath, [join(root, "tools/release/normalize-manifests.mjs"), "--check"], { stdio: ["ignore", "ignore", "pipe"] });
} catch (e) {
  problems.push(String(e.stderr ?? e.message).trim());
}

const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const pkgName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

for (const { dir, path, pkg } of publishablePackages(root)) {
  const runtime = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const srcDirs = NO_BUILD.has(pkg.name) ? ["src", "bin"] : ["src"];
  for (const sd of srcDirs) {
    const base = join(path, sd);
    if (!existsSync(base)) continue;
    for (const rel of listFiles(base, { skipPaths: [] })) {
      if (!/\.(?:[cm]?[jt]sx?)$/.test(rel) || /\.test\.|\.d\.ts$/.test(rel)) continue;
      const src = readFileSync(join(base, rel), "utf8");
      for (const imp of findImports(src, lex(src))) {
        const spec = imp.module;
        if (spec.startsWith(".") || spec.startsWith("/") || builtins.has(spec) || builtins.has(spec.split("/")[0])) continue;
        // Build-time globals and virtual modules provided by the host bundler.
        if (spec.startsWith("virtual:") || spec.startsWith("wxt/") || spec === "wxt") {
          if (!runtime.has("wxt") && !spec.startsWith("virtual:")) problems.push(`${dir}/${sd}/${rel}: imports ${spec} but wxt isn't a peer dependency`);
          continue;
        }
        const name = pkgName(spec);
        if (name === pkg.name || runtime.has(name)) continue;
        if (imp.typeOnly && (dev.has(name) || dev.has(`@types/${name.replace(/^@/, "").replace("/", "__")}`))) continue;
        problems.push(`${dir}/${sd}/${rel}: imports "${spec}" but ${name} isn't in dependencies or peerDependencies`);
      }
    }
  }
  if (process.argv.includes("--dist") && !NO_BUILD.has(pkg.name)) {
    for (const [sub, target] of Object.entries(pkg.publishConfig?.exports ?? {})) {
      const files = typeof target === "string" ? [target] : Object.values(target);
      for (const f of new Set(files)) if (!existsSync(join(path, f))) problems.push(`${dir}: exports["${sub}"] -> ${f} is missing after the build`);
    }
  }
}

if (problems.length) {
  process.stderr.write(`${[...new Set(problems)].join("\n")}\n\ncheck-manifests: ${problems.length} problem(s)\n`);
  process.exit(1);
}
process.stdout.write("check-manifests: ok\n");
