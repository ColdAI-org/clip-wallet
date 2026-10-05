/**
 * Algorand (testnet): TxnLab use-wallet v5 WalletManager with Clip's adapter (@clip-wallet/kit-modules/algorand, the
 * documented third-party adapter path), connect, and a 1-microAlgo payment to yourself built with algosdk, signed
 * with signTransactions and sent to algod. use-wallet has no message signing (ARC-60 is a draft).
 */
import { WalletManager, NetworkId } from "@txnlab/use-wallet";
import { clipWallet } from "@clip-wallet/kit-modules/algorand";
import algosdk from "algosdk";
import { expose } from "../dapp-kit";

const algod = new algosdk.Algodv2("", "https://testnet-api.4160.nodely.dev", "");
const manager = new WalletManager({ wallets: [clipWallet()], defaultNetwork: NetworkId.TESTNET });
let address = "";

expose({
  info: { dapp: "@txnlab/use-wallet v5 + @clip-wallet/kit-modules/algorand + algosdk in a local page, TestNet", why: "use-wallet is what Algorand dapps (and the use-wallet examples) use; a local page avoids the example's build" },
  steps: {
    connect: async () => {
      const w = manager.getWallet("clip-wallet" as never)!;
      const accounts = await w.connect();
      address = accounts[0]!.address;
      return { address };
    },
    send: async () => {
      const w = manager.getWallet("clip-wallet" as never)!;
      const suggestedParams = await algod.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({ sender: address, receiver: address, amount: 1, suggestedParams });
      const signed = await w.signTransactions([txn]);
      const blob = signed[0];
      if (!blob) throw new Error("not signed");
      const r = await algod.sendRawTransaction(blob).do();
      return { id: r.txid };
    },
  },
});
