/**
 * What a publishable Clip Wallet package.json looks like, in one place. Used by build-package.mjs (entries),
 * normalize-manifests.mjs (writes them), check-manifests.mjs (checks them) and pack-all.mjs.
 *
 * In the monorepo every export has a "development" condition pointing at the TypeScript source, so pnpm
 * typecheck/test/dev run from source without building (tsconfig customConditions, Vite/Vitest conditions).
 * publishConfig.exports replaces the map when pnpm packs: the tarball points at dist/ only.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const REPO = "https://github.com/ColdAI-org/clip-wallet";
export const NODE_ENGINE = ">=22";
export const LICENSE_ID = "Apache-2.0";

/**
 * The NOTICE every published package ships (Apache-2.0 section 4(d)): ColdAI's notice, the trademark note and,
 * for packages that carry third-party code, that code's licence text (`thirdParty`, from the vendored LICENSE files).
 * @param {string} name
 * @param {{ title: string, files: string, licence: string }[]} [thirdParty]
 */
export function noticeFor(name, thirdParty = []) {
  const lines = [
    `Clip Wallet: ${name}`,
    "Copyright 2026 ColdAI (https://coldai.org)",
    "",
    "This product includes software developed by ColdAI (https://coldai.org).",
    "Licensed under the Apache License, Version 2.0 (see LICENSE).",
    "",
    '"Clip Wallet", "1Mask" and the Clip Wallet logo are trademarks of ColdAI. The Apache',
    "License 2.0 grants no rights to use them (Section 6).",
  ];
  for (const t of thirdParty) {
    lines.push("", "-".repeat(78), "", `This package includes ${t.title} (${t.files}), under this licence:`, "", t.licence.trimEnd());
  }
  return `${lines.join("\n")}\n`;
}

/** packages/* that are published (everything that isn't private). */
export function publishablePackages(root) {
  const dir = join(root, "packages");
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "package.json")))
    .map((d) => {
      const path = join(dir, d.name);
      return { dir: `packages/${d.name}`, path, pkg: JSON.parse(readFileSync(join(path, "package.json"), "utf8")) };
    })
    .filter((p) => !p.pkg.private);
}

/** The source file behind an exports target: "./src/x.ts" or { development: "./src/x.ts", ... }. */
export function sourceOf(target) {
  if (typeof target === "string") return target.startsWith("./src/") ? target : undefined;
  if (target && typeof target === "object") return target.development;
  return undefined;
}

/** "./src/inpage/index.ts" -> "./dist/inpage/index" */
function distBase(src) {
  return src.replace(/^\.\/src\//, "./dist/").replace(/\.tsx?$/, "");
}

/** Source and published export targets for one subpath. */
export function exportTargets(src) {
  if (/\.tsx?$/.test(src)) {
    const base = distBase(src);
    return {
      dev: { development: src, types: `${base}.d.ts`, import: `${base}.js`, default: `${base}.js` },
      pub: { types: `${base}.d.ts`, import: `${base}.js`, default: `${base}.js` },
    };
  }
  const out = src.replace(/^\.\/src\//, "./dist/");
  return { dev: { development: src, default: out }, pub: out };
}

/** Packages that ship JavaScript as is (no build step). */
export const NO_BUILD = new Set(["create-clip-wallet"]);

const ORDER = [
  "name",
  "version",
  "description",
  "keywords",
  "license",
  "author",
  "homepage",
  "bugs",
  "repository",
  "type",
  "sideEffects",
  "bin",
  "main",
  "types",
  "exports",
  "files",
  "publishConfig",
  "engines",
  "scripts",
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "devDependencies",
];

export function ordered(pkg) {
  const out = {};
  for (const k of ORDER) if (k in pkg) out[k] = pkg[k];
  for (const k of Object.keys(pkg)) if (!(k in out)) out[k] = pkg[k];
  return out;
}

/** The manifest a publishable package should have (pure; `extra` holds descriptions and peers). */
export function normalize(pkg, dir, extra = {}) {
  const next = { ...pkg };
  next.description = extra.description ?? pkg.description;
  next.keywords = extra.keywords ?? pkg.keywords ?? ["clip-wallet", "wallet", "web3"];
  next.license = LICENSE_ID;
  next.author = "ColdAI (https://coldai.org)";
  next.homepage = `${REPO}/tree/main/${dir}#readme`;
  next.bugs = { url: `${REPO}/issues` };
  next.repository = { type: "git", url: `git+${REPO}.git`, directory: dir };
  next.type = "module";
  next.engines = { node: NODE_ENGINE };

  if (!NO_BUILD.has(pkg.name)) {
    const dev = {};
    const pub = {};
    for (const [sub, target] of Object.entries(pkg.exports ?? { ".": pkg.main })) {
      const src = sourceOf(target);
      if (!src) throw new Error(`${pkg.name}: exports["${sub}"] has no source path`);
      const t = exportTargets(src);
      dev[sub] = t.dev;
      pub[sub] = t.pub;
    }
    next.exports = dev;
    const root = pub["."];
    next.main = typeof root === "string" ? root : root?.import;
    next.types = typeof root === "string" ? undefined : root?.types;
    if (!next.types) delete next.types;
    next.files = ["dist", "README.md", "LICENSE", "NOTICE"];
    next.publishConfig = { access: "public", provenance: true, exports: pub };
    next.scripts = { build: "node ../../tools/release/build-package.mjs", ...pkg.scripts };
  } else {
    next.publishConfig = { access: "public", provenance: true };
  }
  if (extra.peerDependencies) next.peerDependencies = { ...pkg.peerDependencies, ...extra.peerDependencies };
  if (extra.peerDependenciesMeta) next.peerDependenciesMeta = { ...pkg.peerDependenciesMeta, ...extra.peerDependenciesMeta };
  return ordered(next);
}
