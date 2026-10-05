/**
 * Sui dapp-kit (stock ConnectButton + its connect modal), the documented setup: QueryClientProvider,
 * SuiClientProvider on testnet, WalletProvider with autoConnect (an opt-in prop; everything else default),
 * the package's dapp-kit.css.
 */
import "@mysten/dapp-kit/dist/index.css";
import { ConnectButton, SuiClientProvider, WalletProvider, createNetworkConfig, useCurrentAccount, useDisconnectWallet } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Account, expose, mount } from "./kit";

const { networkConfig } = createNetworkConfig({ testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" } });
let disconnect: () => void = () => undefined;
expose({ library: "@mysten/dapp-kit 1.1.17 (@mysten/sui 2)", config: "testnet, WalletProvider autoConnect" }, { disconnect: () => disconnect() });

function Status() {
  const account = useCurrentAccount();
  const { mutate } = useDisconnectWallet();
  disconnect = () => mutate();
  return <Account address={account?.address} />;
}

mount(
  <QueryClientProvider client={new QueryClient()}>
    <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
      <WalletProvider autoConnect>
        <ConnectButton />
        <Status />
      </WalletProvider>
    </SuiClientProvider>
  </QueryClientProvider>,
);
