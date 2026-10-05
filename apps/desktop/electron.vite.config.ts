/**
 * electron-vite build (https://electron-vite.org/config/): main process (ESM, everything bundled, workspace
 * packages are TypeScript sources), sandboxed preloads (CommonJS, one self-contained file each: a sandboxed preload
 * can't require chunks), and the renderer pages (wallet, approval, browser toolbar).
 *
 * Build-time switches (public values only; never secrets):
 *   CLIP_WC_PROJECT_ID   Reown project id for WalletConnect (unset: WalletConnect says it isn't switched on)
 *   CLIP_UPDATES=1       turn electron-updater on (only for signed release builds, see src/main/updater.ts)
 *   CLIP_EXTENSION_IDS   Chromium extension ids allowed to use Clip Desktop over native messaging (Firefox's is fixed)
 */
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// electron-vite 5's isolated-entries progress line calls process.stdout.clearLine/cursorTo, which exist only on a
// TTY (also moveCursor); in CI and piped builds they are missing and the preload build throws. No-ops keep the output plain.
const out = process.stdout as unknown as Record<string, unknown>;
out.clearLine ??= () => true;
out.cursorTo ??= () => true;
out.moveCursor ??= () => true;

const WC = JSON.stringify(process.env.CLIP_WC_PROJECT_ID?.trim() || "");
const UPDATES = JSON.stringify(process.env.CLIP_UPDATES === "1");
// Chromium extension ids the desktop trusts for native messaging (comma-separated; store ids + the dev id).
const EXTENSION_IDS = JSON.stringify(process.env.CLIP_EXTENSION_IDS?.trim() || "");
/**
 * Workspace packages export their TypeScript source under the "development" condition (dist/ is what npm users get);
 * this app bundles the source directly, like the extension and the phone (docs: tools/release, packages' exports).
 */
const NODE_CONDITIONS = ["development", "module", "node", "development|production"];
const BROWSER_CONDITIONS = ["development", "module", "browser", "development|production"];
const nodeResolve = { resolve: { conditions: NODE_CONDITIONS }, ssr: { resolve: { conditions: NODE_CONDITIONS, externalConditions: ["development", "node"] } } };

const empty = fileURLToPath(new URL("./src/renderer/shared/empty-module.ts", import.meta.url));

export default defineConfig({
  main: {
    ...nodeResolve,
    define: { __CLIP_WC_PROJECT_ID__: WC, __CLIP_UPDATES__: UPDATES, __CLIP_EXTENSION_IDS__: EXTENSION_IDS },
    build: {
      outDir: "out/main",
      externalizeDeps: false,
      target: "node22",
      sourcemap: false,
      rollupOptions: {
        input: { index: "src/main/index.ts" },
        external: ["electron", /^node:/],
        output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
      },
    },
  },
  preload: {
    ...nodeResolve,
    build: {
      outDir: "out/preload",
      externalizeDeps: false,
      isolatedEntries: true,
      sourcemap: false,
      rollupOptions: {
        input: { wallet: "src/preload/wallet.ts", dapp: "src/preload/dapp.ts" },
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "[name].cjs", inlineDynamicImports: true },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    publicDir: "public",
    plugins: [react()],
    define: { global: "globalThis", __CLIP_WC_PROJECT_ID__: WC },
    resolve: { conditions: BROWSER_CONDITIONS, alias: { crypto: empty, stream: empty } },
    build: {
      outDir: "out/renderer",
      target: "chrome140",
      sourcemap: false,
      rollupOptions: {
        input: {
          wallet: "src/renderer/wallet/index.html",
          approval: "src/renderer/approval/index.html",
          browser: "src/renderer/browser/index.html",
        },
      },
    },
  },
});
