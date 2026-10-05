#!/usr/bin/env node
/**
 * Store packages for the testnet build:
 *
 *   pnpm --filter @clip-wallet/extension package          (builds, then zips)
 *   node apps/extension/scripts/package.mjs --no-build    (zips existing .output/)
 *
 * Writes apps/extension/release/:
 *   clip-wallet-<version>-chrome.zip    Chrome Web Store and Microsoft Edge Add-ons (same MV3 package)
 *   clip-wallet-<version>-firefox.zip   addons.mozilla.org (MV3, background as an ES-module event page)
 *   clip-wallet-<version>-source.zip    AMO source-code submission: HEAD's tracked files + README-AMO.md at the root
 *   SHA256SUMS                          sha256sum format, for the release and the reproducible-build check
 *   TREE-DIGESTS                        content digest of each unpacked build (architecture-independent)
 *   BUILD-INFO                          version, commit, SOURCE_DATE_EPOCH, Node version and platform
 *
 * --no-build zips the existing .output/; --no-source skips the source zip (automatic outside a git checkout).
 *
 * Every zip is deterministic (scripts/zip.mjs); SOURCE_DATE_EPOCH defaults to the HEAD commit time. The build
 * must be the testnet build: the script refuses a manifest without "Test networks only" or with mainnet on.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { treeDigest, zipDirectory } from "./zip.mjs";

const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(APP, "../..");
const OUT = join(APP, "release");
const build = !process.argv.includes("--no-build");

const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
let inGit = true;
try {
  git("rev-parse", "--verify", "HEAD");
} catch {
  inGit = false; // e.g. building from the AMO source archive
}
const withSource = inGit && !process.argv.includes("--no-source");
if (!process.env.SOURCE_DATE_EPOCH) {
  if (!inGit) throw new Error("not a git checkout: set SOURCE_DATE_EPOCH (the release's BUILD-INFO has it)");
  process.env.SOURCE_DATE_EPOCH = git("log", "-1", "--format=%ct");
}
const { version } = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));

const TARGETS = [
  { name: "chrome", dir: ".output/chrome-mv3", args: ["build"] },
  { name: "firefox", dir: ".output/firefox-mv3", args: ["build", "-b", "firefox", "--mv3"] },
];

for (const t of TARGETS) {
  // The fixture build (CLIP_MOCKS=1) must never be packaged.
  if (build) execFileSync("pnpm", ["exec", "wxt", ...t.args], { cwd: APP, stdio: "inherit", env: { ...process.env, CLIP_MOCKS: "" } });
  const manifestPath = join(APP, t.dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`${t.dir} is missing: build first (drop --no-build)`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!/Test networks only/.test(manifest.description)) throw new Error(`${t.name}: not a testnet build (manifest description)`);
  if (manifest.version !== version) throw new Error(`${t.name}: manifest ${manifest.version} != package.json ${version}`);
}
const clipConfig = readFileSync(join(APP, "clip.config.ts"), "utf8");
if (!/const MAINNET = false;/.test(clipConfig)) throw new Error("clip.config.ts has mainnet switched on: this script only packages testnet builds");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const files = [];
const digests = [];
for (const t of TARGETS) {
  const file = `clip-wallet-${version}-${t.name}.zip`;
  writeFileSync(join(OUT, file), zipDirectory(join(APP, t.dir)));
  files.push(file);
  digests.push(`${treeDigest(join(APP, t.dir))}  ${t.name}`);
}

// AMO asks for the exact sources of a minified/bundled add-on. git archive is deterministic per commit; the
// reviewer README goes at the archive root.
if (withSource) {
  // Extract the commit's tree, add the reviewer README at the root, and zip with the same deterministic writer
  // (git archive --add-file would take that file's mode and mtime from the working tree).
  const source = `clip-wallet-${version}-source.zip`;
  const tmp = mkdtempSync(join(tmpdir(), "clip-source-"));
  const root = join(tmp, `clip-wallet-${version}`);
  mkdirSync(root);
  execFileSync("sh", ["-c", `git archive --format=tar HEAD | tar -x -C "${root}"`], { cwd: REPO });
  copyFileSync(join(APP, "store/README-AMO.md"), join(root, "README-AMO.md"));
  writeFileSync(join(OUT, source), zipDirectory(tmp));
  rmSync(tmp, { recursive: true, force: true });
  files.push(source);
}

const sums = files.map((f) => `${createHash("sha256").update(readFileSync(join(OUT, f))).digest("hex")}  ${f}`).join("\n") + "\n";
writeFileSync(join(OUT, "SHA256SUMS"), sums);
writeFileSync(join(OUT, "TREE-DIGESTS"), digests.join("\n") + "\n");
const commit = inGit ? git("rev-parse", "HEAD") : "unknown";
writeFileSync(join(OUT, "BUILD-INFO"), `version=${version}\ncommit=${commit}\nSOURCE_DATE_EPOCH=${process.env.SOURCE_DATE_EPOCH}\nnode=${process.version}\nplatform=${process.platform}-${process.arch}\n`);
process.stdout.write(`SOURCE_DATE_EPOCH=${process.env.SOURCE_DATE_EPOCH}\n${sums}tree digests:\n${digests.join("\n")}\n`);
