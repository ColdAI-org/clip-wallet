// packages/extension/clip.config.ts in a kit-built wallet (apps/extension/clip.config.ts in this repo).
import { defineConfig } from "@clip-wallet/config";

export default defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet", // EIP-6963 id: a reverse domain you own
  description: "Acme's wallet for every network Acme supports.",
  homepage: "https://wallet.acme.example",
  icon: "./icon.svg", // ships inside the extension
  theme: { accent: "#0B7A3B", accentText: "#FFFFFF", font: "Inter", radius: 12 },
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  route: { mode: "balanced", filters: { maxHops: 3 }, settleOnHedera: false },
  hardware: ["ledger", "keystone"],
  passkeys: { enabled: true },
  services: {}, // optional hosted services; unset = those features stay hidden
  mainnet: false, // test networks only
});
