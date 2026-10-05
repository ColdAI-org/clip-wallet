/**
 * Solana wallet-adapter (stock WalletMultiButton + WalletModal from @solana/wallet-adapter-react-ui), the documented
 * setup: ConnectionProvider on devnet, WalletProvider with no legacy adapters (Wallet Standard wallets are detected
 * automatically) and autoConnect, WalletModalProvider, the package's own styles.css.
 */
import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";
import { Account, expose, mount } from "./kit";

let disconnect: () => Promise<void> = async () => undefined;
expose({ library: "@solana/wallet-adapter-react-ui 0.9.40 (wallet-adapter-react 0.15.40)", config: "devnet, wallets: [] (Wallet Standard detection), autoConnect" }, { disconnect: () => disconnect() });

function Status() {
  const w = useWallet();
  disconnect = w.disconnect;
  return <Account address={w.publicKey?.toBase58()} />;
}

mount(
  <ConnectionProvider endpoint={clusterApiUrl("devnet")}>
    <WalletProvider wallets={[]} autoConnect>
      <WalletModalProvider>
        <WalletMultiButton />
        <Status />
      </WalletModalProvider>
    </WalletProvider>
  </ConnectionProvider>,
);
