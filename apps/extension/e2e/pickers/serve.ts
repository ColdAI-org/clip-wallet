/**
 * Builds and serves the stock-picker pages (dapps/src/<id>.tsx, package clip-picker-dapps, private). Each page gets
 * its own https origin, https://<id>.picker-dapp.example, so 1Mask injects there and every picker starts from a
 * site the wallet has never connected to. Everything else (testnet RPCs, wallet lists, icons) goes to the network.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { BrowserContext, Page } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "dapps/src");
// Under node_modules: third-party build output stays out of the harness scan and git.
const OUT = path.join(here, "dapps/node_modules/.cache/clip-picker-dapps");
export const PICKER_DOMAIN = "picker-dapp.example";
export const originOf = (id: string) => `https://${id}.${PICKER_DOMAIN}`;

/** Node built-ins some dapp libraries import but never use in a browser: an empty module, as bundlers do. */
const NODE_BUILTINS = /^(?:node:)?(?:crypto|stream|fs|fs\/promises|path|os|http|http2|https|zlib|url|util|net|tls|dns|tty|child_process|worker_threads|perf_hooks|vm|assert)$/;
const built = new Map<string, Promise<void>>();

export function buildPicker(id: string, define: { wcProjectId?: string } = {}): Promise<void> {
  let p = built.get(id);
  if (!p) {
    mkdirSync(OUT, { recursive: true });
    p = build({
      entryPoints: { [id]: path.join(SRC, `${id}.tsx`) },
      bundle: true,
      // Code splitting keeps each dynamic import() its own chunk, as a dapp's bundler does. Without it esbuild wraps
      // lazily imported modules, and wagmi's `export * from "viem/chains"` then hands RainbowKit an undefined chain.
      format: "esm",
      splitting: true,
      chunkNames: "chunks/[name]-[hash]",
      platform: "browser",
      target: "es2022",
      outdir: path.join(OUT, id),
      logLevel: "silent",
      jsx: "automatic",
      conditions: ["development", "browser"],
      loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".webp": "dataurl", ".gif": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl" },
      define: {
        "process.env.NODE_ENV": '"production"',
        global: "globalThis",
        "import.meta.env": "{}",
        // Only the Hedera page uses it (the WalletConnect relay needs a real project id); "" unless the spec passes one.
        __PICKER_WC_PROJECT_ID__: JSON.stringify(define.wcProjectId ?? ""),
      },
      inject: [path.join(here, "dapps/src/shims/node-globals.js")],
      plugins: [
        {
          // wagmi/chains is exactly `export * from "viem/chains"`. esbuild loses viem's lazy module init behind that
          // re-export (the chain objects come out undefined), so resolve it to viem/chains as the same objects.
          name: "wagmi-chains-is-viem-chains",
          setup(b) {
            b.onResolve({ filter: /^wagmi\/chains$/ }, (a) => b.resolve("viem/chains", { kind: a.kind, resolveDir: a.resolveDir }));
          },
        },
        {
          // libsodium-wrappers-sumo 0.7.16 (Mesh/cardano-sdk) ships an ESM entry that imports a file it doesn't
          // publish; dapps alias it to the package's CommonJS build, which is what this does.
          name: "libsodium-sumo-cjs",
          setup(b) {
            b.onResolve({ filter: /^libsodium-wrappers-sumo$/ }, (a) =>
              a.pluginData === "cjs" ? undefined : b.resolve("libsodium-wrappers-sumo", { kind: "require-call", resolveDir: a.resolveDir, pluginData: "cjs" }),
            );
          },
        },
        {
          // @hiero-ledger/sdk maps lib/index.js to lib/browser.js in its package.json "browser" field, which esbuild
          // doesn't apply through "exports"; without it the Node client (gRPC) lands in the page.
          name: "hiero-sdk-browser-entry",
          setup(b) {
            b.onResolve({ filter: /^@hiero-ledger\/sdk$/ }, async (a) => {
              if (a.pluginData === "hiero") return undefined;
              const r = await b.resolve(a.path, { kind: a.kind, resolveDir: a.resolveDir, pluginData: "hiero" });
              return r.errors.length ? r : { path: r.path.replace(/lib[\\/]index\.js$/, "lib/browser.js") };
            });
          },
        },
        {
          name: "empty-node-builtins",
          setup(b) {
            b.onResolve({ filter: NODE_BUILTINS }, (a) => ({ path: a.path, namespace: "empty-builtin" }));
            // CommonJS, so named imports (`import { pbkdf2Sync } from "crypto"`) resolve to undefined instead of failing the build.
            b.onLoad({ filter: /.*/, namespace: "empty-builtin" }, () => ({ contents: "module.exports = {};", loader: "js" }));
          },
        },
      ],
    }).then(() => undefined);
    built.set(id, p);
  }
  return p;
}

const page = (id: string, title: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  (existsSync(path.join(OUT, id, `${id}.css`)) ? `<link rel="stylesheet" href="/${id}.css">` : "") +
  `<style>body{font-family:system-ui,sans-serif;margin:16px}#account{font:12px monospace}</style></head>` +
  `<body><h1 style="font-size:16px">${title}</h1><div id="root"></div><script type="module" src="/${id}.js"></script></body></html>`;

/**
 * Serves picker `id` on its own origin. `extra` answers more paths on that origin (e.g. a TON Connect manifest).
 * Returns once the page has set window.__picker.
 */
export async function openPicker(
  context: BrowserContext,
  id: string,
  title: string,
  opts: { file?: string; query?: string; extra?: Record<string, { type: string; body: string | Buffer }>; wcProjectId?: string } = {},
): Promise<Page> {
  const file = opts.file ?? id;
  const extra = opts.extra ?? {};
  await buildPicker(file, opts.wcProjectId ? { wcProjectId: opts.wcProjectId } : {});
  const origin = originOf(id);
  await context.route(`${origin}/**`, (route) => {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: page(file, title) });
    const asset = path.join(OUT, file, path.normalize(url.pathname));
    if (asset.startsWith(path.join(OUT, file)) && /\.(?:js|css)$/.test(asset) && existsSync(asset)) {
      return route.fulfill({ contentType: asset.endsWith(".css") ? "text/css" : "text/javascript", body: readFileSync(asset, "utf8") });
    }
    const e = extra[url.pathname];
    if (e) return route.fulfill({ contentType: e.type, headers: cors, body: e.body });
    return route.fulfill({ status: 404, body: "" });
  });
  const p = await context.newPage();
  await p.setViewportSize({ width: 1100, height: 800 });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${origin}/${opts.query ? `?${opts.query}` : ""}`);
  await p.waitForFunction(() => !!(window as unknown as { __picker?: unknown }).__picker, undefined, { timeout: 45_000 }).catch(() => {
    throw new Error(`${id} picker page didn't start: ${errors.join(" | ") || "no page error"}`);
  });
  return p;
}
