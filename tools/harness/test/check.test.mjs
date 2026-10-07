import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { VAULT_IMPORT_ALLOW, bindings, findImports, format, lex, runChecks } from "../check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const fixture = (name) => join(here, "fixtures", name);
const run = (name, tracked = []) => runChecks({ root: fixture(name), tracked, wordlistFrom: repo });
const where = (r) => r.failures.map((f) => `${f.rule} ${f.file}:${f.line}`).sort();

test("a clean tree passes: vault internals, verification-only curves, allowed vault importers", () => {
  const r = run("clean");
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.warnings, []);
});

test("a dirty tree fails every rule, with file:line", () => {
  const r = run("dirty", [".env", "apps/x/.env.local", ".env.example", "README.md"]);
  assert.deepEqual(where(r), [
    "chain-module-imports-vault packages/chains-evm/package.json:4",
    "chain-module-imports-vault packages/chains-evm/src/sign.ts:2",
    "crypto-dep-unpinned packages/chains-evm/package.json:5",
    "env-tracked .env:0",
    "env-tracked apps/x/.env.local:0",
    "key-material-outside-vault packages/chains-evm/src/sign.ts:1",
    "key-material-outside-vault packages/chains-solana/src/keys.ts:1",
    "key-material-outside-vault packages/chains-solana/src/keys.ts:2",
    "key-material-outside-vault packages/route/src/debug.ts:1",
    "key-material-outside-vault packages/route/src/debug.ts:2",
    "key-material-outside-vault packages/route/src/debug.ts:3",
    "logs-secret packages/route/src/debug.ts:8",
    "logs-secret packages/route/src/debug.ts:9",
    "phrase-literal packages/route/src/demo.ts:1",
    "vault-import-not-allowed packages/ui/src/screens/Send.tsx:1",
    "vault-kat-missing packages/vault:0",
  ]);
  const text = format(r);
  assert.match(text, /FAIL {5}packages\/route\/src\/debug\.ts:8 {2}Never log key material: console\.log prints "mnemonic"/);
  assert.match(text, /harness: 16 problems/);
  assert.match(text, /@noble\/curves is a crypto-critical dependency: pin it to an exact version \(e\.g\. "2\.4\.0"\)/);
});

test("without packages/vault the KAT rule is a warning, not a failure", () => {
  const r = run("novault");
  assert.equal(r.failures.length, 0);
  assert.deepEqual(r.warnings.map((w) => w.rule), ["vault-kat-missing"]);
});

test("tracked .env files are found through git", () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-harness-"));
  try {
    cpSync(fixture("novault"), dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "PLACEHOLDER=1\n");
    writeFileSync(join(dir, ".env.example"), "PLACEHOLDER=\n");
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    git("add", "-f", ".env", ".env.example");
    const r = runChecks({ root: dir, wordlistFrom: repo });
    assert.deepEqual(where(r), ["env-tracked .env:0"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real repository passes", () => {
  const r = runChecks({ root: repo });
  assert.deepEqual(r.failures, [], format(r));
});

test("lexer: comments are blanked, strings kept, template expressions stay code", () => {
  const src = 'const a = "x // y"; // console.log(seed)\n/* console.log(mnemonic) */ const b = `t ${secret} u`;';
  const { code, strings } = lex(src);
  assert.equal(code.length, src.length);
  assert.doesNotMatch(code, /console/);
  assert.match(code, /\$\{secret\}/);
  assert.deepEqual(strings.map((s) => s.value), ["x // y", "t ", " u"]);
});

test("imports: static, multi-line, type-only, dynamic and require", () => {
  const src = [
    'import { a,\n  b as c } from "m1";',
    'import type { T } from "m2";',
    'import * as ns from "m3";',
    'import d, { e } from "m4";',
    'import "m5";',
    'const x = await import("m6");',
    'const y = require("m7");',
    'export { z } from "m8";',
  ].join("\n");
  const imps = findImports(src);
  assert.deepEqual(imps.map((i) => i.module), ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
  assert.equal(imps[1].typeOnly, true);
  assert.deepEqual(bindings(imps[0].clause).map((b) => b.name), ["a", "c"]);
  assert.deepEqual(bindings(imps[2].clause), [{ name: "ns", imported: "*", namespace: true }]);
  assert.deepEqual(bindings(imps[3].clause).map((b) => b.name).sort(), ["d", "e"]);
});

test("vault importers: background, mobile/desktop hosts, onboarding screen and the vault only", () => {
  const allowed = (f) => VAULT_IMPORT_ALLOW.some((re) => re.test(f));
  for (const f of [
    "packages/vault/src/index.ts",
    "apps/extension/entrypoints/background.ts",
    "apps/extension/src/background/index.ts",
    "packages/ui/src/screens/Onboarding.tsx",
    "packages/ui/src/screens/onboarding/Create.tsx",
    "packages/mobile-kit/src/background/host.ts",
    "packages/desktop-kit/src/main/host/wallet.ts",
    "packages/desktop-kit/src/main/host/link.ts",
    "apps/desktop/e2e/mock-extension.ts",
    "packages/extension-kit/src/background/wiring.ts",
  ]) assert.ok(allowed(f), f);
  for (const f of [
    "packages/ui/src/screens/Send.tsx",
    "packages/route/src/onboarding.ts",
    "packages/chains-evm/src/onboarding.ts",
    "apps/extension/entrypoints/popup/main.tsx",
    "packages/mobile-kit/src/screens/Home.tsx",
    "packages/mobile-kit/src/browser/bridge.ts",
    "packages/engine/src/engine.ts",
    "packages/desktop-kit/src/main/index.ts",
    "packages/desktop-kit/src/main/browser/browser.ts",
    "packages/desktop-kit/src/preload/dapp.ts",
    "packages/desktop-kit/src/preload/wallet.ts",
    "packages/desktop-kit/src/renderer/shared/clients.ts",
    "packages/desktop-kit/src/main/hostile/wallet.ts",
    "packages/desktop-kit/src/main/native-hosts.ts",
    "apps/desktop/e2e/desktop.spec.ts",
    "apps/desktop/e2e/link.spec.ts",
    "apps/desktop/e2e/mock-extension.tsx",
    "packages/extension-kit/src/pages/mount.tsx",
    "packages/extension-kit/src/wxt.ts",
    "apps/desktop/src/main/index.ts",
    "apps/mobile/index.ts",
    "packages/desktop-kit/src/electron-vite.ts",
    "packages/mobile-kit/src/screens/Onboarding.tsx",
  ]) assert.ok(!allowed(f), f);
});

test("kit-built wallets: the template passes, with a reminder to set the identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-kit-"));
  try {
    cpSync(join(repo, "templates", "scaffold-hbar-clip-wallet"), dir, { recursive: true });
    const r = runChecks({ root: dir, tracked: [], wordlistFrom: repo });
    assert.deepEqual(r.failures, []);
    assert.deepEqual(r.warnings.map((w) => w.rule), ["kit-identity"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kit-built wallets: Clip Wallet's identity, a switched-off security floor, an unready mainnet and loose pins fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-kit-"));
  try {
    cpSync(join(repo, "templates", "scaffold-hbar-clip-wallet"), dir, { recursive: true });
    const ext = join(dir, "packages", "extension");
    writeFileSync(join(dir, "wallet.identity.json"), JSON.stringify({ name: "Clip Wallet", rdns: "org.coldai.clipwallet", appId: "org.coldai.clipwallet", icon: "./icon.svg" }));
    writeFileSync(join(ext, "wxt.config.ts"), 'import { defineConfig } from "wxt";\nexport default defineConfig({ srcDir: "src" });\n');
    writeFileSync(join(ext, "src", "security.ts"), "export const threat = {\n  openLists: false,\n};\n");
    // The desktop and phone apps must build through their kits too.
    writeFileSync(join(dir, "packages", "desktop", "electron.vite.config.ts"), 'import { defineConfig } from "electron-vite";\nexport default defineConfig({});\n');
    writeFileSync(join(dir, "packages", "mobile", "metro.config.js"), 'const { getDefaultConfig } = require("expo/metro-config");\n// withClipWallet( is only mentioned here\nmodule.exports = getDefaultConfig(__dirname);\n');
    const cfg = join(dir, "clip.config.ts");
    const on = readFileSync(cfg, "utf8").replace(/^(\s*)mainnet: false,$/m, "$1mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },");
    writeFileSync(cfg, on);
    const mainnetLine = on.split("\n").findLastIndex((l) => l.includes("mainnet: { enabled")) + 1;
    const pkg = join(ext, "package.json");
    writeFileSync(pkg, readFileSync(pkg, "utf8").replace('"@clip-wallet/extension-kit": "0.1.0"', '"@clip-wallet/extension-kit": "^0.1.0"'));
    const r = runChecks({ root: dir, tracked: [".keys/extension.pem"], wordlistFrom: repo });
    assert.deepEqual(where(r), [
      "key-file-tracked .keys/extension.pem:0",
      "kit-identity wallet.identity.json:0",
      "kit-identity wallet.identity.json:0",
      "kit-identity wallet.identity.json:0",
      `kit-mainnet clip.config.ts:${mainnetLine}`,
      "kit-pinned packages/extension/package.json:0",
      "kit-security packages/desktop/electron.vite.config.ts:0",
      "kit-security packages/extension/src/security.ts:2",
      "kit-security packages/extension/wxt.config.ts:0",
      "kit-security packages/mobile/metro.config.js:0",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("kit-built wallets: a project with only some platforms checks only those", () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-kit-"));
  try {
    cpSync(join(repo, "templates", "scaffold-hbar-clip-wallet"), dir, { recursive: true });
    for (const p of ["extension", "desktop", "nextjs"]) rmSync(join(dir, "packages", p), { recursive: true, force: true });
    assert.deepEqual(runChecks({ root: dir, tracked: [], wordlistFrom: repo }).failures, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
