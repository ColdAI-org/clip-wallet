import { defineConfig, enabledFamilies } from "@clip-wallet/config";

const config = defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet",
  // Every EVM chain Clip ships, Hedera, Solana and Cardano. "evm:84532" would turn on Base Sepolia alone.
  networks: ["evm:*", "hedera", "solana", "cardano"],
});

console.log(enabledFamilies(config)); // ["evm", "hedera", "solana", "cardano"]
