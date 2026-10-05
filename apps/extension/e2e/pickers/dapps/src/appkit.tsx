/**
 * Reown AppKit 1.8 (stock <appkit-button> + modal), wagmi adapter on Sepolia. AppKit requires a project id; without
 * a real one a placeholder is passed, so Reown's cloud features (WalletConnect QR, wallet explorer, email/socials)
 * can't work and only the injected EIP-6963 path is tested. Everything else is AppKit's default.
 */
import { createAppKit } from "@reown/appkit/react";
import { sepolia } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, useAccount } from "wagmi";
import { disconnect } from "wagmi/actions";
import { Account, expose, mount } from "./kit";

const projectId = "00000000000000000000000000000000";
const wagmiAdapter = new WagmiAdapter({ networks: [sepolia], projectId });
// appkit-adapter-wagmi peers on @wagmi/core >=2.21 and pnpm resolves it to 3.x here, while the page's wagmi is 2.x;
// the config object works with both at runtime, so the types are bridged with `as never`.
const wagmiConfig = wagmiAdapter.wagmiConfig as never;
createAppKit({ adapters: [wagmiAdapter], networks: [sepolia], projectId, metadata: { name: "Clip picker matrix", description: "Clip picker matrix", url: location.origin, icons: [] } });
expose({ library: "@reown/appkit 1.8.24 + appkit-adapter-wagmi (wagmi 2)", config: "placeholder project id (injected path only)" }, { disconnect: () => disconnect(wagmiConfig) });

function Status() {
  const { address } = useAccount();
  return <Account address={address} />;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "appkit-button": Record<string, unknown>;
    }
  }
}

mount(
  <WagmiProvider config={wagmiConfig}>
    <QueryClientProvider client={new QueryClient()}>
      <appkit-button />
      <Status />
    </QueryClientProvider>
  </WagmiProvider>,
);
