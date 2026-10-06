/**
 * The API reference: TypeDoc over every export of every published package (packages/*, not private), rendered to
 * VitePress Markdown by typedoc-plugin-markdown + typedoc-vitepress-theme into src/reference/api.
 *
 * One module per package export, named by its import path ("@clip-wallet/connect/react") and filed under
 * reference/api/<package>/<subpath>. The vendored CLPRouter planner internals in @clip-wallet/route are left out:
 * they are documented upstream in the CLPRouter SDK, and dapps and wallets use @clip-wallet/route's own API.
 */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { Application, Converter, ReflectionKind } from "typedoc";

/** Packages documented by their own pages instead (a CLI). */
const SKIP_PACKAGES = new Set(["create-clip-wallet"]);
/** Source files whose declarations stay out of the reference (see the header). */
const OMIT_SOURCES = [/packages\/route\/src\/vendor\//];
/** Exports omitted by name, as "<module>#<name>". */
const OMIT_EXPORTS = new Set(["@clip-wallet/config#TRUST_TIERS", "@clip-wallet/route#TrustTier"]);

/**
 * Wording the reference renders differently from the source comments. The trust-tier union is shown by its name
 * (route's TrustTier) wherever the config's inferred type spells it out; WalletConnect Verify's confirmed origin is
 * called that.
 */
const REWORD = [
  [/`"attested"` \\\| `"committee"` \\\| `"light-client"` \\\| `"validity-proof"`/g, "`TrustTier`"],
  [/"attested" \| "committee" \| "light-client" \| "validity-proof"/g, "TrustTier"],
  [/ZodEnum<\{\s*attested: \.\.\.;\s*committee: \.\.\.;\s*light-client: \.\.\.;\s*validity-proof: \.\.\.;\s*\}>/g, "ZodEnum<TrustTier>"],
  [/Verify-attested/g, "Verify-confirmed"],
];

const posix = (p) => p.split(sep).join("/");

/**
 * In a GFM table row a `|` splits the cell even inside a code span, so a comment like `kind=image|video` breaks the
 * table (and lets `<placeholders>` escape the code span as HTML). Escape pipes inside code spans of table rows.
 */
export function escapeTablePipes(line) {
  if (!line.startsWith("|")) return line;
  let out = "";
  let inCode = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "`") inCode = !inCode;
    if (c === "|" && inCode && line[i - 1] !== "\\") out += "\\|";
    else out += c;
  }
  return out;
}

/**
 * typedoc-plugin-markdown's anchors don't always match the ids VitePress gives headings (it keeps `_`, VitePress
 * turns it into `-`; it numbers duplicates VitePress doesn't see). Render every page with VitePress's own Markdown
 * renderer, collect the real ids, and point each link at one that exists (or at the page, if none does).
 */
async function fixAnchors(files, srcDir) {
  const { createMarkdownRenderer } = await import("vitepress");
  const md = await createMarkdownRenderer(srcDir, {}, "/");
  const ids = new Map();
  const texts = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  for (const [f, text] of texts) {
    const html = md.render(text, { path: f, relativePath: posix(relative(srcDir, f)) });
    ids.set(posix(f), new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  let fixed = 0;
  for (const [f, text] of texts) {
    const next = text.replace(/\]\(([^)\s#]*)#([^)\s]+)\)/g, (whole, target, anchor) => {
      const file = target ? posix(join(dirname(f), target)) : posix(f);
      const have = ids.get(file);
      if (!have || have.has(anchor)) return whole;
      const hyphen = anchor.replace(/_/g, "-");
      for (const c of [hyphen, anchor.replace(/-\d+$/, ""), hyphen.replace(/-\d+$/, "")]) {
        if (have.has(c)) {
          fixed++;
          return `](${target}#${c})`;
        }
      }
      fixed++;
      return `](${target || `./${basename(f)}`})`;
    });
    if (next !== text) writeFileSync(f, next);
  }
  return fixed;
}

/** Every published export: { spec: "@clip-wallet/connect/react", file, slug: "connect/react" }. */
export function publishedEntries(root) {
  const out = [];
  for (const dir of readdirSync(join(root, "packages")).sort()) {
    const pjPath = join(root, "packages", dir, "package.json");
    if (!existsSync(pjPath)) continue;
    const pj = JSON.parse(readFileSync(pjPath, "utf8"));
    if (pj.private || SKIP_PACKAGES.has(pj.name)) continue;
    for (const [sub, target] of Object.entries(pj.exports ?? {})) {
      const rel = typeof target === "string" ? target : target.development;
      if (!rel || !/\.tsx?$/.test(rel)) continue;
      const short = pj.name.replace(/^@clip-wallet\//, "");
      const subpath = sub === "." ? "" : sub.slice(2);
      out.push({ spec: subpath ? `${pj.name}/${subpath}` : pj.name, file: join(root, "packages", dir, rel), slug: subpath ? `${short}/${subpath}` : short });
    }
  }
  return out;
}

export async function runTypedoc({ root, out }) {
  const entries = publishedEntries(root);
  const byFile = new Map(entries.map((e) => [posix(e.file), e]));
  rmSync(out, { recursive: true, force: true });

  const docsDir = join(out, "..", "..", "..");
  const repoUrl = (process.env.DOCS_REPO_URL ?? "https://github.com/ColdAI-org/clip-wallet").replace(/\/+$/, "");
  const branch = process.env.DOCS_REPO_BRANCH ?? "main";

  const app = await Application.bootstrapWithPlugins({
    entryPoints: entries.map((e) => e.file),
    entryPointStrategy: "resolve",
    tsconfig: join(docsDir, "typedoc.tsconfig.json"),
    plugin: ["typedoc-plugin-markdown", "typedoc-vitepress-theme"],
    out,
    docsRoot: join(docsDir, "src"),
    name: "Clip Wallet API",
    readme: "none",
    skipErrorChecking: true,
    excludePrivate: true,
    excludeProtected: true,
    excludeInternal: true,
    excludeExternals: true,
    disableGit: true,
    sourceLinkTemplate: `${repoUrl}/blob/${branch}/{path}#L{line}`,
    displayBasePath: root,
    gitRevision: branch,
    outputFileStrategy: "modules",
    entryFileName: "index",
    hidePageHeader: true,
    hideBreadcrumbs: true,
    useCodeBlocks: true,
    expandObjects: false,
    parametersFormat: "table",
    interfacePropertiesFormat: "table",
    classPropertiesFormat: "table",
    enumMembersFormat: "table",
    typeDeclarationFormat: "table",
    propertyMembersFormat: "table",
    sanitizeComments: true,
    sidebar: { autoConfiguration: true, format: "vitepress", pretty: true, collapsed: true },
    logLevel: "Warn",
    validation: { notExported: false, invalidLink: false, rewrittenLink: false, unusedMergeModuleWith: false },
  });

  // Name each module by its import path and drop what the reference leaves out.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const project = context.project;
    for (const mod of [...(project.children ?? [])]) {
      const file = posix(mod.sources?.[0]?.fullFileName ?? "");
      const entry = byFile.get(file);
      if (!entry) continue;
      mod.name = entry.slug;
      // Each entry file's header comment carries @module, so TypeDoc makes it the module's description instead of
      // copying it onto the declarations the first export statement re-exports (test/typedoc.test.ts checks the tag).
    }
    for (const r of Object.values(project.reflections)) {
      if (!r.kindOf(ReflectionKind.SomeExport | ReflectionKind.SomeMember)) continue;
      const file = posix(r.sources?.[0]?.fullFileName ?? "");
      const mod = r.parent?.kindOf(ReflectionKind.Module) ? r.parent.name : undefined;
      const spec = mod ? (entries.find((e) => e.slug === mod)?.spec ?? mod) : undefined;
      if (OMIT_SOURCES.some((re) => re.test(file)) || (spec && OMIT_EXPORTS.has(`${spec}#${r.name}`))) project.removeReflection(r);
    }
  });

  const project = await app.convert();
  if (!project) throw new Error("typedoc: conversion failed");
  await app.generateOutputs(project);

  // Titles and sidebar entries show the import path; URLs stay short.
  const bySlug = new Map(entries.map((e) => [e.slug, e.spec]));
  const sidebarFile = join(out, "typedoc-sidebar.json");
  const sidebar = JSON.parse(readFileSync(sidebarFile, "utf8"));
  const relabel = (items) => {
    for (const it of items) {
      if (bySlug.has(it.text)) it.text = bySlug.get(it.text);
      if (it.items) relabel(it.items);
    }
    return items;
  };
  writeFileSync(sidebarFile, JSON.stringify(relabel(sidebar), null, 2));
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) files.push(p);
    }
  };
  walk(out);
  for (const f of files) {
    let text = readFileSync(f, "utf8");
    text = text.replace(/^# (.+)$/m, (whole, title) => (bySlug.has(title.trim()) ? `# ${bySlug.get(title.trim())}` : whole));
    for (const [from, to] of REWORD) text = text.replace(from, to);
    text = text.split("\n").map(escapeTablePipes).join("\n");
    writeFileSync(f, text);
  }
  const fixed = await fixAnchors(files, join(docsDir, "src"));
  console.log(`typedoc: ${entries.length} entry points, ${files.length} pages in ${posix(relative(docsDir, out))} (${fixed} anchors matched to VitePress ids)`);
  return { entries, pages: files.length };
}
