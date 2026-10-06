/**
 * Where the docs are served and which repository they link to. Everything is configurable with environment
 * variables at build time, so the same sources build for coldai.org/clip/docs, a preview host or the site root.
 *
 *   DOCS_BASE        URL path the site is served under. Default "/clip/docs/". Use "/" to serve at the root.
 *   DOCS_SITE_URL    Origin for the sitemap and canonical links, e.g. "https://coldai.org". Optional.
 *   DOCS_REPO_URL    Repository the "view source" links point at. Default "https://github.com/ColdAI-org/clip-wallet".
 *   DOCS_REPO_BRANCH Branch for source links. Default "main".
 */
export function normalizeBase(raw: string | undefined): string {
  const value = (raw ?? "/clip/docs/").trim() || "/";
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export const site = {
  base: normalizeBase(process.env.DOCS_BASE),
  siteUrl: (process.env.DOCS_SITE_URL ?? "").replace(/\/+$/, ""),
  repoUrl: (process.env.DOCS_REPO_URL ?? "https://github.com/ColdAI-org/clip-wallet").replace(/\/+$/, ""),
  repoBranch: process.env.DOCS_REPO_BRANCH ?? "main",
};

/** A link to a file or folder in the repository. */
export function repoLink(path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `${site.repoUrl}/blob/${site.repoBranch}/${clean}`;
}
