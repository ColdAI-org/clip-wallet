import { defineConfig } from "@clip-wallet/config";

// Same brand as the extension (apps/extension/clip.config.ts). Schema: @clip-wallet/config.
// WalletConnect's project id comes from EXPO_PUBLIC_WC_PROJECT_ID at build time (see src/env.ts), never from here.
export default defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  icon: "./assets/icon.svg",
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  passkeys: { enabled: true },
  walletConnect: {},
  mainnet: false,
});
