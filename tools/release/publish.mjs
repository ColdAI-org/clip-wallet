#!/usr/bin/env node
/**
 * pnpm release, after pnpm pack-all (CI only: .github/workflows/release.yml): publish every tarball listed in
 * .packs/manifest.json ({ name, version, file }) to npm with provenance, then check every version's attestation.
 *
 *   node tools/release/publish.mjs [--dry-run]
 *
 * 1. GET https://registry.npmjs.org/<name>/<version>: 200 means the version is on npm and is skipped; 404 means
 *    `npm publish .packs/<file> --provenance --access public`. The npm CLI publishes, not pnpm: the tarballs are packed
 *    already (workspace:* replaced), npm is the reference implementation of provenance and of trusted publishing, and
 *    pnpm 12's publish turns provenance on only from its own --provenance flag, which changeset publish doesn't pass.
 *    Provenance needs GitHub Actions with id-token: write.
 * 2. Rate limits: a 429 from npm (E429 in its output) is retried after 30, 60, 120 and 240 s, and so is any registry
 *    answer other than 200 or 404; after the last retry the run fails. Publishes are 3 s apart.
 * 3. Every version is then checked the way the template's tools/verify-provenance.mjs checks it: npm's attestations
 *    (https://registry.npmjs.org/-/npm/v1/attestations/<name>@<version>, or the dist.attestations.url npm gives) hold
 *    a SLSA v1 provenance statement that names this repository and a workflow in .github/workflows/, and whose subject
 *    digest is the dist.integrity (sha512) npm serves. The registry can lag behind a publish, so versions this run
 *    published are polled for up to 2 minutes. The run fails listing every version without a valid attestation.
 *
 * --dry-run publishes nothing: it runs both checks for what is on npm and prints the npm publish command for the rest.
 * Node built-ins only. Network: registry.npmjs.org.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { REPO } from "./manifest.mjs";

export const REGISTRY = "https://registry.npmjs.org";
const ATTESTATIONS = `${REGISTRY}/-/npm/v1/attestations/`;
export const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
/** Seconds before each retry of a rate-limited publish or an unexpected registry answer. */
export const RETRY_DELAYS_S = [30, 60, 120, 240];
const PAUSE_S = 3;
const POLL_FOR_S = 120;
const POLL_EVERY_S = 10;
const RATE_LIMITED = /\bE429\b|\b429 Too Many Requests\b/;

/** Registry paths take a scoped name with its slash encoded: @coldai%2Fclip-wallet-core. */
const escaped = (name) => name.replaceAll("/", "%2F");
export const versionUrl = ({ name, version }) => `${REGISTRY}/${escaped(name)}/${version}`;
/** npm's attestations of a version: the dist.attestations.url of its version document (meta) on this registry, else built. */
export const attestationsUrl = ({ name, version }, meta) => {
  const given = meta?.dist?.attestations?.url;
  return typeof given === "string" && given.startsWith(ATTESTATIONS) ? given : `${ATTESTATIONS}${escaped(name)}@${version}`;
};
export const publishArgs = ({ file }) => ["publish", `.packs/${file}`, "--provenance", "--access", "public"];
const id = ({ name, version }) => `${name}@${version}`;

/** The tarballs pack-all wrote, each checked to be in .packs/. */
export function readManifest(root) {
  const manifest = join(root, ".packs", "manifest.json");
  if (!existsSync(manifest)) throw new Error(".packs/manifest.json is missing: run pnpm pack-all first.");
  return JSON.parse(readFileSync(manifest, "utf8")).map(({ name, version, file }) => {
    if (!name || !version || !file || !existsSync(join(root, ".packs", file))) {
      throw new Error(`.packs/manifest.json lists ${file ?? name}, which isn't in .packs/: run pnpm pack-all again.`);
    }
    return { name, version, file };
  });
}

/** GET a registry document: { status: 200, body } or { status: 404 }. Any other answer is retried, then thrown. */
async function getJson(url, io) {
  for (let retry = 0; ; retry++) {
    let answer;
    try {
      const res = await io.fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) return { status: 200, body: await res.json() };
      if (res.status === 404) return { status: 404 };
      answer = `HTTP ${res.status}`;
    } catch (e) {
      answer = e.message;
    }
    if (retry === RETRY_DELAYS_S.length) throw new Error(`GET ${url}: ${answer}, still after ${retry} retries.`);
    io.log(`    GET ${url}: ${answer}; retry ${retry + 1}/${RETRY_DELAYS_S.length} in ${RETRY_DELAYS_S[retry]} s`);
    await io.sleep(RETRY_DELAYS_S[retry] * 1000);
  }
}

/** npm publish one tarball. A 429 is retried with backoff; any other failure fails the run. */
async function publishTarball(entry, io) {
  for (let retry = 0; ; retry++) {
    const { code, output } = await io.exec("npm", publishArgs(entry));
    if (code === 0) return;
    if (!RATE_LIMITED.test(output)) throw new Error(`npm publish .packs/${entry.file} failed (exit code ${code}); npm's output is above.`);
    if (retry === RETRY_DELAYS_S.length) throw new Error(`npm publish .packs/${entry.file}: rate limited (429) after ${retry} retries.`);
    io.log(`    rate limited (429); retry ${retry + 1}/${RETRY_DELAYS_S.length} in ${RETRY_DELAYS_S[retry]} s`);
    await io.sleep(RETRY_DELAYS_S[retry] * 1000);
  }
}

/**
 * Whether npm holds the provenance this release workflow publishes for a version, parsed the way the template's
 * tools/verify-provenance.mjs parses it. meta is the registry's version document and attestations its attestations
 * document (each missing when the registry answered 404). Returns { ok: "<repository>/<workflow>@<ref>" } or { problem }.
 */
export function provenanceCheck(entry, meta, attestations, repo = REPO) {
  if (!meta) return { problem: `${id(entry)} isn't on npm` };
  const prov = attestations?.attestations?.find((a) => a.predicateType === SLSA_PROVENANCE_V1);
  if (!prov) return { problem: `${id(entry)} has no SLSA provenance attestation` };
  let statement = {};
  try {
    statement = JSON.parse(Buffer.from(prov.bundle?.dsseEnvelope?.payload ?? "", "base64").toString("utf8")) ?? {};
  } catch {
    // An unreadable statement names no repository, which is reported next.
  }
  const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow ?? {};
  const built = String(workflow.repository ?? "").replace(/\/$/, "");
  if (built !== repo) return { problem: `${id(entry)} was built from ${built || "an unknown repository"}, not ${repo}` };
  if (!String(workflow.path ?? "").startsWith(".github/workflows/")) return { problem: `${id(entry)}: the provenance names no workflow in .github/workflows/` };
  const integrity = String(meta.dist?.integrity ?? "");
  const expected = integrity.startsWith("sha512-") ? Buffer.from(integrity.slice(7), "base64").toString("hex") : undefined;
  const digest = statement.subject?.[0]?.digest?.sha512;
  if (!digest || digest !== expected) return { problem: `${id(entry)}: the attested tarball digest doesn't match the dist.integrity npm serves` };
  return { ok: `${built}/${workflow.path}@${workflow.ref ?? "?"}` };
}

/**
 * Publish every version that isn't on npm, then check the provenance of every version on npm. Returns the problems
 * (none: every version is published with a valid attestation); throws when a publish fails or the registry keeps
 * failing. io holds what reaches outside (fetch, exec, sleep, now, log, error), so tests can replace it.
 */
export async function release(list, { dryRun = false, io, repo = REPO }) {
  io.log(`${dryRun ? "Dry run, nothing is published: " : ""}${list.length} tarballs in .packs/manifest.json, registry ${REGISTRY}`);
  const onNpm = [];
  const published = new Set();
  for (const entry of list) {
    if ((await getJson(versionUrl(entry), io)).status === 200) {
      io.log(`  skip     ${id(entry)} (already on npm)`);
      onNpm.push(entry);
    } else if (dryRun) {
      io.log(`  publish  ${id(entry)}: would run npm ${publishArgs(entry).join(" ")}`);
    } else {
      if (published.size) await io.sleep(PAUSE_S * 1000);
      io.log(`  publish  ${id(entry)}: npm ${publishArgs(entry).join(" ")}`);
      await publishTarball(entry, io);
      published.add(id(entry));
      onNpm.push(entry);
    }
  }

  io.log(`Checking the provenance of ${onNpm.length} version${onNpm.length === 1 ? "" : "s"} on npm against ${repo}`);
  const deadline = io.now() + POLL_FOR_S * 1000;
  const problems = [];
  for (const entry of onNpm) {
    let result;
    for (;;) {
      const meta = (await getJson(versionUrl(entry), io)).body;
      result = provenanceCheck(entry, meta, meta && (await getJson(attestationsUrl(entry, meta), io)).body, repo);
      // Only a version this run published can still be on its way through the registry.
      if (result.ok || !published.has(id(entry)) || io.now() >= deadline) break;
      await io.sleep(Math.min(POLL_EVERY_S * 1000, deadline - io.now()));
    }
    if (result.ok) io.log(`  ok  ${id(entry)}  ${result.ok}`);
    else problems.push(result.problem);
  }

  if (problems.length) {
    io.error(`\n${problems.map((p) => `FAIL ${p}`).join("\n")}`);
    io.error(`\npublish: ${problems.length} of ${onNpm.length} versions on npm have no valid provenance attestation.`);
  } else if (dryRun) {
    io.log(`publish --dry-run: ${list.length - onNpm.length} to publish, ${onNpm.length} already on npm with a valid provenance attestation (nothing published)`);
  } else {
    io.log(`publish: ${published.size} published, ${onNpm.length - published.size} already on npm; every one has a valid provenance attestation`);
  }
  return problems;
}

/** Runs a command in cwd and passes its output through; resolves with the exit code and the output. */
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const tee = (stream) => (chunk) => {
      output += chunk;
      stream.write(chunk);
    };
    child.stdout.on("data", tee(process.stdout));
    child.stderr.on("data", tee(process.stderr));
    child.on("error", (e) => {
      process.stderr.write(`${cmd}: ${e.message}\n`);
      resolve({ code: 1, output: `${output}${e.message}\n` });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const io = {
    fetch: (url, init) => fetch(url, init),
    exec: (cmd, cmdArgs) => run(cmd, cmdArgs, root),
    sleep: (ms) => delay(ms),
    now: () => Date.now(),
    log: (line) => process.stdout.write(`${line}\n`),
    error: (line) => process.stderr.write(`${line}\n`),
  };
  try {
    const unknown = args.filter((a) => a !== "--dry-run");
    if (unknown.length) throw new Error(`unknown argument ${unknown.join(" ")} (the only option is --dry-run)`);
    const problems = await release(readManifest(root), { dryRun: args.includes("--dry-run"), io });
    process.exitCode = problems.length ? 1 : 0;
  } catch (e) {
    process.stderr.write(`\npublish: ${e.message}\n`);
    process.exitCode = 1;
  }
}
