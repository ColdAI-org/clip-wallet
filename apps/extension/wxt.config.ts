import { defineConfig } from "wxt";
import clipConfig from "./clip.config";
import { PASSKEY_BRIDGE_URL } from "./src/app-settings";

/** Dev flag: wire in-repo mocks for chains/1Mask/route/WalletConnect. Default on until those packages merge. */
const MOCKS = process.env.CLIP_MOCKS !== "0";

export default defineConfig({
  srcDir: "src",
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
      host_permissions: rpHost,
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
    define: { __CLIP_MOCKS__: JSON.stringify(MOCKS) },
    build: { target: "es2022" },
  }),
});
