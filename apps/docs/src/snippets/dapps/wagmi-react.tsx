// wagmi (React) without a modal: list the connectors wagmi discovered over EIP-6963.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http, useAccount, useConnect } from "wagmi";
import { sepolia } from "wagmi/chains";

const config = createConfig({ chains: [sepolia], transports: { [sepolia.id]: http() } });
const queryClient = new QueryClient();

function Wallets() {
  const { connectors, connect } = useConnect();
  const { address } = useAccount();
  if (address) return <p>Connected: {address}</p>;
  return (
    <>
      {connectors.map((c) => (
        <button key={c.uid} type="button" onClick={() => connect({ connector: c })}>
          {c.icon && <img src={c.icon} alt="" width={20} height={20} />} {c.name}
        </button>
      ))}
    </>
  );
}

export function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Wallets />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
