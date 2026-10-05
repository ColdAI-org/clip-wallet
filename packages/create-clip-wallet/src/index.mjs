// create-clip-wallet: start your own wallet on the Clip Wallet kit.
//
//   npx create-clip-wallet my-wallet                 copy the Scaffold-HBAR Clip Wallet template and give it an identity
//   create-clip-wallet identity [--name …]           (inside a project) set or change the wallet's identity
//   create-clip-wallet listings                      (inside a project) regenerate docs/listings drafts
//   create-clip-wallet mainnet-check                 (inside a project) what still blocks a mainnet build
//
// `npx create-clip-wallet my-wallet` produces the same project as
// `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` followed by
// `pnpm wallet:identity`: both copy the same template the same way, then run the same identity step.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { MAINNET_ACKNOWLEDGEMENT, WALLETCONNECT_ENV, isPlaceholderRdns, mainnetProblems, validateConfig, walletKey } from "@clip-wallet/config";
import {
  DEFAULT_ACCENT,
  DEFAULT_NETWORKS,
  EXTENSION_DIR,
  KEY_FILE,
  applyIdentity,
  checkIdentity,
  extensionIdFromKey,
  kitVersion,
  networksOf,
  parseNetworks,
  placeholderRdns,
  readIdentity,
  slugOf,
  titleFromDir,
} from "./identity.mjs";
import { writeListings } from "./listings.mjs";
import { copyTemplate, gitInit, normalizeRootPackageJson, processTemplateManifest, templateDir } from "./template.mjs";

export { applyIdentity, checkIdentity, extensionIdFromKey, parseNetworks, placeholderRdns, slugOf, titleFromDir } from "./identity.mjs";
export { iconPng, iconSvg } from "./icon.mjs";
export { writeListings } from "./listings.mjs";
export { copyTemplate, normalizeRootPackageJson, processTemplateManifest, templateDir } from "./template.mjs";
export { DEFAULT_ACCENT, DEFAULT_NETWORKS };

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
export const VERSION = PKG.version;
export const COMMANDS = ["identity", "listings", "mainnet-check"];

/** @param {string} dir */
function isEmptyDir(dir) {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/**
 * @typedef {{ command?: string, dir?: string, root?: string, name?: string, rdns?: string, accent?: string, networks?: string[],
 *   homepage?: string, description?: string, icon?: string, walletConnectProjectId?: string, git: boolean, newKey: boolean,
 *   yes: boolean, help: boolean, version: boolean }} Args
 */

/** @param {string[]} argv @returns {Args} */
export function parseArgs(argv) {
  /** @type {Args} */
  const out = { git: true, newKey: false, yes: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const a = /** @type {string} */ (argv[i]);
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--version" || a === "-v") out.version = true;
    else if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--no-git") out.git = false;
    else if (a === "--new-key") out.newKey = true;
    else if (a === "--name") out.name = val();
    else if (a === "--rdns") out.rdns = val();
    else if (a === "--accent") out.accent = val();
    else if (a === "--networks") out.networks = parseNetworks(val());
    else if (a === "--homepage") out.homepage = val();
    else if (a === "--description") out.description = val();
    else if (a === "--icon") out.icon = val();
    else if (a === "--walletconnect-project-id") out.walletConnectProjectId = val();
    else if (a === "--root") out.root = val();
    else if (a === "--mainnet") {
      throw new Error(
        `New wallets start on test networks. Mainnet is a later, deliberate step: complete ${join(EXTENSION_DIR, "MAINNET.md")}, then set mainnet in clip.config.ts (create-clip-wallet mainnet-check tells you what is left).`,
      );
    } else if (a.startsWith("-")) throw new Error(`Unknown option ${a}. Run with --help.`);
    else if (!out.command && !out.dir && COMMANDS.includes(a)) out.command = a;
    else if (!out.dir) out.dir = a;
    else throw new Error(`Only one folder name, please (got ${out.dir} and ${a}).`);
  }
  return out;
}

export const HELP = `create-clip-wallet ${VERSION}: your own wallet on the Clip Wallet kit (test networks by default)

  npx create-clip-wallet <folder> [options]       new project: the Scaffold-HBAR Clip Wallet template, with its own identity
  create-clip-wallet identity [options]           in a project: set or change the identity (pnpm wallet:identity)
  create-clip-wallet listings                     in a project: regenerate docs/listings (pnpm wallet:listings)
  create-clip-wallet mainnet-check                in a project: what still blocks a mainnet build (pnpm wallet:mainnet-check)

Options
  --name "Acme Wallet"            the wallet's name (default: from the folder)
  --rdns com.acme.wallet          EIP-6963 id: a reverse domain you own (default: com.example.<name>, a placeholder)
  --accent #0B7A3B                accent colour (white text on it needs 3:1 contrast)
  --networks "evm:*,hedera"       "evm:*", "evm:<chain id>", hedera, solana, bitcoin, sui, aptos, cardano, substrate,
                                  starknet, ton, near, stellar, tezos, algorand
  --homepage https://acme.example your wallet's website
  --description "…"               one sentence for the stores (132 characters max)
  --icon ./logo.svg               your icon (.svg or .png); default: a starter mark in the accent colour
  --walletconnect-project-id …    your WalletConnect Cloud project id (written to .env files, never committed)
  --new-key                       identity: replace the extension key (changes the extension id)
  --no-git                        don't git init
  --root <dir>                    project directory for identity/listings/mainnet-check (default: here)
  -y, --yes                       accept defaults, no questions

Mainnet is never switched on here: see packages/extension/MAINNET.md in the project.`;

/**
 * Ask until the answer passes `check` (which returns a problem or undefined).
 * @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log
 * @param {string} q @param {string} def @param {(v: string) => string | undefined} check
 */
async function ask(rl, log, q, def, check) {
  for (;;) {
    const v = (await rl.question(`${q} (${def}): `)).trim() || def;
    const problem = check(v);
    if (!problem) return v;
    log(`  ${problem}`);
  }
}

/**
 * Collect identity answers from flags and prompts.
 * @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log
 * @param {{ name: string, rdns?: string, accent?: string, networks?: string[], askNetworks: boolean }} defaults
 */
async function answersFrom(args, rl, log, defaults) {
  /** @param {string} field @param {Record<string, unknown>} partial */
  const pick = (field, partial) => {
    const probe = { name: "Acme Wallet", rdns: "com.acme.wallet", ...partial };
    return checkIdentity(/** @type {never} */ (probe))
      .find((p) => p.startsWith(field))
      ?.replace(/^[^:]*: /, "");
  };
  const prompt = !args.yes;
  const name = args.name ?? (prompt ? await ask(rl, log, "Wallet name", defaults.name, (v) => pick("name", { name: v })) : defaults.name);
  const defRdns = defaults.rdns ?? placeholderRdns(slugOf(name));
  const rdns = args.rdns ?? (prompt ? await ask(rl, log, "Reverse domain you own (EIP-6963 rdns)", defRdns, (v) => pick("rdns", { rdns: v })) : defRdns);
  const accent = args.accent ?? (prompt ? await ask(rl, log, "Accent colour", defaults.accent ?? DEFAULT_ACCENT, (v) => pick("theme", { accent: v })) : defaults.accent);
  const networks =
    args.networks ??
    (prompt && defaults.askNetworks
      ? parseNetworks(await ask(rl, log, "Networks", (defaults.networks ?? DEFAULT_NETWORKS).join(", "), (v) => pick("networks", { networks: parseNetworks(v) })))
      : defaults.networks);
  return {
    name,
    rdns,
    ...(accent ? { accent } : {}),
    ...(networks ? { networks } : {}),
    ...(args.homepage ? { homepage: args.homepage } : {}),
    ...(args.description ? { description: args.description } : {}),
    ...(args.icon ? { icon: args.icon } : {}),
    ...(args.walletConnectProjectId ? { walletConnectProjectId: args.walletConnectProjectId } : {}),
    newKey: args.newKey,
  };
}

/** @param {ReturnType<typeof applyIdentity>} r @param {string} root */
function identitySummary(r, root) {
  return [
    `  name          ${r.name}`,
    `  rdns          ${r.rdns}${isPlaceholderRdns(r.rdns) ? "   (placeholder: set one you own before you publish)" : ""}`,
    `  extension id  ${r.extensionId}`,
    r.keyFile ? `  private key   ${join(root, KEY_FILE)}  (gitignored; back it up, never commit or share it)` : "",
    `  listings      ${r.listings.length - 1} drafts in docs/listings/`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Create a project. @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log */
async function create(args, rl, log) {
  const dir = args.dir ?? (args.yes ? "my-wallet" : await ask(rl, log, "Folder", "my-wallet", (v) => (isEmptyDir(resolve(v)) ? undefined : "That folder isn't empty.")));
  const target = resolve(dir);
  if (!isEmptyDir(target)) throw new Error(`${dir} already exists and isn't empty. Pick a new folder name.`);
  const answers = await answersFrom(args, rl, log, { name: titleFromDir(dir), accent: DEFAULT_ACCENT, networks: DEFAULT_NETWORKS, askNetworks: true });
  const problems = checkIdentity(answers);
  if (problems.length) throw new Error(`Can't create the wallet:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  // The same steps, in the same order, as create-scaffold-hbar's copyTemplateFiles for this template.
  copyTemplate(templateDir(), target);
  normalizeRootPackageJson(target);
  processTemplateManifest(target, basename(target));
  const r = applyIdentity(target, answers);
  const git = args.git && gitInit(target, `Initial commit with create-clip-wallet @ ${VERSION}`);
  log(
    [
      "",
      `Created ${r.name} in ${dir}.`,
      "",
      identitySummary(r, target),
      "",
      "Next steps:",
      `  cd ${dir}`,
      "  pnpm install",
      "  pnpm extension:build          # load packages/extension/.output/chrome-mv3 unpacked in Chrome",
      "  pnpm next:dev                 # the demo dapp and Scaffold-HBAR debug page: http://localhost:3000",
      "  pnpm harness                  # must pass before every commit",
      answers.walletConnectProjectId ? "" : `  set ${WALLETCONNECT_ENV} in packages/extension/.env (copy .env.example; never commit .env)`,
      "",
      "Your wallet runs on test networks. Mainnet stays off until packages/extension/MAINNET.md is complete and",
      "clip.config.ts has mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }.",
      git ? "" : "(git isn't set up here: run git init yourself.)",
    ]
      .filter((l, i, a) => l !== "" || a[i - 1] !== "")
      .join("\n"),
  );
  return 0;
}

/** @param {string} [root] */
function projectRoot(root) {
  const r = resolve(root ?? ".");
  if (!existsSync(join(r, EXTENSION_DIR, "clip.config.ts"))) {
    throw new Error(`${r} isn't a Clip Wallet project: run this in the folder create-clip-wallet or create-scaffold-hbar made (or pass --root).`);
  }
  return r;
}

/** @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log */
async function identity(args, rl, log) {
  const root = projectRoot(args.root);
  const current = readIdentity(root) ?? {};
  const accent = /accent:\s*"(#[0-9a-fA-F]{3,6})"/.exec(readFileSync(join(root, EXTENSION_DIR, "clip.config.ts"), "utf8"))?.[1];
  const answers = await answersFrom(args, rl, log, {
    name: current.name && current.name !== "My Wallet" ? current.name : titleFromDir(root),
    rdns: current.rdns && !isPlaceholderRdns(current.rdns) ? current.rdns : undefined,
    ...(accent ? { accent } : {}),
    askNetworks: false,
  });
  // Keep the current accent unless one was asked for (a new accent also redraws the starter icon).
  if (!args.accent && answers.accent === accent) delete answers.accent;
  const r = applyIdentity(root, answers);
  log([`Identity set for ${r.name}:`, identitySummary(r, root), "", "Run pnpm install (if you haven't), then pnpm extension:build and pnpm harness."].join("\n"));
  return 0;
}

/** @param {Args} args @param {(s: string) => void} log */
function listings(args, log) {
  const root = projectRoot(args.root);
  const id = readIdentity(root);
  if (!id?.extension?.key) throw new Error("This wallet has no identity yet: run pnpm wallet:identity first.");
  const files = writeListings(root, {
    name: id.name,
    description: id.description,
    rdns: id.rdns,
    homepage: id.homepage,
    extensionId: extensionIdFromKey(id.extension.key),
    key: walletKey(id),
    slug: slugOf(id.name),
    networks: networksOf(root),
    version: kitVersion(root),
  });
  log(`Wrote ${files.length} files:\n${files.map((f) => `  ${f}`).join("\n")}`);
  return 0;
}

/**
 * What still blocks a mainnet build: the clip.config checks (mainnetProblems), the acknowledgement, and every box in
 * packages/extension/MAINNET.md. @param {string} root
 */
export function mainnetCheck(root) {
  const id = readIdentity(root) ?? {};
  /** @type {Record<string, string | undefined>} */
  const env = {};
  const envFile = join(root, EXTENSION_DIR, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*(CLIP_[A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (m) env[String(m[1])] = String(m[2]);
    }
  }
  Object.assign(env, process.env);
  const r = validateConfig({ ...id, networks: networksOf(root) });
  const problems = r.ok ? mainnetProblems(r.config, env) : r.problems;
  // Comments stripped: clip.config.ts explains the mainnet object in a comment.
  const config = readFileSync(join(root, EXTENSION_DIR, "clip.config.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const enabled = /\bmainnet\s*:\s*\{/.test(config);
  if (!/\backnowledged\s*:\s*MAINNET_ACKNOWLEDGEMENT\b/.test(config) && !config.includes(MAINNET_ACKNOWLEDGEMENT)) {
    problems.push("clip.config.ts: mainnet needs { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT } once the checklist is done");
  }
  const checklist = join(root, EXTENSION_DIR, "MAINNET.md");
  if (!existsSync(checklist)) problems.push(`${join(EXTENSION_DIR, "MAINNET.md")} is missing: restore it from the template`);
  else {
    for (const line of readFileSync(checklist, "utf8").split(/\r?\n/)) {
      const m = /^\s*- \[ \] (.+)$/.exec(line);
      if (m) problems.push(`MAINNET.md: ${m[1]}`);
    }
  }
  return { enabled, problems };
}

/** @param {Args} args @param {(s: string) => void} log */
function mainnet(args, log) {
  const root = projectRoot(args.root);
  const { enabled, problems } = mainnetCheck(root);
  if (!problems.length) {
    log(`Mainnet checklist complete${enabled ? " and mainnet is on" : ": you can now turn mainnet on in clip.config.ts"}.`);
    return 0;
  }
  log([`Mainnet is ${enabled ? "ON but not ready" : "off"}. Still to do (${problems.length}):`, ...problems.map((p) => `  - ${p}`)].join("\n"));
  return enabled ? 1 : 2;
}

/**
 * Run the CLI. `io` is injectable for tests. Exit codes: 0 ok; 1 error or mainnet on but not ready; 2 mainnet-check
 * found work left (mainnet off).
 * @param {string[]} argv
 * @param {{ question?: (q: string) => Promise<string>, log?: (s: string) => void }} [io]
 */
export async function main(argv, io = {}) {
  const log = io.log ?? ((s) => process.stdout.write(`${s}\n`));
  const args = parseArgs(argv);
  if (args.help) {
    log(HELP);
    return 0;
  }
  if (args.version) {
    log(VERSION);
    return 0;
  }
  const rl = io.question ? { question: io.question, close() {} } : createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (args.command === "identity") return await identity(args, rl, log);
    if (args.command === "listings") return listings(args, log);
    if (args.command === "mainnet-check") return mainnet(args, log);
    return await create(args, rl, log);
  } finally {
    rl.close();
  }
}
