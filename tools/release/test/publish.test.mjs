/**
 * tools/release/publish.mjs with the registry and the npm CLI replaced by fakes: what it skips, publishes, retries
 * and accepts as provenance.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REPO } from "../manifest.mjs";
import { RETRY_DELAYS_S, SLSA_PROVENANCE_V1, attestationsUrl, provenanceCheck, readManifest, release, versionUrl } from "../publish.mjs";

const core = { name: "@coldai/clip-wallet-core", version: "0.2.1", file: "coldai-clip-wallet-core-0.2.1.tgz" };
const cli = { name: "create-clip-wallet", version: "0.2.1", file: "create-clip-wallet-0.2.1.tgz" };

const sha512 = (bytes) => createHash("sha512").update(bytes).digest();
/** The registry's version document; the tarball's file name stands in for its bytes. */
const meta = (entry) => ({ name: entry.name, version: entry.version, dist: { integrity: `sha512-${sha512(entry.file).toString("base64")}` } });

/** npm's attestations document for a version, with the SLSA v1 statement npm publish --provenance writes. */
function attestations(entry, { repository = REPO, path = ".github/workflows/release.yml", digest = sha512(entry.file).toString("hex") } = {}) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: `pkg:npm/${entry.name.replace("@", "%40")}@${entry.version}`, digest: { sha512: digest } }],
    predicateType: SLSA_PROVENANCE_V1,
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: { ref: `refs/tags/v${entry.version}`, repository, path } },
      },
    },
  };
  const payload = Buffer.from(JSON.stringify(statement)).toString("base64");
  return {
    attestations: [
      { predicateType: "https://github.com/npm/attestation/tree/main/specs/publish/v0.1", bundle: { dsseEnvelope: { payload: "" } } },
      { predicateType: SLSA_PROVENANCE_V1, bundle: { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload } } },
    ],
  };
}

const ok = (body) => ({ status: 200, body });
const notFound = { status: 404 };
/** A version that is on npm with the given attestations (a good one by default). */
const onNpm = (entry, att = attestations(entry)) => ({ [versionUrl(entry)]: [ok(meta(entry))], [attestationsUrl(entry)]: [ok(att)] });
/** A version that isn't on npm until the fake npm publishes it. */
const toPublish = (entry, att = attestations(entry)) => ({ [versionUrl(entry)]: [notFound, ok(meta(entry))], [attestationsUrl(entry)]: [ok(att)] });

const rateLimited = {
  code: 1,
  output: "npm error code E429\nnpm error 429 Too Many Requests - PUT https://registry.npmjs.org/@coldai%2fclip-wallet-core\n",
};

/**
 * A fake registry and npm CLI. routes: url -> answers ({ status, body } or an Error) given in turn, the last one
 * repeating; other urls answer 404. npm: the result of each npm call in turn, then exit code 0. The clock moves only
 * when the code under test sleeps.
 */
function fakes(routes = {}, npm = []) {
  const calls = { fetch: [], npm: [], sleeps: [] };
  const lines = [];
  let clock = 0;
  const io = {
    fetch: async (url) => {
      calls.fetch.push(url);
      const answers = routes[url] ?? [notFound];
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return { status: answer.status, json: async () => answer.body };
    },
    exec: async (cmd, args) => {
      calls.npm.push([cmd, ...args].join(" "));
      return npm.shift() ?? { code: 0, output: "" };
    },
    sleep: async (ms) => {
      calls.sleeps.push(ms);
      clock += ms;
    },
    now: () => clock,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { io, calls, output: () => lines.join("\n") };
}

test("registry URLs: the scope's slash is encoded", () => {
  assert.equal(versionUrl(core), "https://registry.npmjs.org/@coldai%2Fclip-wallet-core/0.2.1");
  assert.equal(attestationsUrl(core), "https://registry.npmjs.org/-/npm/v1/attestations/@coldai%2Fclip-wallet-core@0.2.1");
  assert.equal(versionUrl(cli), "https://registry.npmjs.org/create-clip-wallet/0.2.1");
});

test("skips a version that is on npm, and checks its attestation", async () => {
  const f = fakes(onNpm(core));
  assert.deepEqual(await release([core], { io: f.io }), []);
  assert.deepEqual(f.calls.npm, []);
  assert.match(f.output(), /skip +@coldai\/clip-wallet-core@0\.2\.1 \(already on npm\)/);
  assert.match(f.output(), /ok +@coldai\/clip-wallet-core@0\.2\.1 +https:\/\/github\.com\/ColdAI-org\/clip-wallet\/\.github\/workflows\/release\.yml@refs\/tags\/v0\.2\.1/);
});

test("publishes a version that isn't on npm with npm publish --provenance --access public, 3 s apart", async () => {
  const f = fakes({ ...toPublish(core), ...toPublish(cli) });
  assert.deepEqual(await release([core, cli], { io: f.io }), []);
  assert.deepEqual(f.calls.npm, [
    "npm publish .packs/coldai-clip-wallet-core-0.2.1.tgz --provenance --access public",
    "npm publish .packs/create-clip-wallet-0.2.1.tgz --provenance --access public",
  ]);
  assert.deepEqual(f.calls.sleeps, [3000]);
  assert.match(f.output(), /publish: 2 published, 0 already on npm; every one has a valid provenance attestation/);
});

test("a rate-limited publish (429) is retried with backoff until it goes through", async () => {
  const f = fakes(toPublish(core), [rateLimited, rateLimited]);
  assert.deepEqual(await release([core], { io: f.io }), []);
  assert.equal(f.calls.npm.length, 3);
  assert.deepEqual(f.calls.sleeps, [30_000, 60_000]);
});

test("a publish still rate limited after the last retry fails the run", async () => {
  const f = fakes(toPublish(core), Array(RETRY_DELAYS_S.length + 1).fill(rateLimited));
  await assert.rejects(release([core, cli], { io: f.io }), /npm publish \.packs\/coldai-clip-wallet-core-0\.2\.1\.tgz: rate limited \(429\) after 4 retries/);
  assert.equal(f.calls.npm.length, 5);
  assert.deepEqual(f.calls.sleeps, [30_000, 60_000, 120_000, 240_000]);
  assert.ok(!f.calls.fetch.includes(versionUrl(cli)), "the run stops at the failed publish");
});

test("any other npm error fails the run at once", async () => {
  const forbidden = { code: 1, output: "npm error code E403\nnpm error 403 Forbidden - PUT https://registry.npmjs.org/@coldai%2fclip-wallet-core\n" };
  const f = fakes(toPublish(core), [forbidden]);
  await assert.rejects(release([core, cli], { io: f.io }), /npm publish \.packs\/coldai-clip-wallet-core-0\.2\.1\.tgz failed \(exit code 1\)/);
  assert.equal(f.calls.npm.length, 1);
  assert.deepEqual(f.calls.sleeps, []);
  assert.ok(!f.calls.fetch.includes(versionUrl(cli)), "the run stops at the failed publish");
});

test("a registry answer other than 200 or 404 is retried, and fails the run after the last retry", async () => {
  const flaky = fakes({ [versionUrl(core)]: [{ status: 503 }, new Error("fetch failed"), notFound, ok(meta(core))], [attestationsUrl(core)]: [ok(attestations(core))] });
  assert.deepEqual(await release([core], { io: flaky.io }), []);
  assert.deepEqual(flaky.calls.sleeps, [30_000, 60_000]);
  assert.equal(flaky.calls.npm.length, 1);

  const down = fakes({ [versionUrl(core)]: [{ status: 503 }] });
  await assert.rejects(release([core], { io: down.io }), /GET https:\/\/registry\.npmjs\.org\/@coldai%2Fclip-wallet-core\/0\.2\.1: HTTP 503, still after 4 retries/);
  assert.equal(down.calls.fetch.length, 5);
  assert.deepEqual(down.calls.npm, []);
});

test("the attestation check: a good one passes; a missing one, another repository, no workflow and another digest fail", () => {
  const m = meta(core);
  assert.deepEqual(provenanceCheck(core, m, attestations(core)), { ok: `${REPO}/.github/workflows/release.yml@refs/tags/v0.2.1` });
  const problem = (att, metaDoc = m) => provenanceCheck(core, metaDoc, att).problem;
  assert.match(problem(undefined), /^@coldai\/clip-wallet-core@0\.2\.1 has no SLSA provenance attestation$/);
  assert.match(problem({ attestations: [] }), /has no SLSA provenance attestation/);
  const v02 = attestations(core).attestations.map((a) => ({ ...a, predicateType: a.predicateType.replace(/\/v1$/, "/v0.2") }));
  assert.match(problem({ attestations: v02 }), /has no SLSA provenance attestation/);
  assert.match(problem(attestations(core, { repository: "https://github.com/someone/clip-wallet" })), /was built from https:\/\/github\.com\/someone\/clip-wallet, not https:\/\/github\.com\/ColdAI-org\/clip-wallet$/);
  assert.match(problem(attestations(core, { path: "" })), /names no workflow in \.github\/workflows\//);
  assert.match(problem(attestations(core, { path: "release.yml" })), /names no workflow in \.github\/workflows\//);
  assert.match(problem(attestations(core, { digest: sha512("another tarball").toString("hex") })), /the attested tarball digest doesn't match the dist\.integrity npm serves/);
  assert.match(problem(attestations(core), { ...m, dist: { integrity: `sha512-${sha512("another tarball").toString("base64")}` } }), /digest doesn't match/);
  assert.match(problem(attestations(core), null), /isn't on npm/);
});

test("the run fails listing every version without a valid attestation", async () => {
  const f = fakes({ ...onNpm(core, attestations(core, { repository: "https://github.com/someone/clip-wallet" })), [versionUrl(cli)]: [ok(meta(cli))] });
  const problems = await release([core, cli], { io: f.io });
  assert.deepEqual(problems, [
    "@coldai/clip-wallet-core@0.2.1 was built from https://github.com/someone/clip-wallet, not https://github.com/ColdAI-org/clip-wallet",
    "create-clip-wallet@0.2.1 has no SLSA provenance attestation",
  ]);
  assert.match(f.output(), /^FAIL @coldai\/clip-wallet-core@0\.2\.1 was built from/m);
  assert.match(f.output(), /^FAIL create-clip-wallet@0\.2\.1 has no SLSA provenance attestation/m);
  assert.match(f.output(), /publish: 2 of 2 versions on npm have no valid provenance attestation/);
  assert.deepEqual(f.calls.sleeps, [], "versions that were on npm before the run are checked once");
});

test("a version this run published is polled while the registry catches up, for up to 2 minutes", async () => {
  const lagging = fakes({ [versionUrl(core)]: [notFound, notFound, ok(meta(core))], [attestationsUrl(core)]: [notFound, ok(attestations(core))] });
  assert.deepEqual(await release([core], { io: lagging.io }), []);
  assert.deepEqual(lagging.calls.sleeps, [10_000, 10_000]);

  const never = fakes({ [versionUrl(core)]: [notFound, ok(meta(core))] });
  assert.deepEqual(await release([core], { io: never.io }), ["@coldai/clip-wallet-core@0.2.1 has no SLSA provenance attestation"]);
  assert.equal(never.calls.sleeps.reduce((a, b) => a + b, 0), 120_000);
});

test("the attestations are read from the dist.attestations.url npm gives, when it is on the registry", async () => {
  const given = "https://registry.npmjs.org/-/npm/v1/attestations/@coldai%2fclip-wallet-core@0.2.1";
  const m = meta(core);
  const withUrl = { ...m, dist: { ...m.dist, attestations: { url: given, provenance: { predicateType: SLSA_PROVENANCE_V1 } } } };
  assert.equal(attestationsUrl(core, withUrl), given);
  assert.equal(attestationsUrl(core, { dist: { attestations: { url: "https://example.org/-/npm/v1/attestations/x@1.0.0" } } }), attestationsUrl(core));
  const f = fakes({ [versionUrl(core)]: [ok(withUrl)], [given]: [ok(attestations(core))] });
  assert.deepEqual(await release([core], { io: f.io }), []);
  assert.ok(f.calls.fetch.includes(given));
  assert.ok(!f.calls.fetch.includes(attestationsUrl(core)));
});

test("--dry-run publishes nothing: it checks what is on npm and prints the npm publish command for the rest", async () => {
  const f = fakes(onNpm(core));
  assert.deepEqual(await release([core, cli], { dryRun: true, io: f.io }), []);
  assert.deepEqual(f.calls.npm, []);
  assert.deepEqual(f.calls.sleeps, []);
  assert.match(f.output(), /publish +create-clip-wallet@0\.2\.1: would run npm publish \.packs\/create-clip-wallet-0\.2\.1\.tgz --provenance --access public/);
  assert.ok(f.calls.fetch.includes(attestationsUrl(core)));
  assert.ok(!f.calls.fetch.includes(attestationsUrl(cli)));
  assert.match(f.output(), /publish --dry-run: 1 to publish, 1 already on npm with a valid provenance attestation \(nothing published\)/);

  // What is on npm without an attestation fails the dry run too, without waiting.
  const g = fakes({ [versionUrl(core)]: [ok(meta(core))] });
  assert.deepEqual(await release([core], { dryRun: true, io: g.io }), ["@coldai/clip-wallet-core@0.2.1 has no SLSA provenance attestation"]);
  assert.deepEqual(g.calls.npm, []);
  assert.deepEqual(g.calls.sleeps, []);
});

test("reads .packs/manifest.json and refuses a tarball that isn't in .packs/", () => {
  const dir = mkdtempSync(join(tmpdir(), "clip-publish-"));
  try {
    assert.throws(() => readManifest(dir), /\.packs\/manifest\.json is missing: run pnpm pack-all first/);
    mkdirSync(join(dir, ".packs"));
    writeFileSync(join(dir, ".packs", "manifest.json"), JSON.stringify([{ ...core, kB: 312 }, { ...cli, kB: 283 }]));
    writeFileSync(join(dir, ".packs", core.file), "");
    assert.throws(() => readManifest(dir), /lists create-clip-wallet-0\.2\.1\.tgz, which isn't in \.packs\//);
    writeFileSync(join(dir, ".packs", cli.file), "");
    assert.deepEqual(readManifest(dir), [core, cli]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
