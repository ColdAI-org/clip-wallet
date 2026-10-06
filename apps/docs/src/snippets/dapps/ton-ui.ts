// TON Connect UI shows only listed wallets. Until Clip Wallet is in the official list, include it yourself.
import { TonConnectUI } from "@tonconnect/ui";

declare const clipIconUrl: string; // a 288×288 PNG you host, or window.clipwallet.info.icon

export const tonConnectUI = new TonConnectUI({
  manifestUrl: "https://example.app/tonconnect-manifest.json",
  buttonRootId: "ton-connect",
  walletsListConfiguration: {
    includeWallets: [
      {
        appName: "clipwallet",
        name: "Clip Wallet",
        imageUrl: clipIconUrl,
        aboutUrl: "https://coldai.org/clip-wallet",
        jsBridgeKey: "clipwallet",
        platforms: ["chrome"],
      },
    ],
  },
});

tonConnectUI.onStatusChange((wallet) => {
  if (wallet) console.log("Connected:", wallet.account.address);
});
