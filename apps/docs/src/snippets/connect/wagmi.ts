import { connect, createConfig, http } from "@wagmi/core";
import { baseSepolia } from "@wagmi/core/chains";
import { clipConnect } from "@clip-wallet/connect/wagmi";

export const config = createConfig({
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http() },
  // wagmi's own injected connector, pointed at Clip Wallet's EIP-6963 provider. wagmi still lists every other wallet.
  connectors: [clipConnect()],
});

export async function connectPreferringClip() {
  const [clip] = config.connectors.filter((c) => c.id === "clipConnect");
  return connect(config, { connector: clip! });
}
