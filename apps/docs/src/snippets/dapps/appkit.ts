// Reown AppKit lists Clip Wallet under "Installed" (EIP-6963). The injected path needs no WalletConnect traffic.
import { createAppKit } from "@reown/appkit";
import { sepolia } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const projectId = "YOUR_REOWN_PROJECT_ID";
const wagmiAdapter = new WagmiAdapter({ networks: [sepolia], projectId });

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [sepolia],
  projectId,
  metadata: { name: "Example app", description: "Example app", url: "https://example.app", icons: [] },
});

// In your HTML: <appkit-button></appkit-button>
