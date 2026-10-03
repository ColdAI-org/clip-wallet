/**
 * 1Mask inpage providers (MAIN world): EIP-1193 + EIP-6963, Solana and Bitcoin Wallet Standard.
 * Networks and identity are baked in at build time (no chrome APIs in the MAIN world).
 */
import { defineContentScript } from "wxt/utils/define-content-script";
import { installOneMask } from "@clip-wallet/1mask/inpage";

export default defineContentScript({
  matches: ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    installOneMask({ networks: __CLIP_PUBLIC_NETWORKS__, channel: __CLIP_CHANNEL__, identity: __CLIP_IDENTITY__ });
  },
});
