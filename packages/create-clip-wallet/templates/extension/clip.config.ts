import { defineConfig } from "@clip-wallet/config";

// Rewritten by create-clip-wallet. Every setting is documented in @clip-wallet/config.
export default defineConfig({
  name: "Clip Wallet",
  rdns: "com.example.clipwallet",
  theme: { accent: "#4F46E5" },
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  mainnet: false,
});
