import type { Network } from "@clip-wallet/core";

declare global {
  /** Set by wxt.config.ts: true for fixture mode (CLIP_MOCKS=1): mock chains/1Mask/route + dev simulator. */
  const __CLIP_MOCKS__: boolean;
  /** Per-build random postMessage channel shared by the inpage and content scripts. */
  const __CLIP_CHANNEL__: string;
  /** Public network registry for the inpage providers (ids, names, chain ids; no secrets). */
  const __CLIP_PUBLIC_NETWORKS__: Network[];
  /** EIP-6963 / Wallet Standard identity from clip.config. */
  const __CLIP_IDENTITY__: { name: string; icon: `data:image/svg+xml;base64,${string}`; rdns: string };
  /** TON Connect JS bridge settings for 1Mask (wxt.config.ts TON_CONNECT). */
  const __CLIP_TON_CONNECT__: NonNullable<import("@clip-wallet/1mask/inpage").InpageConfig["tonConnect"]>;
}
export {};
