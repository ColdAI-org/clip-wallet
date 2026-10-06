// The Aptos wallet adapter finds Clip Wallet through AIP-62 (the Aptos Wallet Standard).
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";
import { Network } from "@aptos-labs/ts-sdk";

function ConnectClip() {
  const { wallets, connect, account } = useWallet();
  const clip = wallets.find((w) => w.name === "Clip Wallet");
  if (account) return <p>Connected: {account.address.toString()}</p>;
  return (
    <button type="button" disabled={!clip} onClick={() => clip && connect(clip.name)}>
      Connect Clip Wallet
    </button>
  );
}

export function App() {
  return (
    <AptosWalletAdapterProvider autoConnect dappConfig={{ network: Network.TESTNET }}>
      <ConnectClip />
    </AptosWalletAdapterProvider>
  );
}
