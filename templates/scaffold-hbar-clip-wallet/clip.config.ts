import { defineConfig } from "@clip-wallet/config";
// Name, description, rdns, homepage, icon, app id and the extension's public key. `pnpm wallet:identity` writes this
// file; edit it there, not here.
import identity from "./wallet.identity.json" with { type: "json" };

/**
 * The one config for every platform this wallet ships: the browser extension (packages/extension), the desktop app
 * (packages/desktop) and the phone app (packages/mobile). Each setting and its default is documented in
 * @clip-wallet/config (node_modules/@clip-wallet/config/README.md); invalid values fail every build in plain words.
 */
export default defineConfig({
  ...identity,
  // Buttons use the accent with accentText on top: keep a contrast of at least 3:1. The accent is also the phone
  // app's adaptive-icon and splash background.
  theme: { accent: "#4F46E5", accentText: "#FFFFFF", font: "Inter", radius: 12 },
  // "evm:*" or "evm:<chain id>", hedera, solana, bitcoin, sui, aptos, cardano, substrate, starknet, ton, near, stellar,
  // tezos, algorand. Test networks only while mainnet is false.
  networks: ["evm:*", "hedera", "solana", "bitcoin"],
  // Settings → Language offers these (en, de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi); the first is the fallback.
  languages: ["en", "de", "fr", "es", "pt-BR", "it", "tr", "ja", "ko", "zh-Hans", "ar", "hi"],
  // Deep links (<scheme>://wc?uri=…) on desktop and phone. Default: the name in lower case without spaces.
  // scheme: "mywallet",
  // Route and fund on CLPRouter. settleOnHedera: Phase 3 bonded-Connector quotes in the approval's Details.
  route: { mode: "balanced", filters: {}, settleOnHedera: false },
  hardware: ["ledger", "keystone"],
  // The WalletConnect project id comes from CLIP_WALLETCONNECT_PROJECT_ID (.env), never from this file.
  passkeys: { enabled: true },
  // Optional hosted services (backup, NFT media proxy, phone-as-signer relay, Clip handles). Unset = hidden.
  services: {},
  // Test networks only. Mainnet needs every box in MAINNET.md ticked, then
  //   mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }
  // and every build refuses it until `pnpm wallet:mainnet-check` is clean.
  mainnet: false,
});
