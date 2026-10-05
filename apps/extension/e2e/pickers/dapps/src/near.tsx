/**
 * NEAR Wallet Selector v10 (stock modal-ui), testnet. Stock: the selector with common stock modules (MyNearWallet,
 * Meteor). ?variant=clip: the same plus @clip-wallet/kit-modules/near's setupClipWallet(), the documented way a wallet
 * joins the selector. The selector restores the last wallet on load by itself.
 */
import "@near-wallet-selector/modal-ui/styles.css";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupClipWallet } from "@clip-wallet/kit-modules/near";
import { useEffect, useState } from "react";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

const selector = setupWalletSelector({ network: "testnet", modules: [setupMyNearWallet(), setupMeteorWallet(), ...(withClip ? [setupClipWallet()] : [])] });
const modal = selector.then((s) => setupModal(s, { contractId: "" } as never));
expose(
  { library: "@near-wallet-selector/modal-ui 10.1.4", config: withClip ? "modules: MyNearWallet, Meteor, @clip-wallet/kit-modules/near" : "modules: MyNearWallet, Meteor (stock)" },
  { disconnect: async () => (await (await selector).wallet()).signOut() },
);

function App() {
  const [address, set] = useState("");
  useEffect(() => {
    let sub: { unsubscribe(): void } | undefined;
    void selector.then((s) => {
      sub = s.store.observable.subscribe((st) => set(st.accounts.find((a) => a.active)?.accountId ?? st.accounts[0]?.accountId ?? ""));
    });
    return () => sub?.unsubscribe();
  }, []);
  return (
    <>
      <button type="button" onClick={() => void modal.then((m) => m.show())}>
        Connect wallet
      </button>
      <Account address={address} />
    </>
  );
}

mount(<App />);
