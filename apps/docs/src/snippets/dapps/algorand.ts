// use-wallet v5 lists only the adapters you pass: add Clip Wallet's.
import { NetworkId, WalletManager } from "@txnlab/use-wallet";
import { WALLET_ID, clipWallet } from "@clip-wallet/kit-modules/algorand";
import algosdk from "algosdk";

export const manager = new WalletManager({ wallets: [clipWallet()], defaultNetwork: NetworkId.TESTNET });

export async function payOneMicroAlgoToSelf() {
  const wallet = manager.wallets.find((w) => w.id === WALLET_ID);
  if (!wallet) throw new Error("Clip Wallet's adapter isn't registered.");
  const [account] = await wallet.connect();
  const algod = new algosdk.Algodv2("", "https://testnet-api.4160.nodely.dev", "");
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: account!.address, receiver: account!.address, amount: 1, suggestedParams });
  const [signed] = await wallet.signTransactions([txn]);
  return algod.sendRawTransaction(signed!).do();
}
