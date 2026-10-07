/**
 * The electron-vite config for a Clip Wallet desktop app, built from clip.config.ts:
 *
 *   // electron.vite.config.ts
 *   import { defineConfig } from "electron-vite";
 *   import { clipDesktop } from "@clip-wallet/desktop-kit/electron-vite";
 *   import clipConfig from "../../clip.config";
 *   export default defineConfig(clipDesktop({ config: clipConfig, root: import.meta.dirname, configDir: "../.." }));
 *
 * Builds the main process (ESM, everything bundled), the sandboxed preloads (CommonJS, one self-contained file each)
 * and the three renderer pages, and bundles the native-messaging host program next to them. Identity (name, icon,
 * rdns, app id, deep-link scheme) comes from clip.config.ts; a mainnet build is refused until mainnetProblems() is
 * empty and MAINNET.md has no open box. There is no option that lowers the security floor.
 *
 * Build-time switches (public values only; never secrets), from the environment or CLIP_* lines in .env:
 *   CLIP_WALLETCONNECT_PROJECT_ID   WalletConnect (Reown) project id (CLIP_WC_PROJECT_ID also works)
 *   CLIP_UPDATES=1                  turn electron-updater on (signed release builds only)
 *   CLIP_EXTENSION_IDS              Chromium extension ids allowed to use the app over native messaging
 * Runs in Node (electron-vite loads it).
 *
 * @module
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import type { ClipConfig } from "@clip-wallet/config";
import { buildEnv, iconDataUri, resolveBuildConfig } from "@clip-wallet/config/node";
import { walletCsp } from "@clip-wallet/desktop-kit/csp";

/** The virtual module the kit's main process, preloads and pages import the resolved clip.config from. */
export const CONFIG_MODULE = "virtual:clip-wallet/config";

export interface ClipDesktopOptions {
  /** The default export of clip.config.ts (already validated by defineConfig). */
  config: ClipConfig;
  /** The desktop project directory (src/, package.json, .env). Default: process.cwd(). */
  root?: string;
  /** Where clip.config.ts, its icon, MAINNET.md and the shared .env are, relative to root or absolute. Default: root. */
  configDir?: string;
  /** Build environment. Default: process.env plus CLIP_* values from .env in root and configDir. */
  env?: Record<string, string | undefined>;
  /**
   * Resolve workspace packages from their TypeScript source (the "development" export condition). Default: on when
   * Node runs with --conditions=development (the Clip Wallet monorepo sets it); off for installed packages.
   */
  sourceConditions?: boolean;
}

function devConditions(): boolean {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)];
  return flags.some((f, i) => /^(?:--conditions|-C)=development$/.test(f) || ((f === "--conditions" || f === "-C") && flags[i + 1] === "development"));
}

/** The resolved config and what the build defines from it (exported for tests). */
export function desktopBuildValues(options: ClipDesktopOptions) {
  const root = resolve(options.root ?? process.cwd());
  const configDir = resolve(root, options.configDir ?? ".");
  const env = options.env ?? buildEnv([root, configDir]);
  const config = resolveBuildConfig(options.config, env, { checklistDir: configDir, fallbackWcEnv: "CLIP_WC_PROJECT_ID" });
  const icon = iconDataUri(configDir, config.icon);
  return {
    root,
    configDir,
    config,
    icon,
    updates: env.CLIP_UPDATES === "1",
    extensionIds: env.CLIP_EXTENSION_IDS?.trim() || "",
    /** The wallet and approval windows' CSP (also sent as a header by the clip-app: protocol). */
    csp: walletCsp(config.services.mediaProxyUrl),
  };
}

/**
 * Bundle the native-messaging host program (one CommonJS file, Node built-ins only, run by the app's executable with
 * ELECTRON_RUN_AS_NODE=1) from the kit's "./native-host" entry.
 */
export async function buildNativeHost(root: string, outFile = join(root, "out", "native-host", "clip-native-host.cjs"), source = devConditions()): Promise<string> {
  const { build } = await import("esbuild");
  const req = createRequire(join(root, "package.json"));
  let entry: string;
  try {
    entry = req.resolve("@clip-wallet/desktop-kit/native-host");
  } catch {
    // The kit itself (its own tests, or a project that links it): the entry next to this file.
    const here = dirname(fileURLToPath(import.meta.url));
    entry = [join(here, "native-host", "main.ts"), join(here, "native-host", "main.js")].find((f) => existsSync(f)) ?? join(here, "native-host", "main.js");
  }
  mkdirSync(dirname(outFile), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    ...(source ? { conditions: ["development"] } : {}),
    platform: "node",
    format: "cjs",
    target: "node22",
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });
  return outFile;
}

const NODE_CONDITIONS = ["development", "module", "node", "development|production"];
const BROWSER_CONDITIONS = ["development", "module", "browser", "development|production"];

/** The electron-vite config (UserConfig). Typed loosely so the kit doesn't pin electron-vite's types. */
export function clipDesktop(options: ClipDesktopOptions) {
  const v = desktopBuildValues(options);
  const source = options.sourceConditions ?? devConditions();
  const EMPTY = "\0clip-wallet:empty-module";
  const configModule = `export default ${JSON.stringify(v.config)};\nexport const icon = ${JSON.stringify(v.icon)};\n`;
  const wc = JSON.stringify(v.config.walletConnect.projectId ?? "");

  /** The resolved clip.config as a virtual module; Node's crypto/stream (hdkey via Keystone) as empty modules. */
  const configPlugin = (renderer: boolean) => ({
    name: "clip-wallet:config",
    enforce: "pre" as const,
    resolveId(id: string) {
      if (id === CONFIG_MODULE) return `\0${CONFIG_MODULE}`;
      if (renderer && (id === "crypto" || id === "stream")) return EMPTY;
      return undefined;
    },
    load(id: string) {
      if (id === `\0${CONFIG_MODULE}`) return configModule;
      if (id === EMPTY) return "export default {};";
      return undefined;
    },
  });

  /** Pages: %CLIP_WALLET_NAME% (the wallet's name) and %CLIP_WALLET_CSP% (the CSP the clip-app: protocol also sends). */
  const htmlPlugin = {
    name: "clip-wallet:pages",
    transformIndexHtml(html: string) {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
      return html.replaceAll("%CLIP_WALLET_NAME%", esc(v.config.name)).replaceAll("%CLIP_WALLET_CSP%", esc(v.csp));
    },
  };

  /** After the main build: the native-messaging host program next to it. */
  const nativeHostPlugin = {
    name: "clip-wallet:native-host",
    apply: "build" as const,
    async closeBundle() {
      await buildNativeHost(v.root, undefined, source);
    },
  };

  const nodeResolve = source
    ? { resolve: { conditions: NODE_CONDITIONS }, ssr: { resolve: { conditions: NODE_CONDITIONS, externalConditions: ["development", "node"] } } }
    : {};

  return {
    main: {
      ...nodeResolve,
      plugins: [configPlugin(false), nativeHostPlugin],
      define: {
        __CLIP_WC_PROJECT_ID__: wc,
        __CLIP_UPDATES__: JSON.stringify(v.updates),
        __CLIP_EXTENSION_IDS__: JSON.stringify(v.extensionIds),
      },
      build: {
        outDir: "out/main",
        externalizeDeps: false,
        target: "node22",
        sourcemap: false,
        rollupOptions: {
          input: { index: join(v.root, "src/main/index.ts") },
          external: ["electron", /^node:/],
          output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
        },
      },
    },
    preload: {
      ...nodeResolve,
      plugins: [configPlugin(false)],
      build: {
        outDir: "out/preload",
        externalizeDeps: false,
        isolatedEntries: true,
        sourcemap: false,
        rollupOptions: {
          input: { wallet: join(v.root, "src/preload/wallet.ts"), dapp: join(v.root, "src/preload/dapp.ts") },
          external: ["electron"],
          output: { format: "cjs", entryFileNames: "[name].cjs", inlineDynamicImports: true },
        },
      },
    },
    renderer: {
      root: join(v.root, "src/renderer"),
      publicDir: "public",
      plugins: [configPlugin(true), htmlPlugin, react()],
      define: { global: "globalThis", __CLIP_WC_PROJECT_ID__: wc },
      ...(source ? { resolve: { conditions: BROWSER_CONDITIONS } } : {}),
      build: {
        outDir: join(v.root, "out/renderer"),
        emptyOutDir: true,
        target: "chrome140",
        sourcemap: false,
        rollupOptions: {
          input: {
            wallet: join(v.root, "src/renderer/wallet/index.html"),
            approval: join(v.root, "src/renderer/approval/index.html"),
            browser: join(v.root, "src/renderer/browser/index.html"),
          },
        },
      },
    },
  };
}
