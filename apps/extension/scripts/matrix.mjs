#!/usr/bin/env node
/**
 * The testnet dapp matrix (e2e/matrix.spec.ts, docs/r1/dapp-matrix.md), in one command:
 *
 *   pnpm --filter @clip-wallet/extension matrix [-- <playwright args, e.g. -g hedera>]
 *
 * Reads WALLETCONNECT_PROJECT_ID from the git-excluded .env.dapp-matrix (see e2e/matrix/env.ts) and, when it is set,
 * builds the wallet with CLIP_WALLETCONNECT_PROJECT_ID so the Hedera WalletConnect / HashConnect path can run. Then runs
 * the matrix. Never prints the env file's values.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "..");
const root = path.resolve(app, "../..");

function envFile() {
  const candidates = [process.env.DAPP_MATRIX_ENV_FILE, path.join(root, ".env.dapp-matrix")];
  const common = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  if (common.status === 0) candidates.push(path.join(path.dirname(common.stdout.trim()), ".env.dapp-matrix"));
  return candidates.find((f) => f && existsSync(f));
}

const file = envFile();
const values = {};
if (file) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
const wc = process.env.WALLETCONNECT_PROJECT_ID ?? values.WALLETCONNECT_PROJECT_ID;
const env = { ...process.env, NODE_OPTIONS: "--conditions=development", DAPP_MATRIX: "1" };
if (wc) env.CLIP_WALLETCONNECT_PROJECT_ID = wc;
process.stdout.write(`dapp matrix: env file ${file ? "found" : "not found"}; WalletConnect ${wc ? "on (project id set)" : "off (no WALLETCONNECT_PROJECT_ID)"}\n`);

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: app, env, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npx", ["wxt", "build"]);
run("npx", ["playwright", "test", "e2e/matrix.spec.ts", ...process.argv.slice(2)]);
