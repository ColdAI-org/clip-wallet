import { defineConfig } from "wxt";
import clipConfig from "./clip.config";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { PASSKEY_BRIDGE_URL } from "./src/app-settings";
import { walletNetworks } from "./src/shared/catalog";
import { createTonModule } from "@clip-wallet/chains-ton";
import { SANDBOX_CSP, SANDBOX_PAGE } from "@clip-wallet/plugins";
import type { SecurityConfig } from "@clip-wallet/security";
import pkg from "./package.json" with { type: "json" };

/** Fixture mode: mock chains/1Mask/route/WalletConnect + dev simulator. Default: real packages. */
const MOCKS = process.env.CLIP_MOCKS === "1";
/**
 * postMessage channel between the inpage script and the content script. It is visible to every page (the inpage
 * script runs in the page's world), so it is a namespace, not a secret: the content script still checks source,
 * schema and size, and the background adds the origin. Derived from the version and SOURCE_DATE_EPOCH so two
 * builds of the same commit are byte-identical (scripts/repro-check.sh).
 */
const CHANNEL = `clip-${createHash("sha256").update(`${pkg.version}:${process.env.SOURCE_DATE_EPOCH ?? "dev"}`).digest("hex").slice(0, 16)}`;
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

/**
 * Settings → Security and the approval checks (docs/phase25/integration/security.md). Open phishing lists are
 * downloads only. Blockaid stays OFF unless CLIP_BLOCKAID_API_KEY is set at build time; when on, Blockaid gets the
 * site, the transaction and the user's address. A key compiled into an extension can be read by anyone with the
 * bundle: for production, point blockaid.baseUrl at a proxy that adds the key.
 */
const BLOCKAID_KEY = process.env.CLIP_BLOCKAID_API_KEY || undefined;
const SECURITY: SecurityConfig = {
  testnet: !clipConfig.mainnet,
  threat: { openLists: true, refreshHours: 24, ...(BLOCKAID_KEY ? { blockaid: { apiKey: BLOCKAID_KEY } } : {}) },
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
    // frame-src 'self': the plugin host (offscreen document) frames the sandbox page; extension origin only.
    const csp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-src 'self'";
    // Clip Plugins need a manifest sandbox page and chrome.offscreen; Firefox has neither, so its build leaves them out.
    const plugins = browser !== "firefox";
    return {
      name: clipConfig.name,
      description: "A calm, non-custodial wallet for every CLPR network. Test networks only.",
      // offscreen: the plugin host document; identity: Google / Apple sign-in for backups (launchWebAuthFlow).
      permissions: ["storage", "alarms", "identity", ...(plugins ? ["offscreen"] : [])],
      // Asked for when the user turns notifications on (Settings → Notifications), never at install.
      optional_permissions: ["notifications"],
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
        // Discover (social stream): DEX Screener market data; Clip handles read through the Hedera JSON-RPC relay.
        "https://api.dexscreener.com/*",
        "https://testnet.hashio.io/*",
        // Clip Plugins are installed from npm (Advanced mode only; integrity-checked).
        ...(plugins ? ["https://registry.npmjs.org/*"] : []),
        // Blockaid scanning, only in builds that set a key.
        ...(BLOCKAID_KEY ? ["https://api.blockaid.io/*"] : []),
        // Optional hosted services from clip.config (unset by default).
        ...[clipConfig.services.backupUrl, clipConfig.services.mediaProxyUrl].filter((u): u is string => !!u).map((u) => `${new URL(u).origin}/*`),
      ],
      action: { default_title: clipConfig.name },
      icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
      // Argon2id (hash-wasm) needs WebAssembly. No remote code; frames only from the extension itself. The plugin
      // sandbox page gets its own CSP (allow-scripts only, unique origin, no extension APIs).
      content_security_policy:
        manifestVersion === 3 ? { extension_pages: csp, ...(plugins ? { sandbox: SANDBOX_CSP } : {}) } : (csp as unknown as never),
      ...(plugins ? { sandbox: { pages: [SANDBOX_PAGE] } } : {}),
      // Lets the passkey web-bridge page hand back a PRF result (Chromium; Firefox lacks externally_connectable).
      ...(browser !== "firefox" ? { externally_connectable: { matches: [`${bridgeOrigin}/*`] } } : {}),
      // Firefox built-in data consent (required for new AMO listings since 2025-11-03; Firefox 140+):
      // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
      // Required: addresses and signed transactions go to network nodes and indexers (the wallet can't work
      // without that). Optional: the email address for passkey backup, only if the user turns backup on.
      ...(browser === "firefox"
        ? {
            browser_specific_settings: {
              gecko: {
                id: `wallet@${clipConfig.rdns.split(".").reverse().join(".")}`,
                strict_min_version: "140.0",
                data_collection_permissions: { required: ["financialAndPaymentInfo"], optional: ["personallyIdentifyingInfo"] },
              },
            },
          }
        : {}),
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
      __CLIP_SECURITY__: JSON.stringify(SECURITY),
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
