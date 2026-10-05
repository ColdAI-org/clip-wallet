// Shared helpers for the kit's end-to-end scripts (tools/kit/e2e.mjs, tools/kit/scaffold-hbar-e2e.mjs). They run the
// published shape of everything: tarballs from `pnpm pack-all`, installed into throwaway projects. Nothing is
// published and nothing outside the temp directory is written (except .packs).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export const TEMPLATE = join(ROOT, "templates", "scaffold-hbar-clip-wallet");
export const PACKS = join(ROOT, ".packs");

let stepNo = 0;
export function step(title) {
  stepNo++;
  process.stdout.write(`\n\x1b[1m== ${stepNo}. ${title}\x1b[0m\n`);
}
export function ok(what) {
  process.stdout.write(`   ok  ${what}\n`);
}
export function fail(what) {
  throw new Error(what);
}
export function check(cond, what) {
  if (!cond) fail(what);
  ok(what);
}

/** Run a command, inheriting output. Throws on a non-zero exit unless allowFail. Returns the exit code. */
export function run(cmd, args, { cwd, env, allowFail = false, quiet = false } = {}) {
  process.stdout.write(`   $ ${[cmd, ...args].join(" ")}${cwd ? `   (in ${cwd})` : ""}\n`);
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (r.status !== 0 && !allowFail) {
    if (quiet) process.stdout.write(`${r.stdout}${r.stderr}`);
    fail(`${cmd} ${args.join(" ")} exited with ${r.status}`);
  }
  return { code: r.status ?? 1, out: quiet ? `${r.stdout}${r.stderr}` : "" };
}

export function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Build and pack everything (unless --no-pack and .packs exists). Returns [{ name, version, file }] with absolute paths. */
export function packs({ repack = true } = {}) {
  if (repack || !existsSync(join(PACKS, "manifest.json"))) run("node", [join(ROOT, "tools/release/pack-all.mjs")], { cwd: ROOT });
  return JSON.parse(readFileSync(join(PACKS, "manifest.json"), "utf8")).map((p) => ({ ...p, path: join(PACKS, p.file) }));
}

/**
 * Point a project's kit dependencies at the local tarballs instead of npm: pnpm overrides in pnpm-workspace.yaml
 * (they apply to transitive @clip-wallet/* dependencies too). The project's package.json pins stay untouched.
 */
export function useLocalPacks(projectDir, list) {
  const file = join(projectDir, "pnpm-workspace.yaml");
  const lines = list.map((p) => `  '${p.name}': file:${p.path}`);
  let text = readFileSync(file, "utf8");
  text = /^overrides:\s*$/m.test(text)
    ? text.replace(/^overrides:\s*$/m, `overrides:\n  # e2e: kit packages from ${PACKS}\n${lines.join("\n")}`)
    : `${text.trimEnd()}\n\noverrides:\n${lines.join("\n")}\n`;
  writeFileSync(file, text);
}

/** Install the packed create-clip-wallet into a scratch dir and return the path of its bin. */
export function installCli(dir, list) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "cli-under-test", private: true, dependencies: { "create-clip-wallet": `file:${list.find((p) => p.name === "create-clip-wallet").path}` } }, null, 2));
  writeFileSync(join(dir, "pnpm-workspace.yaml"), `overrides:\n${list.map((p) => `  '${p.name}': file:${p.path}`).join("\n")}\n`);
  run("pnpm", ["install", "--silent"], { cwd: dir });
  return join(dir, "node_modules", "create-clip-wallet", "bin", "create-clip-wallet.mjs");
}

export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir }).toString();
}

export function json(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
