/**
 * RainbowKit 2 (stock ConnectButton + modal), the documented quick-start: getDefaultConfig on Sepolia,
 * RainbowKitProvider with the default theme. getDefaultConfig requires a WalletConnect project id, so a placeholder
 * id is passed: only the injected (EIP-6963) path is tested; RainbowKit lists EIP-6963 wallets under "Installed".
 */
import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount, useDisconnect } from "wagmi";
import { sepolia } from "wagmi/chains";
import { disconnect } from "wagmi/actions";
import { Account, expose, mount } from "./kit";

const config = getDefaultConfig({ appName: "Clip picker matrix", projectId: "00000000000000000000000000000000", chains: [sepolia] });
expose({ library: "@rainbow-me/rainbowkit 2.2.11 (wagmi 2)", config: "getDefaultConfig, placeholder WalletConnect project id (injected path only)" }, { disconnect: () => disconnect(config) });

function Status() {
  const { address } = useAccount();
  void useDisconnect;
  return <Account address={address} />;
}

mount(
  <WagmiProvider config={config}>
    <QueryClientProvider client={new QueryClient()}>
      <RainbowKitProvider>
        <ConnectButton />
        <Status />
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>,
);
