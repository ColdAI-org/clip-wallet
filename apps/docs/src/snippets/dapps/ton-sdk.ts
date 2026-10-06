// Without the UI: talk to Clip Wallet's injected TON Connect bridge directly (window.clipwallet.tonconnect).
import { CHAIN, TonConnect, type Wallet } from "@tonconnect/sdk";

const connector = new TonConnect({ manifestUrl: "https://example.app/tonconnect-manifest.json" });

export async function connectTon(): Promise<Wallet> {
  if (!TonConnect.isWalletInjected("clipwallet")) throw new Error("Clip Wallet isn't installed in this browser.");
  const connected = new Promise<Wallet>((resolve, reject) => {
    const stop = connector.onStatusChange(
      (wallet) => wallet && (stop(), resolve(wallet)),
      (error) => (stop(), reject(error)),
    );
  });
  connector.connect({ jsBridgeKey: "clipwallet" });
  return connected;
}

export async function sendOneNanoton(wallet: Wallet) {
  return connector.sendTransaction({
    validUntil: Math.floor(Date.now() / 1000) + 300,
    network: CHAIN.TESTNET,
    messages: [{ address: wallet.account.address, amount: "1" }],
  });
}
