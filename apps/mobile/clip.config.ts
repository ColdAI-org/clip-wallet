import { defineConfig } from "@clip-wallet/config";

/**
 * Testnet-only service deployments (docs/phase25/deploy.md). A mainnet build gets none of these by default:
 * point it at production deployments explicitly.
 */
const MAINNET = false;
const TESTNET_SERVICES = {
  backupUrl: "https://clip-backup.doyoka-platform.workers.dev",
  mediaProxyUrl: "https://clip-media-proxy.doyoka-platform.workers.dev",
  linkRelayUrl: "https://clip-link-relay.doyoka-platform.workers.dev",
};

// Same brand as the extension (apps/extension/clip.config.ts). Schema: @clip-wallet/config.
// WalletConnect's project id comes from EXPO_PUBLIC_WC_PROJECT_ID at build time (see src/env.ts), never from here.
export default defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  icon: "./assets/icon.svg",
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  // All 14 families, testnets only (same as the extension).
  networks: ["evm:*", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand", "cosmos", "provenance", "thorchain", "initia", "tron", "xrpl", "antelope", "multiversx", "icp", "stacks", "fuel", "bitcoincash"],
  passkeys: { enabled: true },
  walletConnect: {},
  services: MAINNET ? {} : TESTNET_SERVICES,
  // Settle on Hedera (bonded Connectors, @clip-wallet/route SETTLE_DEPLOYMENTS): testnet builds only.
  route: { settleOnHedera: !MAINNET },
  mainnet: MAINNET,
});
