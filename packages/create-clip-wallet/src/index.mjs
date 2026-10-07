// create-clip-wallet: start your own wallet on the Clip Wallet kit, on every platform, from one clip.config.ts.
//
//   npx create-clip-wallet my-wallet                 a new project: extension, desktop and phone apps (and, with
//                                                    --scaffold-hbar, the Scaffold-HBAR dapp), with their own identity
//   create-clip-wallet identity [--name …]           (inside a project) set or change the wallet's identity
//   create-clip-wallet brand [--logo …]              (inside a project) render every platform's icons from the logo
//   create-clip-wallet listings                      (inside a project) regenerate docs/listings drafts
//   create-clip-wallet mainnet-check                 (inside a project) what still blocks a mainnet build
//
// `npx create-clip-wallet my-wallet --scaffold-hbar` produces the same project as
// `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` followed by
// `pnpm wallet:identity`: both copy the same template the same way, then run the same identity step. Without
// --scaffold-hbar (or with fewer --platforms) the parts that weren't chosen are removed afterwards.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { LANGUAGES, MAINNET_ACKNOWLEDGEMENT, WALLETCONNECT_ENV, isPlaceholderRdns, mainnetProblems, platformIds, validateConfig, walletKey } from "@clip-wallet/config";
import {
  CHECKLIST_FILE,
  CONFIG_FILE,
  DEFAULT_ACCENT,
  DEFAULT_NETWORKS,
  IDENTITY_FILE,
  KEY_FILE,
  accentOf,
  applyIdentity,
  checkIdentity,
  extensionIdFromKey,
  isProject,
  kitVersion,
  listOf,
  networksOf,
  parseNetworks,
  placeholderRdns,
  projectPlatforms,
  readIdentity,
  slugOf,
  titleFromDir,
} from "./identity.mjs";
import { PLATFORMS } from "./icons.mjs";
import { writeListings } from "./listings.mjs";
import { copyTemplate, gitInit, normalizeRootPackageJson, processTemplateManifest, selectParts, templateDir } from "./template.mjs";

export { applyIdentity, checkIdentity, extensionIdFromKey, isStarterSvg, parseNetworks, placeholderRdns, projectPlatforms, slugOf, titleFromDir } from "./identity.mjs";
export { iconPng, iconSvg } from "./icon.mjs";
export { decodePng, encodeIcns, encodeIco, encodePng, iconPlan, readIcns, readIco, renderIcons } from "./icons.mjs";
export { writeListings } from "./listings.mjs";
export { copyTemplate, normalizeRootPackageJson, processTemplateManifest, pruneScripts, selectParts, stripParts, templateDir } from "./template.mjs";
export { DEFAULT_ACCENT, DEFAULT_NETWORKS, PLATFORMS };

const PKG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"));
export const VERSION = PKG.version;
export const COMMANDS = ["identity", "brand", "listings", "mainnet-check"];

/** @param {string} dir */
function isEmptyDir(dir) {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/**
 * @typedef {{ command?: string, dir?: string, root?: string, name?: string, rdns?: string, id?: string, accent?: string,
 *   networks?: string[], languages?: string[], platforms?: string[], scaffoldHbar?: boolean, homepage?: string,
 *   description?: string, logo?: string, walletConnectProjectId?: string, git: boolean, newKey: boolean, yes: boolean,
 *   help: boolean, version: boolean }} Args
 */

/** "extension,desktop" -> ["extension", "desktop"], checked. @param {string} text */
export function parsePlatforms(text) {
  const list = [...new Set(parseNetworks(text.toLowerCase()))];
  const bad = list.filter((p) => !(/** @type {readonly string[]} */ (PLATFORMS)).includes(p));
  if (bad.length) throw new Error(`--platforms: ${bad.join(", ")} ${bad.length === 1 ? "isn't a platform" : "aren't platforms"}; use ${PLATFORMS.join(", ")}`);
  if (!list.length) throw new Error("--platforms: pick at least one of extension, desktop, mobile");
  return PLATFORMS.filter((p) => list.includes(p));
}

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
    else if (a === "--id" || a === "--app-id") out.id = val();
    else if (a === "--accent") out.accent = val();
    else if (a === "--networks") out.networks = parseNetworks(val());
    else if (a === "--languages") out.languages = parseNetworks(val());
    else if (a === "--platforms") out.platforms = parsePlatforms(val());
    else if (a === "--scaffold-hbar") out.scaffoldHbar = true;
    else if (a === "--no-scaffold-hbar") out.scaffoldHbar = false;
    else if (a === "--homepage") out.homepage = val();
    else if (a === "--description") out.description = val();
    else if (a === "--logo" || a === "--icon") out.logo = val();
    else if (a === "--walletconnect-project-id") out.walletConnectProjectId = val();
    else if (a === "--root") out.root = val();
    else if (a === "--mainnet") {
      throw new Error(
        `New wallets start on test networks. Mainnet is a later, deliberate step: complete ${CHECKLIST_FILE}, then set mainnet in clip.config.ts (create-clip-wallet mainnet-check tells you what is left).`,
      );
    } else if (a.startsWith("-")) throw new Error(`Unknown option ${a}. Run with --help.`);
    else if (!out.command && !out.dir && COMMANDS.includes(a)) out.command = a;
    else if (!out.dir) out.dir = a;
    else throw new Error(`Only one folder name, please (got ${out.dir} and ${a}).`);
  }
  return out;
}

export const HELP = `create-clip-wallet ${VERSION}: your own wallet on the Clip Wallet kit, on every platform (test networks by default)

  npx create-clip-wallet <folder> [options]       new project: browser extension, desktop app, phone app, one clip.config.ts
  create-clip-wallet identity [options]           in a project: set or change the identity (pnpm wallet:identity)
  create-clip-wallet brand [--logo …]             in a project: every platform's icons from the logo (pnpm wallet:brand)
  create-clip-wallet listings                     in a project: regenerate docs/listings (pnpm wallet:listings)
  create-clip-wallet mainnet-check                in a project: what still blocks a mainnet build (pnpm wallet:mainnet-check)

Options
  --platforms extension,desktop,mobile   which apps to make (default: all three)
  --scaffold-hbar                 also the Scaffold-HBAR demo dapp (Next.js, Hedera testnet, /debug page)
  --name "Acme Wallet"            the wallet's name on every platform (default: from the folder)
  --rdns com.acme.wallet          EIP-6963 id: a reverse domain you own (default: com.example.<name>, a placeholder)
  --id com.acme.wallet            desktop and phone app id (bundle id / package); default: the rdns
  --logo ./logo.png               your logo (.png, ideally 1024×1024, or .svg); every icon is rendered from it.
                                  Default: a starter mark in the accent colour
  --accent #0B7A3B                accent colour (white text on it needs 3:1 contrast); icon and splash background
  --networks "evm:*,hedera"       "evm:*", "evm:<chain id>", hedera, solana, bitcoin, sui, aptos, cardano, substrate,
                                  starknet, ton, near, stellar, tezos, algorand
  --languages en,de,ja            ${LANGUAGES.join(", ")} (default: all; the first is the fallback)
  --homepage https://acme.example your wallet's website
  --description "…"               one sentence for the stores (132 characters max)
  --walletconnect-project-id …    your WalletConnect Cloud project id (written to .env files, never committed)
  --new-key                       identity: replace the extension key (changes the extension id)
  --no-git                        don't git init
  --root <dir>                    project directory for identity/brand/listings/mainnet-check (default: here)
  -y, --yes                       accept defaults, no questions

Mainnet is never switched on here: see MAINNET.md in the project.`;

/**
 * Ask until the answer passes `check` (which returns a problem or undefined).
 * @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log
 * @param {string} q @param {string} def @param {(v: string) => string | undefined} check
 */
async function ask(rl, log, q, def, check) {
  for (;;) {
    const v = (await rl.question(`${q}${def ? ` (${def})` : ""}: `)).trim() || def;
    const problem = check(v);
    if (!problem) return v;
    log(`  ${problem}`);
  }
}

/** @param {unknown} fn @returns {string | undefined} */
function problemOf(fn) {
  try {
    /** @type {() => void} */ (fn)();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Collect identity answers from flags and prompts.
 * @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log
 * @param {{ name: string, rdns?: string, appId?: string, accent?: string, networks?: string[], languages?: string[], askAll: boolean }} defaults
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
  const appId =
    args.id ??
    (prompt && defaults.askAll
      ? await ask(rl, log, "App id for the desktop and phone apps", defaults.appId ?? rdns, (v) => pick("appId", { appId: v }))
      : defaults.appId);
  const accent = args.accent ?? (prompt ? await ask(rl, log, "Accent colour", defaults.accent ?? DEFAULT_ACCENT, (v) => pick("theme", { accent: v })) : defaults.accent);
  const logo =
    args.logo ??
    (prompt && defaults.askAll
      ? (await ask(rl, log, "Logo (.png or .svg; empty = a starter mark)", "", (v) => (v ? pick("logo", { icon: v }) : undefined))) || undefined
      : undefined);
  const networks =
    args.networks ??
    (prompt && defaults.askAll
      ? parseNetworks(await ask(rl, log, "Networks", (defaults.networks ?? DEFAULT_NETWORKS).join(", "), (v) => pick("networks", { networks: parseNetworks(v) })))
      : defaults.networks);
  const languages =
    args.languages ??
    (prompt && defaults.askAll
      ? parseNetworks(await ask(rl, log, "Languages", (defaults.languages ?? [...LANGUAGES]).join(", "), (v) => pick("languages", { languages: parseNetworks(v) })))
      : defaults.languages);
  return {
    name,
    rdns,
    ...(appId && appId !== rdns ? { appId } : {}),
    ...(accent ? { accent } : {}),
    ...(networks ? { networks } : {}),
    ...(languages ? { languages } : {}),
    ...(args.homepage ? { homepage: args.homepage } : {}),
    ...(args.description ? { description: args.description } : {}),
    ...(logo ? { icon: logo } : {}),
    ...(args.walletConnectProjectId ? { walletConnectProjectId: args.walletConnectProjectId } : {}),
    newKey: args.newKey,
  };
}

/** @param {ReturnType<typeof applyIdentity>} r @param {string} root */
function identitySummary(r, root) {
  const id = readIdentity(root) ?? {};
  const ids = platformIds(/** @type {never} */ ({ name: r.name, rdns: r.rdns, appId: id.appId, desktop: {}, mobile: {} }));
  const platforms = projectPlatforms(root);
  return [
    `  name          ${r.name}`,
    `  rdns          ${r.rdns}${isPlaceholderRdns(r.rdns) ? "   (placeholder: set one you own before you publish)" : ""}`,
    platforms.includes("extension") ? `  extension id  ${r.extensionId}` : "",
    platforms.includes("desktop") ? `  desktop id    ${ids.desktop.appId}` : "",
    platforms.includes("mobile") ? `  iOS / Android ${ids.ios.bundleIdentifier} / ${ids.android.package}` : "",
    platforms.length > 1 ? `  deep links    ${ids.scheme}://` : "",
    r.keyFile ? `  private key   ${join(root, KEY_FILE)}  (gitignored; back it up, never commit or share it)` : "",
    r.icons.length ? `  icons         ${r.icons.length} files for ${platforms.join(", ")} (pnpm wallet:brand re-renders them)` : "",
    `  listings      ${r.listings.length - 1} drafts in docs/listings/`,
    ...r.warnings.map((w) => `  note          ${w}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Next steps for the parts a project has. @param {string} dir @param {string} root @param {{ walletConnect: boolean }} o */
export function nextSteps(dir, root, o) {
  const platforms = projectPlatforms(root);
  const dapp = existsSync(join(root, "packages", "nextjs"));
  return [
    "Next steps:",
    `  cd ${dir}`,
    "  pnpm install",
    ...(platforms.includes("extension")
      ? [
          "",
          "  Browser extension (packages/extension)",
          "    pnpm dev:extension            # Chrome with the extension loaded, live reload",
          "    pnpm extension:build          # load packages/extension/.output/chrome-mv3 unpacked in chrome://extensions",
          "    pnpm extension:zip            # the store upload zip",
        ]
      : []),
    ...(platforms.includes("desktop")
      ? [
          "",
          "  Desktop app: macOS, Windows, Linux (packages/desktop)",
          "    pnpm dev:desktop              # run it with live reload",
          "    pnpm desktop:dist             # installers for this computer in packages/desktop/release (unsigned)",
          "    pnpm desktop:dist:mac         # also :win and :linux; signing: docs/signing.md",
        ]
      : []),
    ...(platforms.includes("mobile")
      ? [
          "",
          "  Phone app: iOS, Android (packages/mobile)",
          "    pnpm --filter mobile start    # Metro for a development build",
          "    pnpm mobile:prebuild          # generate ios/ and android/, then pnpm --filter mobile ios (or android)",
          "    pnpm mobile:export            # the JS bundles, no account needed; EAS: pnpm --filter mobile eas:build",
        ]
      : []),
    ...(dapp ? ["", "  Scaffold-HBAR dapp (packages/nextjs)", "    pnpm next:dev                 # connect, sign and send on Hedera testnet: http://localhost:3000"] : []),
    "",
    "  pnpm harness                    # must pass before every commit",
    o.walletConnect ? "" : `  set ${WALLETCONNECT_ENV} in .env (copy .env.example; never commit .env)`,
  ];
}

/** Create a project. @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log */
async function create(args, rl, log) {
  const dir = args.dir ?? (args.yes ? "my-wallet" : await ask(rl, log, "Folder", "my-wallet", (v) => (isEmptyDir(resolve(v)) ? undefined : "That folder isn't empty.")));
  const target = resolve(dir);
  if (!isEmptyDir(target)) throw new Error(`${dir} already exists and isn't empty. Pick a new folder name.`);
  const platforms =
    args.platforms ??
    (args.yes
      ? [...PLATFORMS]
      : parsePlatforms(
          await ask(rl, log, "Platforms (extension, desktop, mobile)", PLATFORMS.join(", "), (v) => problemOf(() => parsePlatforms(v))?.replace(/^--platforms: /, "")),
        ));
  const scaffoldHbar =
    args.scaffoldHbar ??
    (args.yes ? false : /^y(es)?$/i.test(await ask(rl, log, "Add the Scaffold-HBAR demo dapp? (y/N)", "n", (v) => (/^(y|yes|n|no)$/i.test(v) ? undefined : "Answer y or n."))));
  const answers = await answersFrom(args, rl, log, { name: titleFromDir(dir), accent: DEFAULT_ACCENT, networks: DEFAULT_NETWORKS, askAll: true });
  const problems = checkIdentity(answers);
  if (problems.length) throw new Error(`Can't create the wallet:\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  // The same steps, in the same order, as create-scaffold-hbar's copyTemplateFiles for this template; then the parts
  // that weren't chosen go.
  copyTemplate(templateDir(), target);
  selectParts(target, { platforms, scaffoldHbar });
  normalizeRootPackageJson(target);
  processTemplateManifest(target, basename(target));
  const r = applyIdentity(target, answers);
  const git = args.git && gitInit(target, `Initial commit with create-clip-wallet @ ${VERSION}`);
  log(
    [
      "",
      `Created ${r.name} in ${dir}: ${[...platforms, ...(scaffoldHbar ? ["Scaffold-HBAR dapp"] : [])].join(", ")}, all from ${CONFIG_FILE}.`,
      "",
      identitySummary(r, target),
      "",
      ...nextSteps(dir, target, { walletConnect: !!answers.walletConnectProjectId }),
      "",
      "Your wallet runs on test networks. Mainnet stays off until MAINNET.md is complete and clip.config.ts has",
      "mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }. Store accounts and code signing: docs/signing.md.",
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
  if (!isProject(r)) {
    throw new Error(`${r} isn't a Clip Wallet project (no ${CONFIG_FILE} and ${IDENTITY_FILE}): run this in the folder create-clip-wallet or create-scaffold-hbar made (or pass --root).`);
  }
  return r;
}

/** @param {Args} args @param {{ question(q: string): Promise<string> }} rl @param {(s: string) => void} log */
async function identity(args, rl, log) {
  const root = projectRoot(args.root);
  const current = readIdentity(root) ?? {};
  const accent = accentOf(root);
  const answers = await answersFrom(args, rl, log, {
    name: current.name && current.name !== "My Wallet" ? current.name : titleFromDir(root),
    rdns: current.rdns && !isPlaceholderRdns(current.rdns) ? current.rdns : undefined,
    appId: current.appId,
    ...(accent ? { accent } : {}),
    askAll: false,
  });
  // Keep the current accent unless one was asked for (a new accent also re-renders the icons).
  if (!args.accent && answers.accent === accent) delete answers.accent;
  const r = applyIdentity(root, answers);
  log([`Identity set for ${r.name}:`, identitySummary(r, root), "", "Run pnpm install (if you haven't), then pnpm harness and build the apps."].join("\n"));
  return 0;
}

/** Every platform's icons from the logo (and the accent). @param {Args} args @param {(s: string) => void} log */
function brand(args, log) {
  const root = projectRoot(args.root);
  const current = readIdentity(root) ?? {};
  const r = applyIdentity(root, {
    name: current.name,
    rdns: current.rdns,
    accent: args.accent ?? accentOf(root) ?? DEFAULT_ACCENT,
    ...(args.logo ? { icon: args.logo } : {}),
  });
  log([`Rendered ${r.icons.length} icon files for ${projectPlatforms(root).join(", ")}:`, ...r.icons.map((f) => `  ${f}`), ...r.warnings.map((w) => `note: ${w}`)].join("\n"));
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
 * MAINNET.md. @param {string} root
 */
export function mainnetCheck(root) {
  const id = readIdentity(root) ?? {};
  /** @type {Record<string, string | undefined>} */
  const env = {};
  const envFile = join(root, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*(CLIP_[A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (m) env[String(m[1])] = String(m[2]);
    }
  }
  Object.assign(env, process.env);
  const languages = listOf(root, "languages");
  const r = validateConfig({ ...id, networks: networksOf(root), ...(languages ? { languages } : {}) });
  const problems = r.ok ? mainnetProblems(r.config, env) : r.problems;
  // Comments stripped: clip.config.ts explains the mainnet object in a comment.
  const config = readFileSync(join(root, CONFIG_FILE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const enabled = /\bmainnet\s*:\s*\{/.test(config);
  if (!/\backnowledged\s*:\s*MAINNET_ACKNOWLEDGEMENT\b/.test(config) && !config.includes(MAINNET_ACKNOWLEDGEMENT)) {
    problems.push("clip.config.ts: mainnet needs { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT } once the checklist is done");
  }
  const checklist = join(root, CHECKLIST_FILE);
  if (!existsSync(checklist)) problems.push(`${CHECKLIST_FILE} is missing: restore it from the template`);
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
  if (args.command === "brand") return brand(args, log);
  if (args.command === "listings") return listings(args, log);
  if (args.command === "mainnet-check") return mainnet(args, log);
  const rl = io.question ? { question: io.question, close() {} } : createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (args.command === "identity") return await identity(args, rl, log);
    return await create(args, rl, log);
  } finally {
    rl.close();
  }
}
