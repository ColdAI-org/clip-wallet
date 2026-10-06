// @solana/wallet-adapter-react lists every Wallet Standard wallet by itself. Pass wallets={[]}.
import "@solana/wallet-adapter-react-ui/styles.css";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

function Status() {
  const { publicKey } = useWallet();
  return <p>{publicKey ? `Connected: ${publicKey.toBase58()}` : "Not connected"}</p>;
}

export function App() {
  return (
    <ConnectionProvider endpoint={clusterApiUrl("devnet")}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <WalletMultiButton />
          <Status />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
