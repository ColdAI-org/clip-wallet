import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";
import { nav, sidebar } from "./sidebar";
import { site } from "./site";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * `[text](repo:path/in/the/repo)` links to a file or folder in the repository. The build fails if the path does
 * not exist, so a renamed file can never leave a dead "view source" link behind.
 */
function repoLinks(md: { core: { ruler: { push(name: string, fn: (state: { tokens: Token[]; env: { relativePath?: string } }) => void): void } } }) {
  md.core.ruler.push("clip-repo-links", (state) => {
    const visit = (tokens: Token[]) => {
      for (const t of tokens) {
        if (t.children) visit(t.children);
        if (t.type !== "link_open") continue;
        const href = t.attrGet("href");
        if (!href?.startsWith("repo:")) continue;
        const [path, hash] = href.slice("repo:".length).split("#") as [string, string | undefined];
        const abs = repoRoot + path.replace(/^\/+/, "");
        if (!existsSync(abs)) throw new Error(`${state.env.relativePath ?? "?"}: repo link to a missing path: ${path}`);
        const kind = statSync(abs).isDirectory() ? "tree" : "blob";
        t.attrSet("href", `${site.repoUrl}/${kind}/${site.repoBranch}/${path.replace(/^\/+/, "").replace(/\/$/, "")}${hash ? `#${hash}` : ""}`);
        t.attrSet("target", "_blank");
        t.attrSet("rel", "noreferrer");
      }
    };
    visit(state.tokens);
  });
}
interface Token {
  type: string;
  children: Token[] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}

export default withMermaid(
  defineConfig({
    title: "Clip Wallet Docs",
    titleTemplate: ":title · Clip Wallet Docs",
    description: "Developer documentation for Clip Wallet: connect your dapp, launch your own wallet on the kit, and extend it.",
    lang: "en-GB",
    base: site.base,
    srcDir: "src",
    srcExclude: ["snippets/**", "**/README.md"],
    cleanUrls: false,
    lastUpdated: false,
    appearance: true,
    ignoreDeadLinks: false,
    ...(site.siteUrl ? { sitemap: { hostname: `${site.siteUrl}${site.base}` } } : {}),
    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: `${site.base}brand/clip-mark.svg` }],
      ["meta", { name: "theme-color", content: "#FF3C00" }],
      ["meta", { property: "og:title", content: "Clip Wallet Docs" }],
      ["meta", { property: "og:description", content: "Connect your dapp, launch your own wallet, extend Clip." }],
    ],
    markdown: {
      theme: { light: "github-light", dark: "github-dark" },
      lineNumbers: false,
      config: (md) => repoLinks(md as never),
    },
    themeConfig: {
      logo: { light: "/brand/clip-mark.svg", dark: "/brand/clip-mark.svg", alt: "Clip Wallet" },
      siteTitle: "Clip Docs",
      nav,
      sidebar: sidebar(),
      search: { provider: "local" },
      outline: { level: [2, 3], label: "On this page" },
      socialLinks: [{ icon: "github", link: site.repoUrl }],
      editLink: { pattern: `${site.repoUrl}/edit/${site.repoBranch}/apps/docs/src/:path`, text: "Suggest a change to this page" },
      footer: {
        message: 'Pre-release: test networks only. Built by <a href="https://coldai.org">ColdAI</a>.',
        copyright: "Clip Wallet and the Clip Wallet mark are ColdAI's.",
      },
      docFooter: { prev: "Previous", next: "Next" },
    },
    mermaid: { securityLevel: "strict" },
    vite: {
      // The search index and Mermaid are big; keep the warning for anything bigger than they are.
      build: { chunkSizeWarningLimit: 4096 },
    },
  }),
);
