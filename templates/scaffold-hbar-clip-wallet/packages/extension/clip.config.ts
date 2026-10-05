import { defineConfig } from "@clip-wallet/config";
// Name, description, rdns, homepage, icon and the extension's public key. `pnpm wallet:identity` writes this file;
// edit it there, not here.
import identity from "./wallet.identity.json" with { type: "json" };

/**
 * Everything about this wallet that isn't identity. Each setting and its default is documented in
 * @clip-wallet/config (node_modules/@clip-wallet/config/README.md); invalid values fail the build in plain words.
 */
export default defineConfig({
  ...identity,
  // Buttons use the accent with accentText on top: keep a contrast of at least 3:1.
  theme: { accent: "#4F46E5", accentText: "#FFFFFF", font: "Inter", radius: 12 },
  // "evm:*" or "evm:<chain id>", hedera, solana, bitcoin, sui, aptos, cardano, substrate, starknet, ton, near, stellar,
  // tezos, algorand. Test networks only while mainnet is false.
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  // Route and fund on CLPRouter. settleOnHedera: Phase 3 bonded-Connector quotes in the approval's Details.
  route: { mode: "balanced", filters: {}, settleOnHedera: false },
  hardware: ["ledger", "keystone"],
  // The WalletConnect project id comes from CLIP_WALLETCONNECT_PROJECT_ID (.env), never from this file.
  passkeys: { enabled: true },
  // Optional hosted services (backup, NFT media proxy, Clip handles). Unset = those features stay hidden.
  services: {},
  // Test networks only. Mainnet needs every box in MAINNET.md ticked, then
  //   mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }
  // and the build refuses it until `pnpm wallet:mainnet-check` is clean.
  mainnet: false,
});
