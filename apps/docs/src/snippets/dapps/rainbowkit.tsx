// RainbowKit lists Clip Wallet under "Installed" through EIP-6963. Nothing Clip-specific to add.
import "@rainbow-me/rainbowkit/styles.css";
import { ConnectButton, RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";

const config = getDefaultConfig({
  appName: "Example app",
  projectId: "YOUR_REOWN_PROJECT_ID", // RainbowKit needs one for its WalletConnect QR flows
  chains: [sepolia],
});
const queryClient = new QueryClient();

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <ConnectButton />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
