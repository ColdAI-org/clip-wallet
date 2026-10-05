/**
 * TxnLab use-wallet v5 + its stock UI (@txnlab/use-wallet-ui-react WalletButton), the documented setup with the
 * package's style.css, TestNet. Stock: Pera, Defly and Exodus adapters. ?variant=clip: the same plus
 * @clip-wallet/kit-modules/algorand's clipWallet() adapter, the documented way a wallet joins use-wallet v5.
 * use-wallet restores the last session on load (resumeSessions).
 */
import "@txnlab/use-wallet-ui-react/dist/style.css";
import { NetworkId, WalletManager, WalletProvider, useWallet } from "@txnlab/use-wallet-react";
import { WalletButton, WalletUIProvider } from "@txnlab/use-wallet-ui-react";
import { pera } from "@txnlab/use-wallet-pera";
import { defly } from "@txnlab/use-wallet-defly";
import { exodus } from "@txnlab/use-wallet-exodus";
import { clipWallet } from "@clip-wallet/kit-modules/algorand";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

const manager = new WalletManager({ wallets: [pera(), defly(), exodus(), ...(withClip ? [clipWallet() as never] : [])], defaultNetwork: NetworkId.TESTNET } as never);
expose(
  { library: "@txnlab/use-wallet-ui-react 1.2.1 (use-wallet-react 5.0.1)", config: withClip ? "wallets: pera, defly, exodus + clipWallet(), TestNet" : "wallets: pera, defly, exodus, TestNet" },
  { disconnect: () => manager.activeWallet?.disconnect() },
);

function Status() {
  const { activeAddress } = useWallet();
  return <Account address={activeAddress} />;
}

mount(
  <WalletProvider manager={manager}>
    <WalletUIProvider>
      <WalletButton />
      <Status />
    </WalletUIProvider>
  </WalletProvider>,
);
