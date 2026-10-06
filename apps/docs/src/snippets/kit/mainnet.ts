// DANGER: a mainnet build moves real funds. Clip Wallet is pre-release and has had no external audit.
// Only do this after every box in packages/extension/MAINNET.md is ticked.
import { MAINNET_ACKNOWLEDGEMENT, defineConfig, mainnetProblems } from "@clip-wallet/config";

const config = defineConfig({
  name: "Acme Wallet",
  rdns: "com.acme.wallet",
  homepage: "https://wallet.acme.example",
  mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },
});

// The build refuses mainnet while this lists anything (here: no extension key, no WalletConnect project id).
console.log(mainnetProblems(config, { CLIP_WALLETCONNECT_PROJECT_ID: undefined }));
