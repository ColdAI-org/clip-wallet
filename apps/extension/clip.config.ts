import { defineConfig } from "@clip-wallet/config";

// Clip Wallet's own brand. Every setting is documented in @clip-wallet/config.
export default defineConfig({
  name: "Clip Wallet",
  rdns: "org.coldai.clipwallet",
  icon: "./icon.svg",
  // ColdAI orange; white text on orange buttons is the owner's preference (contrast 3.6:1 ≥ the schema's 3:1).
  theme: { accent: "#FF3C00", accentText: "#FFFFFF", font: "Inter", radius: 14 },
  networks: ["evm:*", "hedera", "solana", "bitcoin", "sui", "aptos", "near", "stellar", "tezos", "algorand"],
  // rpOrigin unset: the extension's own origin is the WebAuthn RP (Chrome 122+). Set an https origin you
  // own (and add it to host_permissions) to keep passkeys stable across extension ids and browsers.
  passkeys: { enabled: true },
  mainnet: false,
});
