import { defineConfig } from "@clip-wallet/config";

export default defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet",
  services: {
    backupUrl: "https://backup.acme.example", // services/backup: passkey backup and settings sync
    mediaProxyUrl: "https://media.acme.example", // services/media-proxy: NFT images and video
    linkRelayUrl: "https://relay.acme.example", // services/link-relay: phone as signer, moving a wallet
    clipHandles: { address: "0x0000000000000000000000000000000000001234", contractId: "0.0.1234", ledger: "testnet" },
  },
});
