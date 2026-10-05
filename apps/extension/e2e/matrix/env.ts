/**
 * The dapp matrix's private settings, read from a git-excluded env file (`.gitignore` covers `.env.*`):
 *
 *   DAPP_MATRIX_MNEMONIC      the matrix's dedicated TESTNET-ONLY phrase (generated with the vault's own code)
 *   WALLETCONNECT_PROJECT_ID  Reown/WalletConnect Cloud project id (Hedera WalletConnect / HashConnect path)
 *
 * Looked up in DAPP_MATRIX_ENV_FILE, then `.env.dapp-matrix` in this checkout, then in the main checkout (worktrees
 * share it). Values are never printed, logged or put in an error message.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../../..");
const FILE = ".env.dapp-matrix";

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.DAPP_MATRIX_ENV_FILE) out.push(path.resolve(process.env.DAPP_MATRIX_ENV_FILE));
  out.push(path.join(ROOT, FILE));
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: ROOT, encoding: "utf8" }).trim();
    out.push(path.join(path.dirname(common), FILE));
  } catch {
    /* not a git checkout */
  }
  return out;
}

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
}

let cached: { file: string | null; values: Record<string, string> } | undefined;

function load() {
  if (cached) return cached;
  const file = candidates().find((f) => existsSync(f)) ?? null;
  cached = { file, values: file ? parse(readFileSync(file, "utf8")) : {} };
  return cached;
}

/** Where the env file was found (a path, never its contents). */
export const envFile = (): string | null => load().file;

/** The matrix phrase, or undefined. Callers type it into onboarding and drop it; never log it. */
export function matrixPhrase(): string | undefined {
  const v = process.env.DAPP_MATRIX_MNEMONIC ?? load().values.DAPP_MATRIX_MNEMONIC;
  return v && v.trim().split(/\s+/).length >= 12 ? v.trim() : undefined;
}

export function walletConnectProjectId(): string | undefined {
  const v = process.env.WALLETCONNECT_PROJECT_ID ?? load().values.WALLETCONNECT_PROJECT_ID;
  return v && /^[0-9a-f]{32}$/i.test(v.trim()) ? v.trim() : undefined;
}
