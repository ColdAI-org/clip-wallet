import { defineConfig } from "wxt";
import clipConfig from "./clip.config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { PASSKEY_BRIDGE_URL } from "./src/app-settings";
import { walletNetworks } from "./src/shared/catalog";
import { createTonModule } from "@clip-wallet/chains-ton";
import pkg from "./package.json" with { type: "json" };

/** Fixture mode: mock chains/1Mask/route/WalletConnect + dev simulator. Default: real packages. */
const MOCKS = process.env.CLIP_MOCKS === "1";
const CHANNEL = `clip-${randomUUID()}`;
const ICON = `data:image/svg+xml;base64,${readFileSync(new URL("./icon.svg", import.meta.url)).toString("base64")}`;
const PUBLIC_NETWORKS = walletNetworks(clipConfig).map((n) => ({ ...n, rpcUrls: n.rpcUrls.slice(0, 1) }));
/**
 * TON Connect JS bridge (window.clipwallet.tonconnect). key/appName must match the wallets-list draft
 * (docs/listings/ton-connect.md); features come from chains-ton for the vault's wallet version (v5r1).
 */
const TON_CONNECT = { key: "clipwallet", appName: "clipwallet", appVersion: pkg.version, features: createTonModule().features };

/** Feature partner keys from the build environment. Absent = that provider shows as "not switched on". */
const FEATURES = {
  testnet: !clipConfig.mainnet,
  swap: { zeroExApiKey: process.env.CLIP_0X_API_KEY || undefined, jupiterApiKey: process.env.CLIP_JUPITER_API_KEY || undefined },
  onramp: {
    moonpay:
      process.env.CLIP_MOONPAY_API_KEY && process.env.CLIP_MOONPAY_SIGNER_URL
        ? { apiKey: process.env.CLIP_MOONPAY_API_KEY, signerUrl: process.env.CLIP_MOONPAY_SIGNER_URL }
        : undefined,
    banxa: process.env.CLIP_BANXA_PARTNER ? { partner: process.env.CLIP_BANXA_PARTNER } : undefined,
    c14: process.env.CLIP_C14_CLIENT_ID ? { clientId: process.env.CLIP_C14_CLIENT_ID, assetIds: JSON.parse(process.env.CLIP_C14_ASSET_IDS || "{}") } : undefined,
  },
  coingeckoDemoKey: process.env.CLIP_COINGECKO_DEMO_KEY || undefined,
};

export default defineConfig({
  srcDir: "src",
  outDir: MOCKS ? ".output-fixtures" : ".output",
  // Explicit imports only. (`imports: false` still lets unimport's Vite plugin inject e.g. `storage` into
  // workspace packages like the vault, so auto-import is switched off at the plugin level too.)
  // @ts-expect-error autoImport is an unimport plugin option that WXT passes through but doesn't type.
  imports: { autoImport: false, eslintrc: { enabled: false } },
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser, manifestVersion }) => {
    const bridgeOrigin = new URL(PASSKEY_BRIDGE_URL).origin;
    const rp = clipConfig.passkeys.rpOrigin;
    const rpHost = rp?.startsWith("https://") ? [`${rp}/*`] : [];
    const csp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-src 'none'";
    return {
      name: clipConfig.name,
      description: "A calm, non-custodial wallet for every CLPR network. Test networks only.",
      permissions: ["storage", "alarms"],
      // Koios (Cardano) is CORS-restricted on its public tier, so the background needs host access.
      host_permissions: [
        ...rpHost,
        "https://*.koios.rest/*",
        "https://api.coingecko.com/*",
        "https://api.jup.ag/*",
        "https://api.0x.org/*",
        // Phase 2.5 swap APIs (docs/phase25/integration/stake-swap.md).
        "https://agg-api.minswap.org/*",
        "https://aftermath.finance/*",
        "https://api.hyperion.xyz/*",
        "https://api-testnet.hyperion.xyz/*",
        "https://starknet.api.avnu.fi/*",
        "https://sepolia.api.avnu.fi/*",
        "https://api.ston.fi/*",
        "https://smartrouter.ref.finance/*",
        // Optional hosted services from clip.config (unset by default).
        ...[clipConfig.services.backupUrl, clipConfig.services.mediaProxyUrl].filter((u): u is string => !!u).map((u) => `${new URL(u).origin}/*`),
      ],
      action: { default_title: clipConfig.name },
      icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
      // Argon2id (hash-wasm) needs WebAssembly; nothing else is relaxed. No remote code, no frames.
      content_security_policy: manifestVersion === 3 ? { extension_pages: csp } : (csp as unknown as never),
      // Lets the passkey web-bridge page hand back a PRF result (Chromium; Firefox lacks externally_connectable).
      ...(browser !== "firefox" ? { externally_connectable: { matches: [`${bridgeOrigin}/*`] } } : {}),
      ...(browser === "firefox" ? { browser_specific_settings: { gecko: { id: `wallet@${clipConfig.rdns.split(".").reverse().join(".")}`, strict_min_version: "128.0" } } } : {}),
    };
  },
  vite: () => ({
    define: {
      // Some chain deps (a TextEncoder polyfill pulled in by the Phase 2 families) read `window` or Node's
      // `global` at load time; a service worker has neither, so the background died before main().
      global: "globalThis",
      __CLIP_MOCKS__: JSON.stringify(MOCKS),
      __CLIP_CHANNEL__: JSON.stringify(CHANNEL),
      __CLIP_PUBLIC_NETWORKS__: JSON.stringify(PUBLIC_NETWORKS),
      __CLIP_IDENTITY__: JSON.stringify({ name: clipConfig.name, icon: ICON, rdns: clipConfig.rdns }),
      __CLIP_TON_CONNECT__: JSON.stringify(TON_CONNECT),
      __CLIP_FEATURES__: JSON.stringify(FEATURES),
    },
    resolve: {
      alias: {
        // hdkey (Keystone's bc-ur-registry-eth) requires Node's crypto/stream for code paths we never call.
        crypto: fileURLToPath(new URL("./src/shared/empty-module.ts", import.meta.url)),
        stream: fileURLToPath(new URL("./src/shared/empty-module.ts", import.meta.url)),
      },
    },
    build: { target: "es2022" },
  }),
});
