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

// The config the kit's tests run with (jest and vitest alias virtual:clip-wallet/config here): Clip Wallet's own.

export default defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  icon: "./icon.svg",
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  // All 14 families, testnets only (same as the extension).
  networks: ["evm:*", "hedera", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand"],
  passkeys: { enabled: true },
  walletConnect: {},
  services: MAINNET ? {} : TESTNET_SERVICES,
  // Settle on Hedera (bonded Connectors, @clip-wallet/route SETTLE_DEPLOYMENTS): testnet builds only.
  route: { settleOnHedera: !MAINNET },
  mainnet: MAINNET,
});
export const icon = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
