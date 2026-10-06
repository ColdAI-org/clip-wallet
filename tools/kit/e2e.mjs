#!/usr/bin/env node
/**
 * pnpm kit:e2e: a kit-built wallet on every platform, from the published shape, end to end, in a temp directory.
 *
 *  1. pnpm pack-all (build, manifest checks, tarballs in .packs; nothing published)
 *  2. install the packed create-clip-wallet and run it non-interactively for every platform (extension, desktop,
 *     mobile) with a custom name, rdns, app id, accent, PNG logo, networks and languages
 *  3. the project has its own identity: wallet.identity.json at the root, extension key (0600, gitignored, untracked),
 *     every platform's icons rendered from the logo, WalletConnect id in .env only, listing drafts
 *  4. point the project's kit dependencies at the tarballs (pnpm overrides), `pnpm install`
 *  5. `pnpm harness` and `pnpm check-types` (every platform) inside the project
 *  6. extension: `pnpm extension:build`; the manifest carries the name, key and icons; Chromium loads it: its id is
 *     the one the key fixes, and a page sees it announce itself over EIP-6963 with the new name and rdns
 *  7. desktop: `pnpm desktop:build`, then electron-builder for this machine (macOS arm64: .app + zip); the bundle id,
 *     name, deep-link scheme and icon are the wallet's; the packaged app starts headless and shows onboarding
 *  8. mobile: `expo export` (iOS and Android JS bundles) with the wallet's config inlined, and `expo prebuild` (native
 *     projects, no pod install): bundle id, package, name, scheme and icons are the wallet's
 *  9. the mainnet checklist is enforced by the harness, every platform's build and wallet:mainnet-check
 * 10. the security floor: `openLists: false` anywhere fails the harness
 * 11. with --dapp: a second project with --scaffold-hbar, whose Next.js dapp builds
 *
 *   node tools/kit/e2e.mjs [--no-pack] [--dapp] [--keep] [--skip-desktop] [--skip-mobile]
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, check, git, installCli, json, ok, packs, run, step, tempDir, useLocalPacks } from "./lib.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const work = tempDir("clip-kit-e2e-");
const WC = "0123456789abcdef0123456789abcdef";
const NAME = "Acme Wallet";
const RDNS = "com.acme.wallet";
const APP_ID = "com.acme.app";
const NETWORKS = "evm:*,hedera,solana,bitcoin,ton,near,stellar,tezos,algorand";
const LANGUAGES = "en,de,ja,ar";
const pw = createRequire(join(ROOT, "apps", "extension", "package.json"))("@playwright/test");

/** Sizes of build outputs, for the report. */
const sizes = [];
function du(path) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((s, f) => s + du(join(path, f)), 0);
}
function record(what, path) {
  const bytes = du(path);
  sizes.push([what, path, bytes]);
  ok(`${what}: ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

/** A 1024×1024 logo with transparency (an accent ring on nothing), PNG, drawn with the CLI's own encoder. */
async function writeLogo(cliDir, file) {
  const { canvas, encodePng } = await import(join(cliDir, "node_modules", "create-clip-wallet", "src", "icons.mjs"));
  const img = canvas(1024, 1024);
  for (let y = 0; y < 1024; y++) {
    for (let x = 0; x < 1024; x++) {
      const d = Math.hypot(x - 511.5, y - 511.5);
      if (d < 460 && d > 300) img.data.set([0xf5, 0xa6, 0x23, 255], (y * 1024 + x) * 4);
      else if (d < 120) img.data.set([0xff, 0xff, 0xff, 255], (y * 1024 + x) * 4);
    }
  }
  writeFileSync(file, encodePng(img));
}

/** A key of an XML plist (Info.plist), as plain text. */
function plistValue(xml, key) {
  const m = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
  return m?.[1];
}

try {
  step("Pack every publishable package");
  const list = packs({ repack: !args.includes("--no-pack") });
  for (const n of ["@clip-wallet/extension-kit", "@clip-wallet/desktop-kit", "@clip-wallet/mobile-kit", "create-clip-wallet"]) {
    if (!list.some((p) => p.name === n)) throw new Error(`${n} is not in .packs`);
  }
  check(list.length >= 34, `${list.length} tarballs in .packs (extension-kit, desktop-kit, mobile-kit, create-clip-wallet among them)`);

  step("create-clip-wallet from its tarball, every platform, non-interactive");
  const cliDir = join(work, "cli-install");
  const cli = installCli(cliDir, list);
  const tarballFiles = run("tar", ["-tzf", list.find((p) => p.name === "create-clip-wallet").path], { quiet: true }).out;
  check(/package\/template\/template\.json/.test(tarballFiles) && /package\/template\/_gitignore/.test(tarballFiles), "the tarball bundles the template (dotfiles as _gitignore)");
  check(/package\/template\/packages\/desktop\/electron\.vite\.config\.ts/.test(tarballFiles) && /package\/template\/packages\/mobile\/app\.config\.ts/.test(tarballFiles), "…with the desktop and mobile apps");
  const logo = join(work, "acme-logo.png");
  await writeLogo(cliDir, logo);
  const created = run(
    process.execPath,
    [cli, "acme-wallet", "--name", NAME, "--rdns", RDNS, "--id", APP_ID, "--accent", "#0B7A3B", "--logo", logo, "--networks", NETWORKS, "--languages", LANGUAGES, "--homepage", "https://wallet.acme.example", "--walletconnect-project-id", WC, "--yes"],
    { cwd: work, quiet: true },
  ).out;
  process.stdout.write(created.split("\n").map((l) => `   | ${l}`).join("\n") + "\n");
  const app = join(work, "acme-wallet");
  const ext = join(app, "packages", "extension");
  const desk = join(app, "packages", "desktop");
  const mob = join(app, "packages", "mobile");
  check(["pnpm dev:extension", "pnpm dev:desktop", "pnpm --filter mobile start", "pnpm desktop:dist", "pnpm mobile:export"].every((s) => created.includes(s)), "next steps for each platform");
  check(JSON.stringify(readdirSync(join(app, "packages")).sort()) === JSON.stringify(["desktop", "extension", "mobile"]), "packages: extension, desktop, mobile (no dapp without --scaffold-hbar)");

  step("The wallet has its own identity, on every platform");
  const id = json(join(app, "wallet.identity.json"));
  check(id.name === NAME && id.rdns === RDNS && id.appId === APP_ID && id.homepage === "https://wallet.acme.example" && id.icon === "./icon.png", "wallet.identity.json: name, rdns, app id, homepage, logo");
  check(/^[A-Za-z0-9+/=]{300,}$/.test(id.extension?.key ?? ""), "extension.key is a public key (base64 SPKI)");
  const { extensionIdFromKey } = await import(join(cliDir, "node_modules", "create-clip-wallet", "src", "identity.mjs"));
  const extId = extensionIdFromKey(id.extension.key);
  const pem = join(app, ".keys", "extension.pem");
  check(existsSync(pem) && (statSync(pem).mode & 0o077) === 0, "private key in .keys/extension.pem, mode 0600");
  check(!git(app, "ls-files").split("\n").some((f) => /\.pem$|\.keys\/|(^|\/)\.env(\.local)?$/.test(f)), "no key or .env file is tracked by git");
  check(readFileSync(join(app, ".env"), "utf8").includes(`CLIP_WALLETCONNECT_PROJECT_ID=${WC}`), "WalletConnect project id in .env");
  const cfgText = readFileSync(join(app, "clip.config.ts"), "utf8");
  check(!cfgText.includes(WC) && cfgText.includes('languages: ["en", "de", "ja", "ar"]') && cfgText.includes('accent: "#0B7A3B"'), "clip.config.ts: accent and languages set, no WalletConnect id");
  check(readFileSync(join(ext, "src/entrypoints/popup/index.html"), "utf8").includes(`<title>${NAME}</title>`), "extension page titles use the name");
  check(readFileSync(join(app, "icon.png")).equals(readFileSync(logo)), "icon.png is the logo");
  const { decodePng, readIcns, readIco } = await import(join(cliDir, "node_modules", "create-clip-wallet", "src", "icons.mjs"));
  const px = (f) => decodePng(readFileSync(f));
  check([16, 32, 48, 128].every((s) => px(join(ext, `public/icon/${s}.png`)).width === s), "extension icons 16/32/48/128");
  const icns = readIcns(readFileSync(join(desk, "build/icon.icns")));
  check(icns.length === 10 && icns.some((e) => e.type === "ic10" && decodePng(e.png).width === 1024), `macOS icon.icns: ${icns.map((e) => e.type).join(" ")}`);
  check(readIco(readFileSync(join(desk, "build/icon.ico"))).map((e) => e.size).join() === "16,24,32,48,64,128,256", "Windows icon.ico: 16–256");
  check(readdirSync(join(desk, "build/icons")).length === 8, "Linux icons: 16–1024");
  const iosIcon = px(join(mob, "assets/icon.png"));
  check(iosIcon.width === 1024 && iosIcon.data[3] === 255 && iosIcon.data[0] === 0x0b && iosIcon.data[1] === 0x7a, "iOS icon: 1024, opaque, the logo on the accent colour");
  check(px(join(mob, "assets/adaptive-icon.png")).data[3] === 0, "Android adaptive foreground: transparent around the logo");
  const listings = readdirSync(join(app, "docs", "listings")).sort();
  check(
    JSON.stringify(listings) === JSON.stringify(["README.md", "beacon.md", "eip-6963.md", "near.md", "stellar-wallets-kit.md", "ton-connect.md", "use-wallet.md", "walletconnect-explorer.md"]),
    `listing drafts: ${listings.join(", ")}`,
  );

  step("Install from the tarballs");
  useLocalPacks(app, list);
  run("pnpm", ["install"], { cwd: app });
  const installed = JSON.parse(readFileSync(join(desk, "node_modules", "@clip-wallet", "desktop-kit", "package.json"), "utf8"));
  check(!JSON.stringify(installed.exports).includes("development"), "installed kits are the packed (dist) shape, not workspace sources");

  step("pnpm harness and check-types (every platform) inside the project");
  const harness = run("pnpm", ["harness"], { cwd: app, quiet: true });
  check(/harness: ok/.test(harness.out), "pnpm harness passes");
  run("pnpm", ["check-types"], { cwd: app });
  ok("types: extension, desktop, mobile");
  run("pnpm", ["wallet:listings"], { cwd: app });
  check(git(app, "status", "--porcelain", "docs/listings").trim() === "", "wallet:listings regenerates the same drafts");

  step("Extension: build, manifest, Chromium loads it with its own id and EIP-6963 announcement");
  run("pnpm", ["extension:build"], { cwd: app });
  const out = join(ext, ".output", "chrome-mv3");
  const manifest = json(join(out, "manifest.json"));
  check(manifest.name === NAME && manifest.action?.default_title === NAME, "manifest name and action title");
  check(manifest.key === id.extension.key, "manifest key = wallet.identity.json extension.key");
  check(["16", "32", "48", "128"].every((s) => readFileSync(join(out, manifest.icons[s])).equals(readFileSync(join(ext, "public", manifest.icons[s])))), "manifest icons are the rendered ones");
  check(manifest.description.endsWith("Test networks only."), "testnet build says so");
  record("extension (chrome-mv3, unpacked)", out);
  run("pnpm", ["extension:zip"], { cwd: app, quiet: true });
  const zip = readdirSync(join(ext, ".output")).find((f) => f.endsWith("-chrome.zip"));
  check(zip === "acme-wallet-0.1.0-chrome.zip", `store zip named after the wallet: ${zip}`);
  record("extension store zip", join(ext, ".output", zip));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>dapp</title><body>dapp</body>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const context = await pw.chromium.launchPersistentContext("", { channel: "chromium", headless: true, args: [`--disable-extensions-except=${out}`, `--load-extension=${out}`] });
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
    check(announced[0].icon === `data:image/png;base64,${readFileSync(logo).toString("base64")}`, "announced icon is the wallet's logo");
    const globals = await page.evaluate(() => ({ key: typeof window.acmewallet?.near, clip: typeof window.clipwallet }));
    check(globals.key === "object" && globals.clip === "undefined", "NEAR/Stellar/Algorand providers hang off window.acmewallet, not window.clipwallet");
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    check((await popup.title()) === NAME, "the popup is titled with the wallet's name");
  } finally {
    await context.close();
    server.close();
  }

  if (!args.includes("--skip-desktop")) {
    step("Desktop: electron-vite build, electron-builder for this machine, the packaged app starts");
    run("pnpm", ["desktop:build"], { cwd: app });
    const html = readFileSync(join(desk, "out/renderer/wallet/index.html"), "utf8");
    check(html.includes(`<title>${NAME}</title>`) && /Content-Security-Policy" content="default-src 'none'/.test(html), "wallet page: the wallet's name and CSP");
    const mainJs = readdirSync(join(desk, "out/main"), { recursive: true }).filter((f) => String(f).endsWith(".mjs")).map((f) => readFileSync(join(desk, "out/main", String(f)), "utf8")).join("\n");
    check(mainJs.includes(`"${RDNS}"`) && mainJs.includes(`"${NAME}"`) && !mainJs.includes("org.coldai.clipwallet"), "main process carries the wallet's config (and not Clip Wallet's)");
    check(existsSync(join(desk, "out/native-host/clip-native-host.cjs")), "native-messaging host bundled");
    record("desktop out/ (main, preloads, renderer)", join(desk, "out"));
    const host = process.platform === "darwin" ? ["--mac", "zip", `--${process.arch}`] : process.platform === "win32" ? ["--win", "zip"] : ["--linux", "tar.gz"];
    run("pnpm", ["exec", "electron-builder", ...host, "--config", "electron-builder.config.cjs", "--publish", "never"], { cwd: desk, env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
    const release = join(desk, "release");
    const artifacts = readdirSync(release).filter((f) => /\.(zip|tar\.gz|exe|dmg)$/.test(f));
    check(artifacts.some((f) => f.startsWith("Acme-Wallet-0.1.0-")), `installer artifact: ${artifacts.join(", ")}`);
    for (const a of artifacts) record(`desktop ${a}`, join(release, a));
    if (process.platform === "darwin") {
      const appDir = readdirSync(release).find((d) => d.startsWith("mac"));
      const bundle = join(release, appDir, `${NAME}.app`);
      check(existsSync(bundle), `${appDir}/${NAME}.app`);
      record(`desktop ${NAME}.app (${appDir})`, bundle);
      const plist = run("plutil", ["-convert", "xml1", "-o", "-", join(bundle, "Contents", "Info.plist")], { quiet: true }).out;
      check(plistValue(plist, "CFBundleIdentifier") === `${APP_ID}.desktop`, `CFBundleIdentifier ${APP_ID}.desktop`);
      check(plistValue(plist, "CFBundleName") === NAME && plistValue(plist, "CFBundleDisplayName") === NAME, "CFBundleName / CFBundleDisplayName");
      check(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>acmewallet<\/string>/.test(plist), "deep-link scheme acmewallet:// registered");
      const iconFile = plistValue(plist, "CFBundleIconFile");
      check(readFileSync(join(bundle, "Contents", "Resources", iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`)).equals(readFileSync(join(desk, "build/icon.icns"))), "the app icon is the rendered icon.icns");
      const exe = join(bundle, "Contents", "MacOS", NAME);
      const home = mkdtempSync(join(tmpdir(), "clip-kit-desktop-"));
      let electronApp;
      for (let attempt = 1; !electronApp; attempt++) {
        try {
          electronApp = await pw._electron.launch({ executablePath: exe, args: [`--user-data-dir=${home}`, "--use-mock-keychain"], env: { ...process.env, CLIP_DESKTOP_NO_SYSTEM_INTEGRATION: "1" }, timeout: 30_000 });
        } catch (e) {
          if (attempt >= 3) throw e;
        }
      }
      try {
        const win = await electronApp.firstWindow();
        await win.waitForURL(/^clip-app:\/\/wallet\/wallet\//, { timeout: 30_000 });
        await win.getByRole("button", { name: "Create a new wallet" }).waitFor({ timeout: 30_000 });
        check((await win.title()) === NAME, `packaged app: wallet window titled ${NAME}, onboarding shown`);
        const isolated = await win.evaluate(() => typeof window.clipDesktop === "object" && typeof window.require === "undefined" && typeof window.process === "undefined");
        check(isolated, "the wallet window sees only the bridge (no Node)");
        const appName = await electronApp.evaluate(({ app: a }) => a.getName());
        check(appName === NAME, `app.getName() = ${appName}`);
      } finally {
        await electronApp.close().catch(() => undefined);
        rmSync(home, { recursive: true, force: true });
      }
    }
  }

  if (!args.includes("--skip-mobile")) {
    step("Mobile: expo config, expo export (iOS + Android JS bundles), expo prebuild (native projects)");
    const cfg = JSON.parse(run("pnpm", ["exec", "expo", "config", "--type", "public", "--json"], { cwd: mob, quiet: true }).out.replace(/^[^{]*/, ""));
    check(cfg.name === NAME && cfg.slug === "acme-wallet" && cfg.scheme === "acmewallet", `Expo config: name ${cfg.name}, slug ${cfg.slug}, scheme ${cfg.scheme}`);
    check(cfg.ios?.bundleIdentifier === APP_ID && cfg.android?.package === APP_ID, `bundle id / package ${cfg.ios?.bundleIdentifier} / ${cfg.android?.package}`);
    check(cfg.android?.adaptiveIcon?.backgroundColor === "#0B7A3B" && cfg.icon === "./assets/icon.png", "icons: icon.png, adaptive icon on the accent colour");
    run("pnpm", ["mobile:export"], { cwd: app, env: { CI: "1" } });
    const dist = join(mob, "dist");
    const meta = json(join(dist, "metadata.json"));
    const bundles = ["ios", "android"].map((p) => join(dist, meta.fileMetadata[p].bundle));
    check(bundles.every((b) => existsSync(b)), `JS bundles: ${bundles.map((b) => b.slice(dist.length + 1)).join(", ")}`);
    for (const [p, b] of [["ios", bundles[0]], ["android", bundles[1]]]) record(`mobile ${p} bundle (Hermes)`, b);
    record("mobile dist/ (expo export)", dist);
    const iosBundle = readFileSync(bundles[0]);
    // (1Mask's inpage script keeps Clip Wallet's identity as its built-in default; the app always passes its own.)
    check(iosBundle.includes(Buffer.from(RDNS)) && iosBundle.includes(Buffer.from(NAME)), "the bundle carries the wallet's resolved config");
    run("pnpm", ["exec", "expo", "prebuild", "--no-install", "--clean"], { cwd: mob, env: { CI: "1", EXPO_NO_GIT_STATUS: "1" } });
    const iosDir = readdirSync(join(mob, "ios")).find((d) => d.endsWith(".xcodeproj"))?.replace(/\.xcodeproj$/, "");
    check(!!iosDir, `ios/${iosDir}.xcodeproj generated`);
    const pbx = readFileSync(join(mob, "ios", `${iosDir}.xcodeproj`, "project.pbxproj"), "utf8");
    check(new RegExp(`PRODUCT_BUNDLE_IDENTIFIER = "?${APP_ID.replace(/\./g, "\\.")}"?;`).test(pbx), `iOS bundle id ${APP_ID}`);
    const info = readFileSync(join(mob, "ios", iosDir, "Info.plist"), "utf8");
    check(plistValue(info, "CFBundleDisplayName") === NAME && /<string>acmewallet<\/string>/.test(info), "iOS display name and URL scheme");
    check(/Unlock Acme Wallet with Face ID/.test(info), "iOS permission texts use the name");
    const appIcon = join(mob, "ios", iosDir, "Images.xcassets", "AppIcon.appiconset");
    const iconPng = readdirSync(appIcon).find((f) => f.endsWith(".png"));
    check(!!iconPng && px(join(appIcon, iconPng)).width === 1024, `iOS AppIcon (${iconPng}) from assets/icon.png`);
    const gradle = readFileSync(join(mob, "android", "app", "build.gradle"), "utf8");
    check(gradle.includes(`applicationId '${APP_ID}'`) || gradle.includes(`applicationId "${APP_ID}"`), `Android applicationId ${APP_ID}`);
    const strings = readFileSync(join(mob, "android", "app", "src", "main", "res", "values", "strings.xml"), "utf8");
    check(strings.includes(`<string name="app_name">${NAME}</string>`), "Android app_name");
    const manifestXml = readFileSync(join(mob, "android", "app", "src", "main", "AndroidManifest.xml"), "utf8");
    check(manifestXml.includes('android:scheme="acmewallet"'), "Android deep-link scheme");
    const res = join(mob, "android", "app", "src", "main", "res");
    check(readdirSync(res).some((d) => d.startsWith("mipmap-") && readdirSync(join(res, d)).some((f) => /ic_launcher_foreground|ic_launcher\./.test(f))), "Android launcher icons from the adaptive icon");
    check(readFileSync(join(res, "values", "colors.xml"), "utf8").includes("#0B7A3B"), "Android icon / splash background is the accent");
  }

  step("The mainnet checklist is enforced on every platform");
  const cfgPath = join(app, "clip.config.ts");
  writeFileSync(
    cfgPath,
    cfgText
      .replace('import { defineConfig } from "@clip-wallet/config";', 'import { MAINNET_ACKNOWLEDGEMENT, defineConfig } from "@clip-wallet/config";')
      .replace(/^ {2}mainnet: false,$/m, "  mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },"),
  );
  try {
    const h = run("pnpm", ["harness"], { cwd: app, allowFail: true, quiet: true });
    check(h.code !== 0 && /kit-mainnet/.test(h.out), "pnpm harness refuses mainnet with open MAINNET.md boxes");
    const b = run("pnpm", ["extension:build"], { cwd: app, allowFail: true, quiet: true });
    check(b.code !== 0 && /mainnet checklist: MAINNET\.md: /.test(b.out), "the extension build refuses it");
    if (!args.includes("--skip-desktop")) {
      const d = run("pnpm", ["desktop:build"], { cwd: app, allowFail: true, quiet: true });
      check(d.code !== 0 && /mainnet checklist: MAINNET\.md: /.test(d.out), "the desktop build refuses it");
    }
    if (!args.includes("--skip-mobile")) {
      const m = run("pnpm", ["exec", "expo", "config", "--type", "public"], { cwd: mob, allowFail: true, quiet: true });
      check(m.code !== 0 && /mainnet checklist: MAINNET\.md: /.test(m.out), "the phone app's Expo config refuses it");
    }
    const c = run("pnpm", ["wallet:mainnet-check"], { cwd: app, allowFail: true, quiet: true });
    check(c.code === 1 && /Mainnet is ON but not ready/.test(c.out), "wallet:mainnet-check exits 1: mainnet on, not ready");
  } finally {
    writeFileSync(cfgPath, cfgText);
  }

  step("The security floor can't be switched off");
  const sneaky = join(mob, "sneaky.ts");
  writeFileSync(sneaky, "export const threat = { openLists: false };\n");
  const s = run("pnpm", ["harness"], { cwd: app, allowFail: true, quiet: true });
  check(s.code !== 0 && /kit-security/.test(s.out), "pnpm harness fails on openLists: false");
  rmSync(sneaky);

  if (args.includes("--dapp")) {
    step("With --scaffold-hbar: the Scaffold-HBAR dapp builds");
    run(process.execPath, [cli, "dapp-wallet", "--platforms", "extension", "--scaffold-hbar", "--name", "Dapp Wallet", "--yes"], { cwd: work, quiet: true });
    const dapp = join(work, "dapp-wallet");
    useLocalPacks(dapp, list);
    run("pnpm", ["install"], { cwd: dapp });
    run("pnpm", ["next:build"], { cwd: dapp });
    ok("next build");
  }

  process.stdout.write("\nBuild outputs:\n");
  for (const [what, path, bytes] of sizes) process.stdout.write(`  ${what.padEnd(48)} ${(bytes / 1024 / 1024).toFixed(1).padStart(7)} MB  ${path.replace(work, "<work>")}\n`);
  process.stdout.write(`\nkit e2e: all checks passed${keep ? ` (kept ${work})` : ""}\n`);
} catch (e) {
  process.stderr.write(`\nkit e2e FAILED: ${e instanceof Error ? e.message : String(e)}\n(work dir kept: ${work})\n`);
  process.exit(1);
}
if (!keep) rmSync(work, { recursive: true, force: true });
