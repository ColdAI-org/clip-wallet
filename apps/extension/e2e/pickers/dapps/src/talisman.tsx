/**
 * Talisman Connect (stock WalletSelect from @talismn/connect-components), the documented setup: a trigger button,
 * dappName, showAccountsList, onAccountSelected. Stock: the library's own wallet list (getWallets()).
 * ?variant=clip: `walletList` = getWallets() plus a Clip entry (a BaseDotsamaWallet for injectedWeb3["clip-wallet"]),
 * the prop a dapp uses to show another extension.
 */
import { useState } from "react";
import { WalletSelect } from "@talismn/connect-components";
import { BaseDotsamaWallet, getWallets } from "@talismn/connect-wallets";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

class ClipWalletEntry extends BaseDotsamaWallet {
  extensionName = "clip-wallet";
  title = "Clip Wallet";
  installUrl = "https://coldai.org/clip-wallet";
  // injectedWeb3 carries no icon; a dapp-provided entry uses the wallet's published icon (here the one 1Mask exposes).
  logo = { src: (window as unknown as { clipwallet?: { info?: { icon?: string } } }).clipwallet?.info?.icon ?? "", alt: "Clip Wallet Logo" };
}

let setAccount: (a: string) => void = () => undefined;
expose(
  { library: "@talismn/connect-components 1.1.9 (connect-wallets 1.2.8)", config: withClip ? "walletList: [...getWallets(), Clip entry]" : "default wallet list" },
  { disconnect: () => setAccount("") },
);

function App() {
  const [address, set] = useState("");
  setAccount = set;
  return (
    <>
      <WalletSelect
        dappName="Clip picker matrix"
        showAccountsList
        {...(withClip ? { walletList: [...getWallets(), new ClipWalletEntry()] } : {})}
        triggerComponent={<button type="button">Connect wallet</button>}
        onAccountSelected={(a) => set(a.address)}
      />
      <Account address={address} />
    </>
  );
}

mount(<App />);
