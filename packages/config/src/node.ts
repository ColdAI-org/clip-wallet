/**
 * Node-only helpers for build tools that need clip.config.ts outside a bundler: Expo's app.config.ts,
 * electron-builder's config file, create-clip-wallet. "@clip-wallet/config/node"; the main entry stays environment-free.
 *
 * @module
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ConfigError,
  WALLETCONNECT_ENV,
  defineConfig,
  isMainnetEnabled,
  mainnetProblems,
  validateConfig,
  type ClipConfig,
  type ClipConfigInput,
} from "@clip-wallet/config";

/** Node flags needed to import a .ts file: type stripping is on by default from Node 22.18 / 23.6. */
export function typeStrippingFlags(version: string = process.versions.node): string[] {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)) return [];
  if (major === 22 && minor >= 6) return ["--experimental-strip-types"];
  throw new Error(`Reading clip.config.ts needs Node 22.18 or newer (this is ${version}).`);
}

/** Is this Node process resolving workspace packages from source (--conditions=development, the Clip Wallet monorepo)? */
function devConditions(): boolean {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)];
  return flags.some((f, i) => /^(?:--conditions|-C)=development$/.test(f) || ((f === "--conditions" || f === "-C") && flags[i + 1] === "development"));
}

/**
 * Evaluate clip.config.ts (its default export, already run through defineConfig) in a child Node process and return
 * the validated config. Synchronous, so CommonJS config files (app.config.ts under Expo, electron-builder) can use it.
 * Problems come back as a ConfigError in plain words.
 */
export function loadClipConfigSync(file: string, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ClipConfig {
  const path = resolve(options.cwd ?? process.cwd(), file);
  if (!existsSync(path)) throw new ConfigError([`clip.config.ts isn't at ${path}`]);
  const code = `const m = await import(${JSON.stringify(pathToFileURL(path).href)}); process.stdout.write(JSON.stringify(m.default ?? null));`;
  const flags = [...typeStrippingFlags(), ...(devConditions() && !(process.env.NODE_OPTIONS ?? "").includes("development") ? ["--conditions=development"] : [])];
  let out: string;
  try {
    out = execFileSync(process.execPath, [...flags, "--no-warnings", "--input-type=module", "-e", code], {
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (e) {
    const stderr = String((e as { stderr?: string }).stderr ?? "");
    // defineConfig's ConfigError lists the problems one per line ("  - setting: problem").
    const problems = [...stderr.matchAll(/^ {2}- (.+)$/gm)].map((m) => String(m[1]));
    if (problems.length) throw new ConfigError(problems);
    throw new Error(`Couldn't read ${path}:\n${stderr.trim().split("\n").slice(0, 12).join("\n")}`);
  }
  const r = validateConfig(JSON.parse(out));
  if (!r.ok) throw new ConfigError(r.problems);
  return r.config;
}

/** CLIP_* lines from a .env file (KEY=value, # comments). Other keys are ignored; values are never logged. */
export function readClipEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(CLIP_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== "") out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/**
 * The build environment for a platform project: CLIP_* values from `.env` in each directory (earlier directories
 * win: the platform's own, then the wallet project's), with the process environment on top.
 */
export function buildEnv(dirs: readonly string[], env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const files = [...dirs].reverse().map((d) => readClipEnv(join(d, ".env")));
  return Object.assign({}, ...files, env);
}

/** Open boxes ("- [ ] …") in MAINNET.md in `dir` (the checklist next to clip.config.ts); none when there is no file. */
export function openChecklistItems(dir: string): string[] {
  const file = join(dir, "MAINNET.md");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*- \[ \] (.+)$/.exec(l)?.[1])
    .filter((x): x is string => !!x)
    .map((item) => `MAINNET.md: ${item.replace(/`/g, "")}`);
}

/**
 * Re-validate a config with the build environment applied (the WalletConnect project id from
 * CLIP_WALLETCONNECT_PROJECT_ID, or `fallbackWcEnv`) and enforce the mainnet checklist: a mainnet build is refused while
 * mainnetProblems() lists anything or MAINNET.md (in `checklistDir`) has an open box. Throws ConfigError in plain words.
 */
export function resolveBuildConfig(
  config: ClipConfig,
  env: Record<string, string | undefined>,
  options: { checklistDir?: string; fallbackWcEnv?: string } = {},
): ClipConfig {
  const projectId = config.walletConnect.projectId ?? (env[WALLETCONNECT_ENV] || (options.fallbackWcEnv ? env[options.fallbackWcEnv] : undefined) || undefined);
  const resolved = defineConfig({ ...(config as ClipConfigInput), walletConnect: projectId ? { projectId } : {} });
  if (isMainnetEnabled(resolved)) {
    const problems = [...mainnetProblems(resolved, env), ...(options.checklistDir ? openChecklistItems(options.checklistDir) : [])];
    if (problems.length) throw new ConfigError(problems.map((p) => `mainnet checklist: ${p}`));
  }
  return resolved;
}

/** data: URI for the icon clip.config names (svg or png, relative to `dir`, the folder clip.config.ts is in). */
export function iconDataUri(dir: string, icon: string): `data:image/${"svg+xml" | "png"};base64,${string}` {
  if (icon.startsWith("data:image/")) return icon as never;
  if (/^https?:\/\//.test(icon)) {
    throw new ConfigError([`icon: ship the icon with the wallet (./icon.svg or ./icon.png); ${icon} would be fetched from someone else's server`]);
  }
  const file = resolve(dir, icon);
  if (!existsSync(file)) throw new ConfigError([`icon: ${icon} isn't there; put the icon next to clip.config.ts`]);
  const type = extname(file).toLowerCase() === ".png" ? "png" : "svg+xml";
  return `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
}
