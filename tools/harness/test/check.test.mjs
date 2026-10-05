import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  assert.match(text, /harness: 15 problems/);
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
    "apps/mobile/src/background/host.ts",
    "apps/desktop/src/main/host/wallet.ts",
  ]) assert.ok(allowed(f), f);
  for (const f of [
    "packages/ui/src/screens/Send.tsx",
    "packages/route/src/onboarding.ts",
    "packages/chains-evm/src/onboarding.ts",
    "apps/extension/entrypoints/popup/main.tsx",
    "apps/mobile/src/screens/Home.tsx",
    "apps/mobile/src/browser/bridge.ts",
    "packages/engine/src/engine.ts",
    "apps/desktop/src/main/index.ts",
    "apps/desktop/src/main/browser/browser.ts",
    "apps/desktop/src/preload/dapp.ts",
    "apps/desktop/src/preload/wallet.ts",
    "apps/desktop/src/renderer/shared/clients.ts",
    "apps/desktop/src/main/hostile/wallet.ts",
  ]) assert.ok(!allowed(f), f);
});
