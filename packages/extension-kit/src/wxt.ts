/**
 * The WXT config for a Clip Wallet extension, built from clip.config.ts:
 *
 *   // wxt.config.ts
 *   import { defineConfig } from "wxt";
 *   import { clipWallet } from "@clip-wallet/extension-kit/wxt";
 *   import clipConfig from "./clip.config";
 *   export default defineConfig(clipWallet({ config: clipConfig }));
 *
 * Identity (name, icon, rdns, extension key, WalletConnect project id) comes from clip.config.ts and the build
 * environment. What it does not take is a way to lower the security floor: the open phishing lists are always on
 * (Blockaid only when CLIP_BLOCKAID_API_KEY is set), and a mainnet build is refused until mainnetProblems() is empty and
 * every box in the project's MAINNET.md is ticked.
 * Runs in Node (WXT loads it); nothing here reaches the browser except the values it defines.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { ConfigError, WALLETCONNECT_ENV, defineConfig as defineClipConfig, isMainnetEnabled, mainnetProblems, walletKey, type ClipConfig, type ClipConfigInput } from "@clip-wallet/config";
import { createTonModule } from "@clip-wallet/chains-ton";
import { walletNetworks } from "@clip-wallet/engine/catalog";
import { SANDBOX_CSP, SANDBOX_PAGE } from "@clip-wallet/plugins";
import { SETTLE_DEPLOYMENTS } from "@clip-wallet/route";
import { assertSecurityFloor, type SecurityConfig } from "@clip-wallet/security";
import type { UserConfig } from "wxt";
import { extensionIdFromDigest, passkeyBridgeUrl } from "./identity";

/** The Chrome extension id for a manifest `key` (base64 SubjectPublicKeyInfo). */
export function extensionIdFromKey(key: string): string {
  return extensionIdFromDigest(createHash("sha256").update(Buffer.from(key, "base64")).digest());
}

/** The virtual module the kit's pages and background import the resolved clip.config from. */
export const CONFIG_MODULE = "virtual:clip-wallet/config";

export interface ClipWalletOptions {
  /** The default export of clip.config.ts (already validated by defineConfig). */
  config: ClipConfig;
  /** The extension project directory (clip.config.ts, icon, .env, package.json). Default: process.cwd(). */
  root?: string;
  /** Version for the manifest and TON Connect DeviceInfo. Default: the project's package.json version. */
  version?: string;
  /** Build environment. Default: process.env plus CLIP_* values from <root>/.env (process.env wins). */
  env?: Record<string, string | undefined>;
  /** Fixture mode: mock chains, 1Mask, route and WalletConnect plus the dev simulator. Default: CLIP_MOCKS=1. */
  mocks?: boolean;
  /**
   * Resolve workspace packages from their TypeScript source (the "development" export condition). Default: on when
   * Node runs with --conditions=development (the Clip Wallet monorepo sets it); off for installed packages.
   */
  sourceConditions?: boolean;
}

/** CLIP_* lines from a .env file (KEY=value, # comments). Other keys are ignored; values are never logged. */
export function readClipEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(CLIP_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== "") out[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function devConditions(): boolean {
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS ?? "").split(/\s+/)];
  return flags.some((f, i) => /^(?:--conditions|-C)=development$/.test(f) || ((f === "--conditions" || f === "-C") && flags[i + 1] === "development"));
}

/** data: URI for the icon next to clip.config.ts (svg or png). */
export function iconDataUri(root: string, icon: string): `data:image/${"svg+xml" | "png"};base64,${string}` {
  if (icon.startsWith("data:image/")) return icon as never;
  if (/^https?:\/\//.test(icon)) {
    throw new ConfigError([`icon: ship the icon with the extension (./icon.svg or ./icon.png); ${icon} would be fetched from someone else's server`]);
  }
  const file = resolve(root, icon);
  if (!existsSync(file)) throw new ConfigError([`icon: ${icon} isn't there; put the icon next to clip.config.ts`]);
  const type = extname(file).toLowerCase() === ".png" ? "png" : "svg+xml";
  return `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
}

/** The SecurityConfig every build gets. There is deliberately no option to change it. */
export function securityFor(config: ClipConfig, env: Record<string, string | undefined>): SecurityConfig {
  const blockaid = env.CLIP_BLOCKAID_API_KEY || undefined;
  const security: SecurityConfig = {
    testnet: !isMainnetEnabled(config),
    threat: { openLists: true, refreshHours: 24, ...(blockaid ? { blockaid: { apiKey: blockaid } } : {}) },
  };
  assertSecurityFloor(security);
  return security;
}

/**
 * Re-validate the config with the build environment applied (WalletConnect project id from CLIP_WALLETCONNECT_PROJECT_ID)
 * and enforce the mainnet checklist. Throws ConfigError in plain words.
 */
export function resolveConfig(config: ClipConfig, env: Record<string, string | undefined>, root?: string): ClipConfig {
  const projectId = config.walletConnect.projectId ?? (env[WALLETCONNECT_ENV] || undefined);
  const resolved = defineClipConfig({ ...(config as ClipConfigInput), walletConnect: projectId ? { projectId } : {} });
  if (isMainnetEnabled(resolved)) {
    const problems = [...mainnetProblems(resolved, env), ...(root ? openChecklistItems(root) : [])];
    if (problems.length) throw new ConfigError(problems.map((p) => `mainnet checklist: ${p}`));
  }
  return resolved;
}

/**
 * Open boxes ("- [ ] …") in the project's MAINNET.md, the checklist create-clip-wallet projects carry next to
 * clip.config.ts. A project without one (Clip Wallet's own) relies on mainnetProblems() alone.
 */
export function openChecklistItems(root: string): string[] {
  const file = join(root, "MAINNET.md");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*- \[ \] (.+)$/.exec(l)?.[1])
    .filter((x): x is string => !!x)
    .map((item) => `MAINNET.md: ${item.replace(/`/g, "")}`);
}

export function clipWallet(options: ClipWalletOptions): UserConfig {
  const root = options.root ?? process.cwd();
  const env = { ...readClipEnv(join(root, ".env")), ...process.env, ...options.env };
  const config = resolveConfig(options.config, env, root);
  const mocks = options.mocks ?? env.CLIP_MOCKS === "1";
  const source = options.sourceConditions ?? devConditions();
  const version = options.version ?? (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  const key = walletKey(config);
  const icon = iconDataUri(root, config.icon);
  const testnet = !isMainnetEnabled(config);
  const security = securityFor(config, env);

  /**
   * postMessage channel between the inpage script and the content script. It is visible to every page (the inpage
   * script runs in the page's world), so it is a namespace, not a secret: the content script still checks source,
   * schema and size, and the background adds the origin. Derived from the wallet key, the version and
   * SOURCE_DATE_EPOCH so two builds of the same commit are byte-identical (scripts/repro-check.sh).
   */
  const channel = `${key}-${createHash("sha256").update(`${version}:${env.SOURCE_DATE_EPOCH ?? "dev"}`).digest("hex").slice(0, 16)}`;
  const publicNetworks = walletNetworks(config).map((n) => ({ ...n, rpcUrls: n.rpcUrls.slice(0, 1) }));
  /** TON Connect JS bridge (window[key].tonconnect). key/appName must match the wallets-list entry (create-clip-wallet listings). */
  const tonConnect = { key, appName: key, appVersion: version, features: createTonModule().features };
  /** Feature partner keys from the build environment. Absent = that provider shows as "not switched on". */
  const features = {
    testnet,
    swap: { zeroExApiKey: env.CLIP_0X_API_KEY || undefined, jupiterApiKey: env.CLIP_JUPITER_API_KEY || undefined },
    onramp: {
      moonpay: env.CLIP_MOONPAY_API_KEY && env.CLIP_MOONPAY_SIGNER_URL ? { apiKey: env.CLIP_MOONPAY_API_KEY, signerUrl: env.CLIP_MOONPAY_SIGNER_URL } : undefined,
      banxa: env.CLIP_BANXA_PARTNER ? { partner: env.CLIP_BANXA_PARTNER } : undefined,
      c14: env.CLIP_C14_CLIENT_ID ? { clientId: env.CLIP_C14_CLIENT_ID, assetIds: JSON.parse(env.CLIP_C14_ASSET_IDS || "{}") } : undefined,
    },
    coingeckoDemoKey: env.CLIP_COINGECKO_DEMO_KEY || undefined,
  };
  const passkeyBridge = passkeyBridgeUrl(config);
  // Store descriptions are capped at 132 characters; a testnet build always says so.
  const base = config.description ?? `${config.name}: a non-custodial wallet for every CLPR network.`;
  const suffix = testnet && !/test ?net/i.test(base) ? " Test networks only." : "";
  const description = base.length + suffix.length > 132 ? `${base.slice(0, 131 - suffix.length).trimEnd()}…${suffix}` : `${base}${suffix}`;

  const EMPTY = "\0clip-wallet:empty-module";
  return {
    srcDir: "src",
    outDir: mocks ? ".output-fixtures" : ".output",
    // Explicit imports only (unimport would otherwise inject e.g. `storage` into the vault).
    // @ts-expect-error autoImport is an unimport option that WXT passes through but doesn't type.
    imports: { autoImport: false, eslintrc: { enabled: false } },
    modules: ["@wxt-dev/module-react"],
    manifest: ({ browser, manifestVersion }) => {
      const rp = config.passkeys.rpOrigin;
      const rpHost = rp?.startsWith("https://") ? [`${rp}/*`] : [];
      // frame-src 'self': the plugin host (offscreen document) frames the sandbox page; extension origin only.
      const csp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; frame-src 'self'";
      // Clip Plugins need a manifest sandbox page and chrome.offscreen; Firefox has neither.
      const plugins = browser !== "firefox";
      return {
        name: config.name,
        description,
        // The extension's own id: the public key from clip.config (Chromium only; stores ignore it on upload).
        ...(config.extension.key && browser !== "firefox" ? { key: config.extension.key } : {}),
        // offscreen: the plugin host document; identity: Google / Apple sign-in for backups (launchWebAuthFlow).
        // activeTab: "Continue this page on your phone" reads the current tab's URL when the person opens the popup.
        permissions: ["storage", "alarms", "identity", "activeTab", ...(plugins ? ["offscreen"] : [])],
        // Asked for when the user turns notifications on, never at install.
        // nativeMessaging: asked for when the person taps "Use <desktop app>" (Settings → Linked devices).
        optional_permissions: ["notifications", "nativeMessaging"],
        host_permissions: [
          ...rpHost,
          // Koios (Cardano) is CORS-restricted on its public tier, so the background needs host access.
          "https://*.koios.rest/*",
          "https://api.coingecko.com/*",
          "https://api.jup.ag/*",
          "https://api.0x.org/*",
          "https://agg-api.minswap.org/*",
          "https://aftermath.finance/*",
          "https://api.hyperion.xyz/*",
          "https://api-testnet.hyperion.xyz/*",
          "https://starknet.api.avnu.fi/*",
          "https://sepolia.api.avnu.fi/*",
          "https://api.ston.fi/*",
          "https://smartrouter.ref.finance/*",
          // Discover: DEX Screener market data; Clip handles read through the Hedera JSON-RPC relay.
          "https://api.dexscreener.com/*",
          "https://testnet.hashio.io/*",
          // Clip Plugins are installed from npm (Advanced mode only; integrity-checked).
          ...(plugins ? ["https://registry.npmjs.org/*"] : []),
          // Blockaid scanning, only in builds that set a key.
          ...(security.threat?.blockaid ? ["https://api.blockaid.io/*"] : []),
          // Settle on Hedera (testnet builds with route.settleOnHedera): the Connectors' quote APIs.
          ...(config.route.settleOnHedera && testnet
            ? SETTLE_DEPLOYMENTS.filter((d) => d.network === "testnet").flatMap((d) => d.connectors.map((c) => `${new URL(c.url).origin}/*`))
            : []),
          // Optional hosted services from clip.config (unset by default).
          ...[config.services.backupUrl, config.services.mediaProxyUrl, config.services.linkRelayUrl].filter((u): u is string => !!u).map((u) => `${new URL(u).origin}/*`),
        ],
        action: { default_title: config.name },
        icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
        // Argon2id (hash-wasm) needs WebAssembly. No remote code; frames only from the extension itself.
        content_security_policy:
          manifestVersion === 3 ? { extension_pages: csp, ...(plugins ? { sandbox: SANDBOX_CSP } : {}) } : (csp as unknown as never),
        ...(plugins ? { sandbox: { pages: [SANDBOX_PAGE] } } : {}),
        // Lets the passkey web-bridge page hand back a PRF result (Chromium; Firefox lacks externally_connectable).
        ...(browser !== "firefox" ? { externally_connectable: { matches: [`${new URL(passkeyBridge).origin}/*`] } } : {}),
        // Firefox built-in data consent (required for new AMO listings since 2025-11-03; Firefox 140+):
        // https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
        // Required: addresses and signed transactions go to network nodes and indexers (the wallet can't work
        // without that). Optional: the email address for passkey backup, only if the user turns backup on.
        ...(browser === "firefox"
          ? {
              browser_specific_settings: {
                gecko: {
                  id: `wallet@${config.rdns.split(".").reverse().join(".")}`,
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
        // Some chain deps read `window` or Node's `global` at load time; a service worker has neither.
        global: "globalThis",
        __CLIP_MOCKS__: JSON.stringify(mocks),
        __CLIP_CHANNEL__: JSON.stringify(channel),
        __CLIP_PUBLIC_NETWORKS__: JSON.stringify(publicNetworks),
        __CLIP_WALLET_KEY__: JSON.stringify(key),
        // Beacon's wallet list keys extensions by their store id; without a fixed key, 1Mask falls back to the rdns.
        __CLIP_EXTENSION_ID__: JSON.stringify(config.extension.key ? extensionIdFromKey(config.extension.key) : null),
        __CLIP_IDENTITY__: JSON.stringify({ name: config.name, icon, rdns: config.rdns }),
        __CLIP_TON_CONNECT__: JSON.stringify(tonConnect),
        // Hedera extension discovery hands over WalletConnect codes: only announce it when this build can pair.
        __CLIP_WALLETCONNECT__: JSON.stringify(!!config.walletConnect.projectId),
        __CLIP_FEATURES__: JSON.stringify(features),
        __CLIP_SECURITY__: JSON.stringify(security),
      },
      plugins: [
        {
          name: "clip-wallet:config",
          enforce: "pre",
          resolveId(id: string) {
            if (id === CONFIG_MODULE) return `\0${CONFIG_MODULE}`;
            // hdkey (Keystone's bc-ur-registry-eth) requires Node's crypto/stream for code paths we never call.
            if (id === "crypto" || id === "stream") return EMPTY;
            return undefined;
          },
          load(id: string) {
            // The validated config, with the build environment applied. Secrets never go in clip.config.
            if (id === `\0${CONFIG_MODULE}`) return `export default ${JSON.stringify(config)};`;
            if (id === EMPTY) return "export default {};";
            return undefined;
          },
        },
      ],
      // The pages/background (client) and WXT's entrypoint analysis (server module runner) both need the condition.
      ...(source
        ? {
            resolve: { conditions: ["development", "module", "browser", "development|production"] },
            ssr: { resolve: { conditions: ["development", "module", "node", "development|production"], externalConditions: ["development", "node"] } },
            // WXT imports entrypoints in an "inline" server environment to read their options.
            environments: { inline: { resolve: { conditions: ["development"], externalConditions: ["development", "node"] } } },
          }
        : {}),
      build: { target: "es2022" },
    }),
  };
}

/** The extension id Chrome derives from clip.config's public key (undefined without one). */
export function extensionIdOf(config: Pick<ClipConfig, "extension">): string | undefined {
  return config.extension.key ? extensionIdFromKey(config.extension.key) : undefined;
}
