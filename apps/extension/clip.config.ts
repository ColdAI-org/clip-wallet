import { defineConfig } from "@clip-wallet/config";

/**
 * Testnet-only service deployments (docs/phase25/deploy.md). A mainnet build gets none of these by default:
 * point it at production deployments explicitly.
 */
const MAINNET = false;
const TESTNET_SERVICES = {
  backupUrl: "https://clip-backup.doyoka-platform.workers.dev",
  mediaProxyUrl: "https://clip-media-proxy.doyoka-platform.workers.dev",
};

// Clip Wallet's own brand. Every setting is documented in @clip-wallet/config.
export default defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  icon: "./icon.svg",
  // ColdAI orange; white text on orange buttons is the owner's preference (contrast 3.6:1 ≥ the schema's 3:1).
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  // All 14 families (testnets; mainnet stays gated below).
  networks: ["evm:*", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand"],
  // rpOrigin unset: the extension's own origin is the WebAuthn RP (Chrome 122+). Set an https origin you
  // own (and add it to host_permissions) to keep passkeys stable across extension ids and browsers.
  passkeys: { enabled: true },
  services: MAINNET ? {} : TESTNET_SERVICES,
  mainnet: MAINNET,
});
