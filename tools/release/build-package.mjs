#!/usr/bin/env node
/**
 * Build one publishable package into dist/: ESM JavaScript (tsup/esbuild) and .d.ts declarations (tsc), one entry
 * per subpath in package.json "exports". Run from the package directory (`pnpm build` in packages/<name>).
 *
 *   exports["./x"] = { development: "./src/x.ts", types: "./dist/x.d.ts", import: "./dist/x.js", default: "./dist/x.js" }
 *
 * Every bare import stays external: what a package uses at runtime must be in its dependencies or
 * peerDependencies (tools/release/check-manifests.mjs checks that). CSS exports are copied as they are.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { build } from "tsup";
import { sourceOf } from "./manifest.mjs";

const dir = process.cwd();
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
const exportsMap = pkg.exports ?? {};

const entry = {};
const copies = [];
for (const [sub, target] of Object.entries(exportsMap)) {
  const src = sourceOf(target);
  if (!src) throw new Error(`${pkg.name}: exports["${sub}"] has no development (source) path`);
  if (/\.tsx?$/.test(src)) entry[src.replace(/^\.\/src\//, "").replace(/\.tsx?$/, "")] = src;
  else copies.push(src);
}
if (!Object.keys(entry).length) throw new Error(`${pkg.name}: nothing to build (no TypeScript exports)`);

rmSync(join(dir, "dist"), { recursive: true, force: true });

await build({
  entry,
  outDir: "dist",
  format: ["esm"],
  target: "es2022",
  platform: "browser",
  splitting: true,
  sourcemap: false,
  dts: false,
  clean: false,
  silent: true,
  treeshake: false,
  // Never inline a dependency: bare specifiers (and node: built-ins) stay imports.
  external: [/^[^./]/],
  esbuildOptions(o) {
    o.jsx = "automatic";
    o.legalComments = "none";
  },
});

for (const src of copies) {
  const out = join(dir, "dist", relative("src", src.replace(/^\.\//, "")));
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(dir, src), out);
}

// Declarations: tsc over src only, beside the JavaScript.
const tsconfig = join(dir, "tsconfig.build.json");
writeFileSync(
  tsconfig,
  `${JSON.stringify(
    {
      extends: "./tsconfig.json",
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        declarationMap: false,
        sourceMap: false,
        rootDir: "src",
        outDir: "dist",
        allowJs: false,
        checkJs: false,
      },
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
    null,
    2,
  )}\n`,
);
try {
  const tsc = join(dirname(new URL(import.meta.url).pathname), "..", "..", "node_modules", ".bin", "tsc");
  execFileSync(existsSync(tsc) ? tsc : "tsc", ["-p", tsconfig], { cwd: dir, stdio: "inherit" });
} finally {
  rmSync(tsconfig, { force: true });
}
process.stdout.write(`${pkg.name}: built ${Object.keys(entry).length} entr${Object.keys(entry).length === 1 ? "y" : "ies"}\n`);
