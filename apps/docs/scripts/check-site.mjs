#!/usr/bin/env node
/**
 * Checks the built site (.vitepress/dist) and the page sources:
 *
 *   links    every internal href/src resolves to a file in the build, and every #anchor exists on its page;
 *            links into the repository (DOCS_REPO_URL/blob|tree|edit/<branch>/<path>) name a path that exists;
 *            with --external, every other external link answers (HEAD, then GET) with a non-error status.
 *   safety   nothing that must never be published: local paths, private keys, secrets, recovery phrases, deployment
 *            hosts of a person's own account, or wording about CLPR verifier internals.
 *   mainnet  a source page that shows how to switch mainnet on also carries a danger or warning box.
 *
 *   node scripts/check-site.mjs [--external]
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..");
const root = join(docs, "..", "..");
const dist = join(docs, ".vitepress", "dist");
const src = join(docs, "src");

const base = (() => {
  const v = (process.env.DOCS_BASE ?? "/clip/docs/").trim() || "/";
  const lead = v.startsWith("/") ? v : `/${v}`;
  return lead.endsWith("/") ? lead : `${lead}/`;
})();
const repoUrl = (process.env.DOCS_REPO_URL ?? "https://github.com/ColdAI-org/clip-wallet").replace(/\/+$/, "");
const external = process.argv.includes("--external");

const problems = [];
const walk = (dir, keep, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
};

if (!existsSync(dist)) {
  console.error("check-site: no build in .vitepress/dist; run pnpm --filter docs build");
  process.exit(1);
}

/* ------------------------------------------------------------------ links */

const htmlFiles = walk(dist, (f) => f.endsWith(".html"));
const idsByFile = new Map();
const idsOf = (file) => {
  if (!idsByFile.has(file)) {
    const html = readFileSync(file, "utf8");
    idsByFile.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsByFile.get(file);
};

/** The built file an internal URL path points at, or undefined. */
function resolveInternal(pathname) {
  if (!pathname.startsWith(base)) return undefined;
  let rel = decodeURIComponent(pathname.slice(base.length));
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const candidates = [rel, `${rel}.html`, join(rel, "index.html")];
  for (const c of candidates) {
    const f = join(dist, c);
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return undefined;
}

const externalLinks = new Map(); // url → first page that has it
let internalCount = 0;
let repoCount = 0;

for (const file of htmlFiles) {
  const page = `${base}${relative(dist, file)}`;
  const html = readFileSync(file, "utf8");
  // Only real links and assets: <a href>, <link href>, <script src>, <img src>. Code blocks are escaped text.
  for (const m of html.matchAll(/<(a|link|script|img)\b[^>]*?\s(href|src)="([^"]*)"/g)) {
    const url = m[3].replace(/&amp;/g, "&");
    if (!url || url.startsWith("mailto:") || url.startsWith("data:") || url.startsWith("javascript:")) continue;
    if (/^https?:\/\//.test(url)) {
      if (url.startsWith(`${repoUrl}/`)) {
        repoCount++;
        const rm = new RegExp(`^${repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:blob|tree|edit)/[^/]+/([^#?]+)`).exec(url);
        if (!rm) continue; // the repository's home page
        const path = decodeURIComponent(rm[1]).replace(/#L\d+.*$/, "");
        // Edit links point at page sources, which exist for every non-generated page.
        if (!existsSync(join(root, path))) problems.push(`link: ${page} → ${url}: ${path} isn't in the repository`);
        continue;
      }
      if (!externalLinks.has(url)) externalLinks.set(url, page);
      continue;
    }
    if (url.startsWith("//")) continue;
    internalCount++;
    const target = new URL(url, `https://site.invalid${page.replace(/\\/g, "/")}`);
    const pathname = target.pathname;
    const hash = target.hash ? decodeURIComponent(target.hash.slice(1)) : "";
    const resolved = pathname === page && hash ? file : resolveInternal(pathname);
    if (!resolved) {
      problems.push(`link: ${page} → ${url}: no such page or file`);
      continue;
    }
    if (hash && resolved.endsWith(".html") && !idsOf(resolved).has(hash)) problems.push(`link: ${page} → ${url}: no #${hash} on that page`);
  }
}

if (external) {
  const urls = [...externalLinks.keys()];
  const check = async (url) => {
    for (const method of ["HEAD", "GET"]) {
      try {
        const res = await fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "clip-docs-link-check" } });
        if (res.status < 400 || res.status === 429 || res.status === 403) return null;
        if (method === "GET") return `${res.status}`;
      } catch (e) {
        if (method === "GET") return String(e.cause?.code ?? e.name);
      }
    }
    return null;
  };
  const results = [];
  for (let i = 0; i < urls.length; i += 8) results.push(...(await Promise.all(urls.slice(i, i + 8).map(async (u) => [u, await check(u)]))));
  for (const [u, err] of results) if (err) problems.push(`external: ${externalLinks.get(u)} → ${u}: ${err}`);
}

/* ------------------------------------------------------------------ safety */

const wordlist = (() => {
  const pnpm = join(root, "node_modules", ".pnpm");
  for (const d of existsSync(pnpm) ? readdirSync(pnpm) : []) {
    if (!d.startsWith("@scure+bip39@")) continue;
    const f = join(pnpm, d, "node_modules/@scure/bip39/wordlists/english.js");
    if (!existsSync(f)) continue;
    const body = /`([a-z\n]+)`/.exec(readFileSync(f, "utf8"));
    if (body) return new Set(body[1].split("\n").filter(Boolean));
  }
  return undefined;
})();
if (!wordlist) problems.push("safety: the BIP-39 wordlist wasn't found, so phrases couldn't be checked");

const FORBIDDEN = [
  { re: /\/Users\/[A-Za-z]|\/home\/[a-z][\w-]*\/|[A-Z]:\\Users\\/, what: "a local path" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
  { re: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{10,}|\bre_[0-9A-Za-z]{16,}\b|\bghp_[0-9A-Za-z]{20,}|\bxox[abp]-[0-9A-Za-z-]{10,}/, what: "an API token" },
  { re: /\b(?:[A-Z][A-Z0-9_]*(?:SECRET|PEPPER|API_KEY|PRIVATE_KEY|MNEMONIC|TOKEN))\s*=\s*(?!<)[^\s<`'"]{8,}/, what: "a secret value" },
  // A real Worker host (placeholders use an "example" subdomain) or a Cloudflare account id: deployments are the
  // reader's own, so the docs only ever show placeholders.
  { re: /\b[a-z0-9-]+\.(?!example\.)[a-z0-9-]+\.workers\.dev\b|account[^\n]{0,40}\b[0-9a-f]{32}\b/i, what: "a real deployment's host or account id" },
  { re: /\battested\b|\bfinali[sz]ed\b|\bfinality\b|\bcheckpoints?\b|\breorg/i, what: "verifier wording that stays out of these docs" },
];
/**
 * Substrate's "finalized head" (a block-finality term in the chains-substrate API, nothing to do with CLPR verifiers)
 * is allowed; everything else the patterns match is a problem.
 */
const ALLOWED_CONTEXT = [/finalized head/i];
function allowed(first, text, re) {
  if (!first) return null;
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(global)) {
    const around = text.slice(Math.max(0, m.index - 20), m.index + 40);
    if (!ALLOWED_CONTEXT.some((a) => a.test(around))) return m;
  }
  return null;
}

/** The phrase check: 12+ consecutive BIP-39 words. */
function phraseIn(text) {
  if (!wordlist) return false;
  const words = text.toLowerCase().split(/[^a-z]+/);
  let run = 0;
  for (const w of words) {
    run = w && wordlist.has(w) && w.length >= 3 ? run + 1 : 0;
    if (run >= 12) return true;
  }
  return false;
}

/** Visible text and attribute values of a built page (scripts and the search index included: they ship too). */
const shipped = walk(dist, (f) => /\.(html|js|json|txt|xml|svg)$/.test(f));
for (const f of shipped) {
  const text = readFileSync(f, "utf8");
  const page = relative(dist, f);
  // Our words: the pages, their chunks, the search index. Everything else is framework and library code.
  const ours = /\.html$|\.md\.[\w-]+\.js$|\.md\.[\w-]+\.lean\.js$|localSearchIndex|hashmap\.json$/.test(page);
  const isBundle = !ours;
  for (const { re, what } of FORBIDDEN) {
    // Third-party bundles (Mermaid, Vue) aren't our words: scan them for secrets and paths only.
    // Third-party bundles aren't our words; the search index is built from pages already checked here, word by word,
    // so it loses the context ALLOWED_CONTEXT needs. Both are scanned for secrets and paths only.
    if ((isBundle || /localSearchIndex/.test(page)) && /verifier wording/.test(what)) continue;
    const m = allowed(re.exec(text), text, re);
    if (m) problems.push(`safety: ${page} contains ${what}: "${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")}"`);
  }
  if (ours && phraseIn(text.replace(/<[^>]+>/g, " "))) {
    problems.push(`safety: ${page} contains twelve or more BIP-39 words in a row`);
  }
}

/* ------------------------------------------------------------------ mainnet */

for (const f of walk(src, (p) => p.endsWith(".md") && !/reference\/api\/|testing\/results\//.test(p))) {
  const text = readFileSync(f, "utf8");
  const showsSwitch = /enabled:\s*true/.test(text) || /kit\/mainnet\.ts/.test(text);
  if (showsSwitch && !/^:::\s*(danger|warning)/m.test(text)) problems.push(`mainnet: ${relative(src, f)} shows how to switch mainnet on without a danger or warning box`);
}
const mainnetSnippet = readFileSync(join(src, "snippets/kit/mainnet.ts"), "utf8");
if (!/DANGER/.test(mainnetSnippet)) problems.push("mainnet: snippets/kit/mainnet.ts lost its DANGER comment");

/* ------------------------------------------------------------------ report */

console.log(
  `check-site: ${htmlFiles.length} pages, ${internalCount} internal links, ${repoCount} repository links, ${externalLinks.size} external links${external ? " (requested)" : " (not requested; --external)"}, ${shipped.length} files scanned`,
);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`check-site: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("check-site: no broken links, nothing unsafe");
