#!/usr/bin/env node
/**
 * pnpm kit:e2e: a kit-built wallet from the published shape, end to end, in a temp directory.
 *
 *  1. pnpm pack-all (build, manifest checks, tarballs in .packs; nothing published)
 *  2. install the packed create-clip-wallet and run it: `create-clip-wallet acme-wallet --name … --rdns … --yes`
 *  3. the project has its own identity: wallet.identity.json, extension key (0600, gitignored, untracked), icons,
 *     page titles, WalletConnect id in .env only, listing drafts for every enabled registry
 *  4. point the project's kit dependencies at the tarballs (pnpm overrides), `pnpm install`
 *  5. `pnpm build` in packages/extension succeeds; the manifest carries the name, key and icons
 *  6. `pnpm harness`, `pnpm check-types` and `pnpm wallet:listings` pass inside the project
 *  7. Chromium loads the built extension: its id is the one the key fixes, and a page sees it announce itself over
 *     EIP-6963 with the new name and rdns (and nothing announces Clip Wallet)
 *  8. the mainnet checklist is enforced: mainnet on → the harness, the build and wallet:mainnet-check all refuse
 *  9. the security floor: `openLists: false` anywhere fails the harness
 * 10. with --dapp: the Scaffold-HBAR dapp builds too
 *
 *   node tools/kit/e2e.mjs [--no-pack] [--dapp] [--keep]
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, check, git, installCli, json, ok, packs, run, step, tempDir, useLocalPacks } from "./lib.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const work = tempDir("clip-kit-e2e-");
const WC = "0123456789abcdef0123456789abcdef";
const NAME = "Acme Wallet";
const RDNS = "com.acme.wallet";
const NETWORKS = "evm:*,hedera,solana,bitcoin,ton,near,stellar,tezos,algorand";

try {
  step("Pack every publishable package");
  const list = packs({ repack: !args.includes("--no-pack") });
  check(list.length >= 32 && list.some((p) => p.name === "@clip-wallet/extension-kit") && list.some((p) => p.name === "create-clip-wallet"), `${list.length} tarballs in .packs`);

  step("create-clip-wallet from its tarball");
  const cli = installCli(join(work, "cli-install"), list);
  const tarballFiles = run("tar", ["-tzf", list.find((p) => p.name === "create-clip-wallet").path], { quiet: true }).out;
  check(/package\/template\/template\.json/.test(tarballFiles) && /package\/template\/_gitignore/.test(tarballFiles), "the tarball bundles the template (dotfiles as _gitignore)");
  run(process.execPath, [cli, "acme-wallet", "--name", NAME, "--rdns", RDNS, "--accent", "#0B7A3B", "--networks", NETWORKS, "--homepage", "https://wallet.acme.example", "--walletconnect-project-id", WC, "--yes"], { cwd: work });
  const app = join(work, "acme-wallet");
  const ext = join(app, "packages", "extension");

  step("The wallet has its own identity");
  const id = json(join(ext, "wallet.identity.json"));
  check(id.name === NAME && id.rdns === RDNS && id.homepage === "https://wallet.acme.example", "wallet.identity.json: name, rdns, homepage");
  check(/^[A-Za-z0-9+/=]{300,}$/.test(id.extension?.key ?? ""), "extension.key is a public key (base64 SPKI)");
  const { extensionIdFromKey } = await import(join(app, "..", "cli-install", "node_modules", "create-clip-wallet", "src", "identity.mjs"));
  const extId = extensionIdFromKey(id.extension.key);
  const pem = join(ext, ".keys", "extension.pem");
  check(existsSync(pem) && (statSync(pem).mode & 0o077) === 0, "private key in packages/extension/.keys/extension.pem, mode 0600");
  check(!git(app, "ls-files").split("\n").some((f) => /\.pem$|\.keys\/|(^|\/)\.env(\.local)?$/.test(f)), "no key or .env file is tracked by git");
  check(readFileSync(join(ext, ".env"), "utf8").includes(`CLIP_WALLETCONNECT_PROJECT_ID=${WC}`), "WalletConnect project id in packages/extension/.env");
  check(!readFileSync(join(ext, "clip.config.ts"), "utf8").includes(WC), "…and not in clip.config.ts");
  check(readFileSync(join(ext, "src/entrypoints/popup/index.html"), "utf8").includes(`<title>${NAME}</title>`), "page titles use the name");
  const listings = readdirSync(join(app, "docs", "listings")).sort();
  check(
    JSON.stringify(listings) === JSON.stringify(["README.md", "beacon.md", "eip-6963.md", "near.md", "stellar-wallets-kit.md", "ton-connect.md", "use-wallet.md", "walletconnect-explorer.md"]),
    `listing drafts: ${listings.join(", ")}`,
  );
  const tc = readFileSync(join(app, "docs/listings/ton-connect.md"), "utf8");
  check(tc.includes('"app_name": "acmewallet"') && tc.includes('"key": "acmewallet"'), "TON Connect entry uses the wallet key");
  check(readFileSync(join(app, "docs/listings/beacon.md"), "utf8").includes(`id: '${extId}'`), "Beacon entry uses the extension id");
  check(readFileSync(join(app, "docs/listings/walletconnect-explorer.md"), "utf8").includes(`"injected_id": "${RDNS}"`), "WalletConnect Explorer entry uses the rdns");

  step("Install from the tarballs");
  useLocalPacks(app, list);
  run("pnpm", ["install"], { cwd: app });

  step("pnpm build (the extension)");
  run("pnpm", ["build"], { cwd: ext });
  const out = join(ext, ".output", "chrome-mv3");
  const manifest = json(join(out, "manifest.json"));
  check(manifest.name === NAME && manifest.action?.default_title === NAME, "manifest name and action title");
  check(manifest.key === id.extension.key, "manifest key = wallet.identity.json extension.key");
  check(["16", "32", "48", "128"].every((s) => existsSync(join(out, manifest.icons[s]))), "manifest icons exist");
  check(manifest.description.endsWith("Test networks only."), "testnet build says so");

  step("pnpm harness, check-types and wallet:listings inside the project");
  const harness = run("pnpm", ["harness"], { cwd: app, quiet: true });
  check(/harness: ok/.test(harness.out), "pnpm harness passes");
  run("pnpm", ["extension:check-types"], { cwd: app });
  ok("extension types");
  run("pnpm", ["wallet:listings"], { cwd: app });
  check(git(app, "status", "--porcelain", "docs/listings").trim() === "", "wallet:listings regenerates the same drafts");

  step("Chromium loads it: own extension id, own EIP-6963 announcement");
  const { chromium } = createRequire(join(ROOT, "apps", "extension", "package.json"))("@playwright/test");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>dapp</title><body>dapp</body>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker");
    check(new URL(sw.url()).host === extId, `extension id ${extId} (fixed by the key)`);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`);
    const announced = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const seen = [];
          window.addEventListener("eip6963:announceProvider", (e) => seen.push(e.detail.info));
          window.dispatchEvent(new Event("eip6963:requestProvider"));
          setTimeout(() => resolve(seen), 1500);
        }),
    );
    check(announced.length === 1 && announced[0].name === NAME && announced[0].rdns === RDNS, `EIP-6963 announcement: ${JSON.stringify(announced.map((a) => ({ name: a.name, rdns: a.rdns })))}`);
    check(/^data:image\/svg\+xml;base64,/.test(announced[0].icon), "announced icon is the wallet's SVG");
    check(!announced.some((a) => a.rdns === "org.coldai.clipwallet"), "nothing announces Clip Wallet");
    const globals = await page.evaluate(() => ({ key: typeof window.acmewallet?.near, clip: typeof window.clipwallet }));
    check(globals.key === "object" && globals.clip === "undefined", "NEAR/Stellar/Algorand providers hang off window.acmewallet, not window.clipwallet");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    check((await popup.title()) === NAME, "the popup is titled with the wallet's name");
  } finally {
    await context.close();
    server.close();
  }

  step("The mainnet checklist is enforced");
  const cfgPath = join(ext, "clip.config.ts");
  const cfg = readFileSync(cfgPath, "utf8");
  writeFileSync(
    cfgPath,
    cfg
      .replace('import { defineConfig } from "@clip-wallet/config";', 'import { MAINNET_ACKNOWLEDGEMENT, defineConfig } from "@clip-wallet/config";')
      .replace(/^ {2}mainnet: false,$/m, "  mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },"),
  );
  const h = run("pnpm", ["harness"], { cwd: app, allowFail: true, quiet: true });
  check(h.code !== 0 && /kit-mainnet/.test(h.out), "pnpm harness refuses mainnet with open MAINNET.md boxes");
  const b = run("pnpm", ["build"], { cwd: ext, allowFail: true, quiet: true });
  check(b.code !== 0 && /mainnet checklist: MAINNET\.md: /.test(b.out), "the extension build refuses mainnet while MAINNET.md has open boxes (identity, keys and services are all set here)");
  const m = run("pnpm", ["wallet:mainnet-check"], { cwd: app, allowFail: true, quiet: true });
  check(m.code === 1 && /Mainnet is ON but not ready/.test(m.out), "wallet:mainnet-check exits 1: mainnet on, not ready");
  writeFileSync(cfgPath, cfg);

  step("The security floor can't be switched off");
  const sneaky = join(ext, "src", "sneaky.ts");
  writeFileSync(sneaky, "export const threat = { openLists: false };\n");
  const s = run("pnpm", ["harness"], { cwd: app, allowFail: true, quiet: true });
  check(s.code !== 0 && /kit-security/.test(s.out), "pnpm harness fails on openLists: false");
  rmSync(sneaky);

  if (args.includes("--dapp")) {
    step("The Scaffold-HBAR dapp builds");
    run("pnpm", ["next:build"], { cwd: app });
    ok("next build");
  }

  process.stdout.write(`\nkit e2e: all checks passed${keep ? ` (kept ${work})` : ""}\n`);
} catch (e) {
  process.stderr.write(`\nkit e2e FAILED: ${e instanceof Error ? e.message : String(e)}\n(work dir kept: ${work})\n`);
  process.exit(1);
}
if (!keep) rmSync(work, { recursive: true, force: true });
