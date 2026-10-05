/**
 * Sui (testnet): @mysten/wallet-standard discovery exactly as @mysten/dapp-kit does it (getWallets +
 * isWalletWithRequiredFeatureSet), sui:signPersonalMessage verified with @mysten/sui's verifyPersonalMessageSignature,
 * and a 1-MIST coin split to yourself through sui:signAndExecuteTransaction (Transaction from @mysten/sui).
 */
import { getWallets, isWalletWithRequiredFeatureSet, type WalletWithRequiredFeatures } from "@mysten/wallet-standard";
import { Transaction } from "@mysten/sui/transactions";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

let wallet: WalletWithRequiredFeatures;
let account: WalletWithRequiredFeatures["accounts"][number];
type F = Record<string, any>;

expose({
  info: { dapp: "@mysten/wallet-standard (dapp-kit's detection) + @mysten/sui in a local page, testnet", why: "the dapp-kit example is React around these calls; a local page runs the same detection and Transaction builder" },
  steps: {
    connect: async () => {
      // dapp-kit's WalletProvider: required features (sui:signTransaction) and its default filter (a sui: chain).
      // Clip registers one Wallet Standard wallet per ecosystem, all named "Clip Wallet", as Phantom and others do.
      const sui = () =>
        getWallets()
          .get()
          .filter((w) => isWalletWithRequiredFeatureSet(w, ["sui:signTransaction"]) && w.chains.some((c) => c.startsWith("sui:")));
      wallet = await waitFor(() => sui().find((w) => w.name === "Clip Wallet") as WalletWithRequiredFeatures | undefined, "Clip Wallet (Sui)");
      const r = await wallet.features["standard:connect"].connect();
      account = r.accounts[0]!;
      return { address: account.address, chains: account.chains };
    },
    sign: async () => {
      const message = new TextEncoder().encode(MESSAGE);
      const r = await (wallet.features as F)["sui:signPersonalMessage"].signPersonalMessage({ message, account, chain: "sui:testnet" });
      const pk = await verifyPersonalMessageSignature(message, r.signature, { address: account.address });
      return { valid: pk.toSuiAddress() === account.address, how: "@mysten/sui verifyPersonalMessageSignature" };
    },
    send: async () => {
      const tx = new Transaction();
      tx.setSender(account.address);
      const [coin] = tx.splitCoins(tx.gas, [1]);
      tx.transferObjects([coin!], account.address);
      const r = await (wallet.features as F)["sui:signAndExecuteTransaction"].signAndExecuteTransaction({ transaction: tx, account, chain: "sui:testnet" });
      return { id: r.digest };
    },
  },
});
