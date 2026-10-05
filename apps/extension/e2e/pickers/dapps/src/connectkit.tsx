/**
 * ConnectKit (stock ConnectKitButton + modal), the documented setup: createConfig(getDefaultConfig({...})) on Sepolia,
 * no WalletConnect project id (ConnectKit needs one only for its QR flows). Injected wallets come from EIP-6963.
 */
import { ConnectKitButton, ConnectKitProvider, getDefaultConfig } from "connectkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, useAccount } from "wagmi";
import { sepolia } from "wagmi/chains";
import { disconnect } from "wagmi/actions";
import { Account, expose, mount } from "./kit";

// `as never`: connectkit's .d.ts imports @wagmi/core without depending on it, so tsc may pick another major.
const config = createConfig(getDefaultConfig({ appName: "Clip picker matrix", chains: [sepolia], walletConnectProjectId: "" }) as never);
expose({ library: "connectkit 1.9.2 (wagmi 2)", config: "getDefaultConfig, no WalletConnect project id" }, { disconnect: () => disconnect(config) });

function Status() {
  const { address } = useAccount();
  return <Account address={address} />;
}

mount(
  <WagmiProvider config={config}>
    <QueryClientProvider client={new QueryClient()}>
      <ConnectKitProvider>
        <ConnectKitButton />
        <Status />
      </ConnectKitProvider>
    </QueryClientProvider>
  </WagmiProvider>,
);
