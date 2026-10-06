// NEAR Wallet Selector lists only the modules you pass: add Clip Wallet's.
import "@near-wallet-selector/modal-ui/styles.css";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupClipWallet } from "@clip-wallet/kit-modules/near";

export async function openNearModal() {
  const selector = await setupWalletSelector({
    network: "testnet",
    modules: [setupClipWallet()], // next to the modules you already use
  });
  const modal = setupModal(selector, { contractId: "" }); // "" = sign in without a function-call key
  modal.show();
  return selector;
}
