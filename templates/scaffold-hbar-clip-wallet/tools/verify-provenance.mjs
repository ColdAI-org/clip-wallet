#!/usr/bin/env node
/**
 * pnpm verify:provenance: check that the Clip Wallet kit packages this wallet runs were built and published by the
 * kit's own CI, from its public repository, and that the tarball npm serves is the one that build produced.
 *
 * For every @clip-wallet/* package in the pinned release (and create-clip-wallet) it fetches npm's attestations
 * (https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>) and checks:
 *   - a SLSA provenance attestation exists (npm publish --provenance, signed through Sigstore);
 *   - it names the expected source repository and a GitHub Actions workflow;
 *   - its subject digest equals the sha512 integrity npm lists for that version.
 * It does not re-verify the Sigstore certificate chain itself: `npm audit signatures` in an npm-installed copy does that.
 *
 *   node tools/verify-provenance.mjs [--repo https://github.com/ColdAI-org/clip-wallet]
 *
 * Node built-ins only. Network: registry.npmjs.org.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argRepo = process.argv.indexOf("--repo");
const REPO = (argRepo > 0 ? process.argv[argRepo + 1] : "https://github.com/ColdAI-org/clip-wallet").replace(/\.git$/, "").replace(/\/$/, "");
const REGISTRY = "https://registry.npmjs.org";

function read(file) {
  return JSON.parse(readFileSync(join(root, file), "utf8"));
}

/** The kit packages this project runs, at the version it pins. */
function packages() {
  const ext = read("packages/extension/package.json");
  const version = ext.dependencies?.["@clip-wallet/extension-kit"];
  if (!version || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) {
    throw new Error("packages/extension/package.json must pin @clip-wallet/extension-kit to one exact version.");
  }
  const names = new Set(["@clip-wallet/extension-kit", "@clip-wallet/config"]);
  const kit = join(root, "packages/extension/node_modules/@clip-wallet/extension-kit/package.json");
  if (existsSync(kit)) for (const d of Object.keys(JSON.parse(readFileSync(kit, "utf8")).dependencies ?? {})) if (d.startsWith("@clip-wallet/")) names.add(d);
  const list = [...names].map((name) => ({ name, version }));
  const cli = read("package.json").devDependencies?.["create-clip-wallet"];
  if (cli) list.push({ name: "create-clip-wallet", version: cli });
  return list;
}

async function json(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function check({ name, version }) {
  const enc = name.replace("/", "%2f");
  const meta = await json(`${REGISTRY}/${enc}/${version}`);
  if (!meta) return `${name}@${version} isn't on npm`;
  const integrity = meta.dist?.integrity ?? "";
  const att = await json(`${REGISTRY}/-/npm/v1/attestations/${name}@${version}`);
  const prov = att?.attestations?.find((a) => /^https:\/\/slsa\.dev\/provenance\//.test(a.predicateType));
  if (!prov) return `${name}@${version} has no provenance attestation (published without --provenance)`;
  const statement = JSON.parse(Buffer.from(prov.bundle?.dsseEnvelope?.payload ?? "", "base64").toString("utf8") || "{}");
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
  const repo = String(workflow.repository ?? "").replace(/\/$/, "");
  if (repo !== REPO) return `${name}@${version} was built from ${repo || "an unknown repository"}, not ${REPO}`;
  if (!workflow.path) return `${name}@${version}: the provenance names no build workflow`;
  const digest = statement.subject?.[0]?.digest?.sha512;
  const expected = integrity.startsWith("sha512-") ? Buffer.from(integrity.slice(7), "base64").toString("hex") : undefined;
  if (!digest || digest !== expected) return `${name}@${version}: the attested tarball digest doesn't match what npm serves`;
  process.stdout.write(`  ok  ${name}@${version}  ${repo}/${workflow.path}@${workflow.ref ?? "?"}\n`);
  return undefined;
}

const list = packages();
process.stdout.write(`Checking provenance of ${list.length} packages against ${REPO}\n`);
const problems = (await Promise.all(list.map((p) => check(p).catch((e) => `${p.name}@${p.version}: ${e.message}`)))).filter(Boolean);
if (problems.length) {
  process.stderr.write(`\n${problems.map((p) => `FAIL ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("verify:provenance: every package was built by the kit's CI and matches what npm serves.\n");
