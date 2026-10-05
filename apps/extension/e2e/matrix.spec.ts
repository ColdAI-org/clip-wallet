/**
 * Testnet dapp matrix: the REAL build (real vault, real chain modules, real 1Mask) against each family's public
 * testnet, driven from a dapp page through that ecosystem's own discovery and dapp library. Four levels per family:
 *
 *   L1 connect   the dapp finds the wallet through the ecosystem's standard discovery and gets the matrix account
 *   L2 sign      sign a message; verified with the ecosystem's own verify function
 *   L3 send      sign and broadcast a self-transfer of the smallest amount; confirmed on the testnet's public RPC
 *   L4 approval  the approval window shows the decoded request (amount, recipient, network only where it matters)
 *
 * The wallet is the matrix's own testnet wallet (DAPP_MATRIX_MNEMONIC in the git-excluded .env.dapp-matrix, see
 * e2e/matrix/env.ts), imported through onboarding. Without it the whole matrix skips. L3 skips while the account
 * holds less than the minimum (e2e/matrix/chain.ts TARGETS); L4 always runs and declines in the wallet unless L3 is
 * approving the same request. Results go to e2e/shots/matrix/results.json and docs/r1/dapp-matrix.md.
 *
 *   pnpm --filter @clip-wallet/extension matrix [-- -g <target>]     build (WalletConnect on when the id is set) + run
 *   DAPP_MATRIX=1 pnpm --filter @clip-wallet/extension exec playwright test e2e/matrix.spec.ts   run against .output
 * The default e2e (`pnpm e2e`) leaves the matrix out: it needs public testnets and the matrix wallet.
 *
 * Never logs, traces or screenshots the phrase: trace/screenshot/video are off and onboarding is never captured.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BrowserContext, Page } from "@playwright/test";
import { extensionTest, expect, openPage, importWallet, REAL_BUILD } from "./fixtures";
import { matrixPhrase, walletConnectProjectId } from "./matrix/env";
import { verifyInNode } from "./matrix/verify";
import { TARGETS, addressOf, balanceOf, confirmTx, explorerTx, formatAmount, moduleAddress, publicKeyOf, type Target } from "./matrix/chain";

const here = path.dirname(fileURLToPath(import.meta.url));
// Under node_modules: build output of third-party dapp libraries stays out of the harness scan and git.
const OUT = path.join(here, "../node_modules/.cache/clip-matrix-dapps");
export const MATRIX_SHOTS = path.join(here, "shots/matrix");
const RESULTS = path.join(MATRIX_SHOTS, "results.json");
const ORIGIN = "https://matrix-dapp.example";
const EXT = process.env.MATRIX_EXTENSION ? path.resolve(process.env.MATRIX_EXTENSION) : REAL_BUILD;

const test = extensionTest(EXT);
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ mode: "default", timeout: 300_000 });

type Level = "connect" | "sign" | "send" | "approval";
type Outcome = { status: "pass" | "fail" | "skip" | "n/a"; why: string; detail?: unknown };
interface TargetResult {
  target: Target;
  network: string;
  dapp: string;
  dappWhy: string;
  levels: Partial<Record<Level, Outcome>>;
  shots: string[];
  at: string;
}

function saveResult(r: TargetResult) {
  mkdirSync(MATRIX_SHOTS, { recursive: true });
  const all: Record<string, TargetResult> = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, "utf8")) : {};
  all[r.target] = r;
  writeFileSync(RESULTS, `${JSON.stringify(all, null, 2)}\n`);
}

const DAPPS = readdirSync(path.join(here, "matrix/dapps"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""));

/** Node built-ins some dapp libraries import but never use in a browser: resolved to an empty module, as bundlers do. */
const NODE_BUILTINS = /^(?:node:)?(?:crypto|stream|fs|path|os|http|https|zlib|url|util|net|tls|child_process|worker_threads)$/;
const built = new Map<string, Promise<void>>();

/** Bundles one dapp page (its own esbuild run, so one broken dapp never takes the others down). */
function buildDapp(dapp: string): Promise<void> {
  let p = built.get(dapp);
  if (!p) {
    mkdirSync(OUT, { recursive: true });
    p = build({
      entryPoints: { [dapp]: path.join(here, `matrix/dapps/${dapp}.ts`) },
      bundle: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      outdir: OUT,
      logLevel: "silent",
      conditions: ["development", "browser"],
      define: {
        "process.env.NODE_ENV": '"production"',
        global: "globalThis",
        __MATRIX_WC_PROJECT_ID__: JSON.stringify(walletConnectProjectId() ?? ""),
        __MATRIX_PUBKEYS__: JSON.stringify(Object.fromEntries((Object.keys(TARGETS) as Target[]).map((t) => [t, publicKeyOf(t)]))),
      },
      inject: [path.join(here, "matrix/dapps/shims/node-globals.js")],
      plugins: [
        {
          name: "empty-node-builtins",
          setup(b) {
            b.onResolve({ filter: NODE_BUILTINS }, (a) => ({ path: a.path, namespace: "empty-builtin" }));
            b.onLoad({ filter: /.*/, namespace: "empty-builtin" }, () => ({ contents: "export default {};", loader: "js" }));
          },
        },
      ],
    }).then(() => undefined);
    built.set(dapp, p);
  }
  return p;
}

/** Serves a matrix dapp on an https origin (1Mask injects there); everything else (testnet RPCs) passes through. */
async function openDapp(context: BrowserContext, dapp: string): Promise<Page> {
  await buildDapp(dapp);
  const page = await context.newPage();
  // Context-wide, so the wallet's own fetches of this origin (TON Connect manifest, icons) are served too.
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = route.request().url().split("?")[0]!;
    if (url === `${ORIGIN}/`) return route.fulfill({ contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>${dapp} matrix dapp</title><h1>${dapp}</h1><script src="/${dapp}.js"></script>` });
    if (url === `${ORIGIN}/${dapp}.js`) return route.fulfill({ contentType: "text/javascript", body: readFileSync(path.join(OUT, `${dapp}.js`), "utf8") });
    if (url === `${ORIGIN}/tonconnect-manifest.json`) return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ url: ORIGIN, name: "Clip dapp matrix", iconUrl: `${ORIGIN}/icon.png` }) });
    // The dapp's own backend proxy for indexers that send no CORS headers (Koios), as production Cardano dapps have.
    if (url.startsWith(`${ORIGIN}/proxy/koios-preprod/`)) {
      const req = route.request();
      return fetch(`https://preprod.koios.rest/api/v1/${url.slice(`${ORIGIN}/proxy/koios-preprod/`.length)}`, { method: req.method(), headers: { "content-type": "application/json" }, body: req.postData() ?? undefined })
        .then(async (r) => route.fulfill({ status: r.status, contentType: "application/json", body: await r.text() }))
        .catch(() => route.fulfill({ status: 502, body: "" }));
    }
    if (url === `${ORIGIN}/icon.png`) return route.fulfill({ contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    return route.fulfill({ status: 404, body: "" });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => !!(window as unknown as { __matrix?: unknown }).__matrix, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error(`${dapp} dapp didn't start: ${errors.join(" | ") || "no page error"}`);
  });
  return page;
}

type RunResult = { ok: any } | { threw: { name: string; message: string; code: unknown } };
const run = (page: Page, step: string, arg?: unknown): Promise<RunResult> =>
  page.evaluate(
    async ([s, a]) => {
      try {
        return { ok: await (window as unknown as { __matrix: { run(s: string, a?: unknown): Promise<unknown> } }).__matrix.run(s, a) };
      } catch (e) {
        const err = e as { name?: string; message?: string; code?: unknown; error?: { code?: unknown; message?: string } };
        return { threw: { name: err?.name ?? "Error", message: String(err?.message ?? err?.error?.message ?? e).slice(0, 300), code: err?.code ?? err?.error?.code ?? null } };
      }
    },
    [step, arg] as const,
  );
const dappInfo = (page: Page) => page.evaluate(() => (window as unknown as { __matrix: { info: { dapp: string; why: string; sign?: string | null } } }).__matrix.info);

const approvalPages = (context: BrowserContext) => context.pages().filter((p) => !p.isClosed() && p.url().includes("/approval.html"));

/** Clicks `button` in the approval window that offers it (polls: the previous window may still be closing). */
async function answer(context: BrowserContext, button: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of approvalPages(context)) {
      try {
        const b = w.getByRole("button", { name: button, exact: true });
        if ((await b.count()) > 0 && (await b.isEnabled())) {
          await b.click({ timeout: 5_000 });
          return;
        }
      } catch {
        /* closed under us */
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No approval window offered "${button}"`);
}

interface ApprovalText {
  title: string;
  network: string;
  rows: string;
  details: string;
  notices: string[];
  approveEnabled: boolean;
  /** Rows whose value runs over its label or out of the card (a full address used to: unreadable recipient). */
  overflowing: string[];
}
type ApprovalRead = ApprovalText | { error: string };
const isApproval = (v: unknown): v is ApprovalText => typeof (v as ApprovalText | null)?.title === "string";

/** Waits for a transaction approval, opens Details, screenshots it and returns what it says. */
async function readApproval(context: BrowserContext, shot: string, timeoutMs = 90_000): Promise<ApprovalRead> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const w of approvalPages(context)) {
      try {
        const title = w.locator(".clip-approval__title");
        const actions = w.getByRole("button", { name: "Approve", exact: true });
        if ((await title.count()) > 0 && (await actions.count()) > 0) {
          await w.setViewportSize({ width: 360, height: 720 });
          const toggle = w.locator(".clip-approval__details-toggle");
          if ((await toggle.count()) > 0) await toggle.click();
          await w.waitForTimeout(300);
          await w.screenshot({ path: path.join(MATRIX_SHOTS, `${shot}.png`), fullPage: true });
          return {
            title: (await title.innerText()).trim(),
            network: (await w.locator(".clip-network-chip").innerText().catch(() => "")).trim(),
            rows: (await w.locator(".clip-rows").innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
            details: (await w.locator(".clip-approval__details").innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
            notices: (await w.locator(".clip-notice").allInnerTexts().catch(() => [])).map((s) => s.replace(/\s+/g, " ").trim()),
            approveEnabled: await actions.isEnabled(),
            overflowing: await w.locator(".clip-rows .clip-row").evaluateAll((rows) =>
              rows
                .filter((r) => {
                  const label = r.querySelector(".clip-row__label")?.getBoundingClientRect();
                  const value = r.querySelector(".clip-row__value")?.getBoundingClientRect();
                  const card = r.getBoundingClientRect();
                  return !!label && !!value && (value.left < label.right - 1 || value.right > card.right + 1 || value.left < card.left - 1);
                })
                .map((r) => (r.querySelector(".clip-row__label")?.textContent ?? "").trim()),
            ),
          };
        }
        const err = w.locator(".clip-error, [role=alert]");
        if ((await err.count()) > 0 && (await w.getByRole("button", { name: "Reject", exact: true }).count()) === 0) {
          return { error: (await err.first().innerText()).trim() };
        }
      } catch {
        /* closed under us */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { error: "no transaction approval window appeared" };
}

async function walletWithMatrixPhrase(context: BrowserContext, extensionId: string, phrase: string) {
  const page = await openPage(context, extensionId, "popup.html");
  await importWallet(page, phrase);
  return page;
}

/** Per target: what the dapp sends for L3/L4 and what the approval must say. */
interface Spec {
  /** Amount in display units the approval must show, and the asset symbol. */
  amount: string;
  symbol: string;
  /** Recipient the approval must show (defaults to the first 6 characters of the address). */
  recipient?: RegExp;
  /** Message signing isn't part of this ecosystem's dapp API. */
  noSign?: string;
}
const SPECS: Record<Target, Spec> = {
  evm: { amount: "0.000000000000000001", symbol: "ETH" },
  "hedera-evm": { amount: "0.00000001", symbol: "HBAR" },
  // Hedera refuses transfers to yourself, so this one pays the matrix's EVM-path account (alias 0x05AC…).
  hedera: { amount: "0.00000001", symbol: "HBAR", recipient: /0x05AC|0\.0\.\d+/i },
  solana: { amount: "0.000000001", symbol: "SOL" },
  bitcoin: { amount: "0.00000546", symbol: "BTC" },
  sui: { amount: "0.000000001", symbol: "SUI" },
  aptos: { amount: "0.00000001", symbol: "APT" },
  // Every output of a self-transfer comes back to you: the approval says "your own address" (no single recipient).
  cardano: { amount: "1", symbol: "ADA", recipient: /your own address/i },
  substrate: { amount: "0.000000000001", symbol: "WND" },
  starknet: { amount: "0.000000000000000001", symbol: "STRK" },
  ton: { amount: "0.000000001", symbol: "GRAM" },
  near: { amount: "0.000000000000000000000001", symbol: "NEAR" },
  stellar: { amount: "0.0000001", symbol: "XLM" },
  tezos: { amount: "0.000001", symbol: "XTZ" },
  algorand: { amount: "0.000001", symbol: "ALGO", noSign: "Algorand's dapp APIs (use-wallet v5, ARC-1) have no message signing; ARC-60 signData is a draft Clip doesn't offer." },
};

/** Hedera over WalletConnect answers with the 0.0.x account id: it must be the account behind our key's EVM alias. */
async function isHederaAccountOf(got: string, alias: string): Promise<boolean> {
  if (!/^0\.0\.\d+$/.test(got)) return false;
  const r = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${got}`).catch(() => null);
  const a = r?.ok ? ((await r.json()) as { evm_address?: string }) : null;
  return a?.evm_address?.toLowerCase() === alias.toLowerCase();
}

/** The WalletConnect path needs a project id in the env file AND a wallet built with it (pnpm … matrix does both). */
function walletConnectSkip(): string | null {
  const id = walletConnectProjectId();
  if (!id) return "WALLETCONNECT_PROJECT_ID is not set: add it to .env.dapp-matrix, then run `pnpm --filter @clip-wallet/extension matrix` (it builds the wallet with CLIP_WALLETCONNECT_PROJECT_ID).";
  const bundles = readdirSync(EXT, { recursive: true }).filter((f) => String(f).endsWith(".js"));
  const built = bundles.some((f) => readFileSync(path.join(EXT, String(f)), "utf8").includes(id));
  return built ? null : `This build (${EXT}) has WalletConnect off: rebuild with \`pnpm --filter @clip-wallet/extension matrix\` so CLIP_WALLETCONNECT_PROJECT_ID is set.`;
}

const PHRASE_MISSING = "No DAPP_MATRIX_MNEMONIC: create .env.dapp-matrix (see docs/r1/dapp-matrix.md).";

async function runTarget(target: Target, context: BrowserContext, extensionId: string) {
  const phrase = matrixPhrase();
  test.skip(!phrase, PHRASE_MISSING);
  if (target === "hedera") {
    const why = walletConnectSkip();
    if (why) {
      const skip: Outcome = { status: "skip", why };
      saveResult({ target, network: TARGETS[target].network.id, dapp: "@hashgraph/hedera-wallet-connect DAppConnector (HashConnect v3 path)", dappWhy: "needs a WalletConnect project id", levels: { connect: skip, sign: skip, approval: skip, send: skip }, shots: [], at: new Date().toISOString() });
    }
    test.skip(!!why, why ?? "");
  }
  const spec = SPECS[target];
  const net = TARGETS[target].network;
  const expected = addressOf(target);
  // The chain module derives the same address from the vault's public key (what the wallet shows on Receive).
  // EVM-style aliases compare case-insensitively (EIP-55 vs lowercase); Cardano's is the CIP-1852 base address.
  expect(moduleAddress(target)?.toLowerCase(), `${target}: chain module address`).toBe(expected.toLowerCase());

  await walletWithMatrixPhrase(context, extensionId, phrase!);
  const page = await openDapp(context, target);
  const info = await dappInfo(page);
  const result: TargetResult = { target, network: net.id, dapp: info.dapp, dappWhy: info.why, levels: {}, shots: [], at: new Date().toISOString() };
  const failures: string[] = [];
  const record = (level: Level, o: Outcome) => {
    result.levels[level] = o;
    if (o.status === "fail") failures.push(`${level}: ${o.why}`);
  };

  // L1 connect
  const connecting = run(page, "connect");
  await answer(context, "Connect").catch(() => undefined);
  const c = await connecting;
  if ("ok" in c && typeof c.ok?.address === "string") {
    const same = c.ok.address === expected || c.ok.address.toLowerCase() === expected.toLowerCase() || (await isHederaAccountOf(c.ok.address, expected));
    record("connect", same ? { status: "pass", why: `account ${c.ok.address}`, detail: c.ok } : { status: "fail", why: `got ${c.ok.address}, expected ${expected}`, detail: c.ok });
  } else record("connect", { status: "fail", why: "threw" in c ? `${c.threw.name}: ${c.threw.message}` : `unexpected ${JSON.stringify(c)}` });
  if (result.levels.connect?.status !== "pass") {
    record("sign", { status: "skip", why: "not connected" });
    record("approval", { status: "skip", why: "not connected" });
    record("send", { status: "skip", why: "not connected" });
    saveResult(result);
    expect(failures, failures.join("\n")).toEqual([]);
    return;
  }

  // L2 sign a message, verified by the ecosystem's own function
  if (spec.noSign) record("sign", { status: "n/a", why: spec.noSign });
  else {
    const signing = run(page, "sign");
    const shot = `${target}-sign`;
    const view = await readApproval(context, shot, 60_000);
    if (isApproval(view)) {
      result.shots.push(`${shot}.png`);
      await answer(context, "Approve");
    }
    const s = await signing;
    if ("ok" in s && s.ok?.verify) Object.assign(s.ok, verifyInNode(s.ok.verify));
    if ("ok" in s && s.ok?.valid === true) record("sign", { status: "pass", why: s.ok.how ?? "verified", detail: { ...s.ok, approval: view } });
    else record("sign", { status: "fail", why: "threw" in s ? `${s.threw.name}: ${s.threw.message}` : `not verified: ${JSON.stringify(s.ok)}`, detail: { approval: view } });
  }

  // Funded? L3 approves the same request L4 inspects; unfunded, L4 declines it.
  const bal = await balanceOf(target);
  const funded = bal.funded;
  const sending = run(page, "send", { amount: "min" });
  const shot = `${target}-approval`;
  // The dapp may fail before the wallet is asked (e.g. no UTXOs to build from): stop waiting for a window then.
  const early = sending.then((r) => ({ error: `the dapp stopped before the wallet: ${"threw" in r ? `${r.threw.name}: ${r.threw.message}` : JSON.stringify(r.ok)}`, early: r }) as const);
  const view = await Promise.race([readApproval(context, shot), early]);
  if ("early" in view && !funded && "threw" in view.early && view.early.threw.name === "NeedsFunds") {
    record("approval", { status: "skip", why: `needs funds first: ${view.early.threw.message}` });
  } else if (isApproval(view)) {
    result.shots.push(`${shot}.png`);
    const text = `${view.title} ${view.rows} ${view.details}`;
    const short = expected.slice(0, 6);
    const recipientShown = spec.recipient ? spec.recipient.test(text) : text.includes(short) || /yourself|your own|to you\b/i.test(text);
    const problems: string[] = [];
    if (!text.includes(spec.symbol)) problems.push(`no ${spec.symbol}`);
    // Amounts below the display precision show as "<0.000001 ETH" (the wallet's formatting); either form is right.
    if (!text.includes(spec.amount) && !new RegExp(`<0\\.0*1\\s*${spec.symbol}`).test(text)) problems.push(`amount ${spec.amount} not shown`);
    if (!recipientShown) problems.push(`recipient ${spec.recipient ?? `${short}…`} not shown`);
    if (view.overflowing.length) problems.push(`row values overflow their label: ${view.overflowing.join(", ")}`);
    const fundsReason = view.notices.find((n) => /enough|can't pay|no \S+ yet|isn't on \S+ yet|doesn't exist (?:on \S+ )?yet|receive some \S+ first/i.test(n));
    if (/unreadable|blind/i.test(view.title) && !funded && fundsReason) {
      // The wallet builds this transaction from the account's own coins/objects: without funds there's nothing to
      // decode, and the approval must say why instead of calling the request unreadable.
      record("approval", { status: "skip", why: `needs funds first; the approval says: "${fundsReason}"`, detail: view });
    } else {
      if (/unreadable|blind/i.test(view.title)) problems.push("blind signing");
      record("approval", problems.length ? { status: "fail", why: problems.join("; "), detail: view } : { status: "pass", why: view.title, detail: view });
    }
  } else record("approval", { status: "fail", why: "error" in view ? view.error : "no approval", detail: view });

  if (funded && isApproval(view) && view.approveEnabled) {
    await answer(context, "Approve");
    const r = await sending;
    if ("ok" in r && typeof r.ok?.id === "string") {
      const ok = await confirmTx(target, r.ok.id);
      record("send", ok ? { status: "pass", why: explorerTx(target, r.ok.id), detail: r.ok } : { status: "fail", why: `not confirmed: ${explorerTx(target, r.ok.id)}`, detail: r.ok });
    } else record("send", { status: "fail", why: "threw" in r ? `${r.threw.name}: ${r.threw.message}` : JSON.stringify(r) });
  } else {
    if (isApproval(view)) await answer(context, "Reject").catch(() => undefined);
    const r = await sending;
    const declined = "threw" in r ? `${r.threw.name}${r.threw.code !== null ? ` ${String(r.threw.code)}` : ""}` : JSON.stringify(r.ok);
    const why = funded
      ? `approval not usable: ${isApproval(view) ? view.notices.join(" ") || "Approve disabled" : "error" in view ? view.error : "no approval"}`
      : `needs ${formatAmount(bal.minimum, net.nativeAsset.decimals)} ${net.nativeAsset.symbol} on ${net.name} at ${bal.address}; has ${formatAmount(bal.amount, net.nativeAsset.decimals)}${bal.error ? ` (${bal.error})` : ""}`;
    record("send", { status: funded ? "fail" : "skip", why, detail: { declinedAs: declined } });
    if ("approval" in result.levels && result.levels.approval?.status === "pass") result.levels.approval.detail = { ...(result.levels.approval.detail as object), declinedAs: declined };
  }

  saveResult(result);
  expect(failures, failures.join("\n")).toEqual([]);
}

for (const target of Object.keys(SPECS) as Target[]) {
  if (!DAPPS.includes(target)) continue;
  test(`matrix: ${target}`, async ({ context, extensionId }) => {
    await runTarget(target, context, extensionId);
  });
}

/**
 * A real public dapp loaded by URL: MetaMask's test dapp (metamask.github.io/test-dapp, no sign-up, no captcha). It lists
 * EIP-6963 providers; we pick Clip Wallet and connect. Recorded as "evm-live".
 */
test("matrix: evm-live (MetaMask test dapp, by URL)", async ({ context, extensionId }) => {
  const phrase = matrixPhrase();
  test.skip(!phrase, PHRASE_MISSING);
  await walletWithMatrixPhrase(context, extensionId, phrase!);
  const result: TargetResult = {
    target: "evm-live" as Target,
    network: TARGETS.evm.network.id,
    dapp: "MetaMask test dapp, live: https://metamask.github.io/test-dapp/",
    dappWhy: "the public EVM test dapp; no account, no captcha, discovers wallets over EIP-6963",
    levels: {},
    shots: [],
    at: new Date().toISOString(),
  };
  const failures: string[] = [];
  const record = (level: Level, o: Outcome) => {
    result.levels[level] = o;
    if (o.status === "fail") failures.push(`${level}: ${o.why}`);
  };
  const page = await context.newPage();
  await page.goto("https://metamask.github.io/test-dapp/", { waitUntil: "domcontentloaded" });
  try {
    await page.getByRole("button", { name: "Use Clip Wallet" }).click({ timeout: 30_000 });
    await page.locator("#connectButton").click();
    await answer(context, "Connect");
    await expect(page.locator("#accounts")).toHaveText(addressOf("evm"), { ignoreCase: true, timeout: 30_000 });
    record("connect", { status: "pass", why: `EIP-6963 "Use Clip Wallet" → eth_requestAccounts → ${addressOf("evm")}` });
  } catch (e) {
    record("connect", { status: "fail", why: String((e as Error).message).split("\n")[0]! });
  }
  if (result.levels.connect?.status === "pass") {
    // The test dapp turns its actions on only when `provider.isMetaMask` is true (its isMetaMaskInstalled()). Clip
    // never claims to be MetaMask, so personal_sign / Send stay disabled there: those levels run on the wagmi page.
    const gated = await page.locator("#personalSign").isDisabled();
    const why = gated
      ? "the test dapp enables personal_sign/Send only for providers with isMetaMask (its isMetaMaskInstalled()); Clip doesn't impersonate MetaMask. Covered by the wagmi page (row evm)"
      : "test dapp actions are enabled: extend this test";
    record("sign", { status: gated ? "n/a" : "fail", why });
    record("approval", { status: gated ? "n/a" : "fail", why });
    record("send", { status: "n/a", why: "see sign" });
    await page.screenshot({ path: path.join(MATRIX_SHOTS, "evm-live-connected.png") });
    result.shots.push("evm-live-connected.png");
  }
  saveResult(result);
  expect(failures, failures.join("\n")).toEqual([]);
});
