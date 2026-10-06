// @mysten/dapp-kit lists Clip Wallet next to the other Sui wallets (Wallet Standard).
import "@mysten/dapp-kit/dist/index.css";
import { ConnectButton, SuiClientProvider, WalletProvider, createNetworkConfig, useCurrentAccount } from "@mysten/dapp-kit";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { networkConfig } = createNetworkConfig({ testnet: { url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" } });
const queryClient = new QueryClient();

function Status() {
  const account = useCurrentAccount();
  return <p>{account ? `Connected: ${account.address}` : "Not connected"}</p>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          <ConnectButton />
          <Status />
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
