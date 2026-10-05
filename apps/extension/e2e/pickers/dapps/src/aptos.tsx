/**
 * Aptos wallet adapter (stock WalletSelector from @aptos-labs/wallet-adapter-ant-design, the current UI package),
 * the documented setup: AptosWalletAdapterProvider with autoConnect and dappConfig { network: TESTNET }, the
 * package's index.css. AIP-62 (Wallet Standard) wallets are detected automatically.
 */
import "@aptos-labs/wallet-adapter-ant-design/dist/index.css";
import { AptosWalletAdapterProvider, useWallet } from "@aptos-labs/wallet-adapter-react";
import { WalletSelector } from "@aptos-labs/wallet-adapter-ant-design";
import { Account, expose, mount } from "./kit";

let disconnect: () => Promise<void> | void = async () => undefined;
expose({ library: "@aptos-labs/wallet-adapter-ant-design 5.3.19 (wallet-adapter-react 8.3.3)", config: "testnet, autoConnect" }, { disconnect: () => disconnect() });

function Status() {
  const w = useWallet();
  disconnect = w.disconnect;
  return <Account address={w.account?.address?.toString()} />;
}

mount(
  <AptosWalletAdapterProvider autoConnect dappConfig={{ network: "testnet" as never /* ts-sdk Network.TESTNET */ }}>
    <WalletSelector />
    <Status />
  </AptosWalletAdapterProvider>,
);
