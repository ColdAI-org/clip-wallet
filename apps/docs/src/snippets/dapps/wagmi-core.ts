// wagmi (core) finds Clip Wallet through EIP-6963 on its own: the connector id is the wallet's rdns.
import { connect, createConfig, getConnectors, http, signMessage } from "@wagmi/core";
import { sepolia } from "@wagmi/core/chains";

export const config = createConfig({
  chains: [sepolia],
  transports: { [sepolia.id]: http() },
  multiInjectedProviderDiscovery: true, // the default; shown for clarity
});

export async function connectAndSign() {
  const clip = getConnectors(config).find((c) => c.id === "org.coldai.clipwallet");
  if (!clip) throw new Error("Clip Wallet isn't installed in this browser.");
  const { accounts } = await connect(config, { connector: clip, chainId: sepolia.id });
  const signature = await signMessage(config, { message: "Sign in to example.app" });
  return { address: accounts[0], signature };
}
