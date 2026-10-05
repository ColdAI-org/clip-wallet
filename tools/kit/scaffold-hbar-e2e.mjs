#!/usr/bin/env node
/**
 * pnpm kit:e2e:scaffold-hbar: the Scaffold-HBAR path, end to end, against the LOCAL template.
 *
 *   npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet
 *
 * The template repository isn't published yet, so this runs the real create-scaffold-hbar CLI (npx, latest) with its
 * local-template seam, CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR=templates/scaffold-hbar-clip-wallet: the CLI copies the tree
 * exactly as it copies a giget download (copyLocalTemplateTree), then filters package.json, consumes template.json
 * (rename map, outro) and commits. Before copying, the CLI reads the template's capabilities from GitHub's contents API;
 * the repository isn't published, so tools/kit/github-template-shim.mjs (preloaded) answers that one request with the
 * local template.json. No capability flags are passed: the CLI picks nextjs-app, no Solidity framework and pnpm
 * ("none" = template-managed) from template.json, as it will for the published repository.
 *
 * Then it creates the same wallet with the packed create-clip-wallet, points both at the packed kit (pnpm overrides,
 * identical in both), and runs the template's own .github/scripts/check-scaffold.sh: install, identity, harness, types,
 * both builds, the manifest identity, the mainnet gate, the dapp serving / and /debug, and that both projects match.
 *
 *   node tools/kit/scaffold-hbar-e2e.mjs [--no-pack] [--keep] [--cli-version 0.4.1]
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TEMPLATE, check, installCli, packs, run, step, tempDir, useLocalPacks } from "./lib.mjs";

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const cliVersion = args.includes("--cli-version") ? args[args.indexOf("--cli-version") + 1] : "latest";
const work = tempDir("clip-kit-hbar-");

try {
  step("Pack every publishable package");
  const list = packs({ repack: !args.includes("--no-pack") });

  step(`create-scaffold-hbar@${cliVersion} with the local template`);
  const out = run(
    "npx",
    ["--yes", `create-scaffold-hbar@${cliVersion}`, "app", "--template", "ColdAI-org/scaffold-hbar-clip-wallet", "--yes", "--skip-install", "--skip-hedera-skills"],
    {
      cwd: work,
      env: { CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR: TEMPLATE, NODE_OPTIONS: `--import=${join(ROOT, "tools/kit/github-template-shim.mjs")}`, CI: "1" },
      quiet: true,
    },
  ).out;
  process.stdout.write(out.split("\n").slice(-40).join("\n"));
  const app = join(work, "app");
  check(existsSync(join(app, "packages/extension/clip.config.ts")) && !existsSync(join(app, "template.json")), "project created; template.json consumed");
  check(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).name === "app", "template.json rename map applied (package name = folder)");
  check(/pnpm wallet:identity/.test(out), "the outro comes from template.json (pnpm commands)");

  step("The same wallet with create-clip-wallet (from its tarball)");
  const cli = installCli(join(work, "cli-install"), list);
  run(process.execPath, [cli, join(work, "cli", "app"), "--name", "Fresh Scaffold", "--rdns", "com.example.freshscaffold", "--yes"], { cwd: work });

  step("Both projects install the packed kit");
  useLocalPacks(app, list);
  useLocalPacks(join(work, "cli", "app"), list);
  check(true, "pnpm overrides → .packs/*.tgz");

  step("The template's own fresh-scaffold check (.github/scripts/check-scaffold.sh)");
  run("bash", [join(app, ".github/scripts/check-scaffold.sh"), app, join(work, "cli", "app")], { cwd: app });

  process.stdout.write(`\nscaffold-hbar e2e: all checks passed${keep ? ` (kept ${work})` : ""}\n`);
} catch (e) {
  process.stderr.write(`\nscaffold-hbar e2e FAILED: ${e instanceof Error ? e.message : String(e)}\n(work dir kept: ${work})\n`);
  process.exit(1);
}
if (!keep) rmSync(work, { recursive: true, force: true });
