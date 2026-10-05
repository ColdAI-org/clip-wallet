/**
 * Build-time globals (defined by clipWallet() in src/wxt.ts) and the WXT types the kit uses. A module, not a .d.ts,
 * so the declarations travel with every file that uses them: `import type {} from "<path>/globals";`.
 */
import type { Network } from "@clip-wallet/core";

// WXT generates these per project (.wxt/types); the kit is built outside a WXT project, so it declares what it uses.
declare module "wxt/browser" {
  interface WxtRuntime {
    getURL(path: string): string;
  }
}

declare global {
  interface ImportMetaEnv {
    /** Set by WXT: "chrome", "firefox", … */
    readonly BROWSER: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
  /** Set by clipWallet() (src/wxt.ts): true for fixture mode (CLIP_MOCKS=1): mock chains/1Mask/route + dev simulator. */
  const __CLIP_MOCKS__: boolean;
  /** Per-build random postMessage channel shared by the inpage and content scripts. */
  const __CLIP_CHANNEL__: string;
  /** Public network registry for the inpage providers (ids, names, chain ids; no secrets). */
  const __CLIP_PUBLIC_NETWORKS__: Network[];
  /** window[<key>] root for the NEAR/Stellar/Algorand providers and the TON Connect bridge ("Clip Wallet" -> "clipwallet"). */
  const __CLIP_WALLET_KEY__: string;
  /** The Chrome extension id fixed by clip.config extension.key, or null (no key: the browser assigns one). */
  const __CLIP_EXTENSION_ID__: string | null;
  /** WalletConnect is on in this build (a project id was configured): gates Hedera extension discovery. */
  const __CLIP_WALLETCONNECT__: boolean;
  /** EIP-6963 / Wallet Standard identity from clip.config. */
  const __CLIP_IDENTITY__: { name: string; icon: `data:image/svg+xml;base64,${string}`; rdns: string };
  /** Feature partner keys and switches (wxt.config.ts FEATURES). */
  const __CLIP_SECURITY__: import("@clip-wallet/security").SecurityConfig;
  const __CLIP_FEATURES__: import("@clip-wallet/features").FeaturesConfig & { coingeckoDemoKey?: string };
  /** TON Connect JS bridge settings for 1Mask (wxt.config.ts TON_CONNECT). */
  const __CLIP_TON_CONNECT__: NonNullable<import("@clip-wallet/1mask/inpage").InpageConfig["tonConnect"]>;
}
export {};
