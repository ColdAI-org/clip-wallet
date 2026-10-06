// Hedera testnet over EIP-1193: chain 296 through the Hashio JSON-RPC relay. Same code as any EVM chain.
import { connect, createConfig, getConnectors, http, sendTransaction } from "@wagmi/core";
import { hederaTestnet } from "@wagmi/core/chains";

export const config = createConfig({
  chains: [hederaTestnet],
  transports: { [hederaTestnet.id]: http("https://testnet.hashio.io/api") },
});

export async function payOneTinybar(to: `0x${string}`) {
  const clip = getConnectors(config).find((c) => c.id === "org.coldai.clipwallet");
  if (!clip) throw new Error("Clip Wallet isn't installed in this browser.");
  await connect(config, { connector: clip, chainId: hederaTestnet.id });
  // On Hedera's EVM, value is in weibar: 1 tinybar = 10^10 weibar.
  return sendTransaction(config, { to, value: 10_000_000_000n, chainId: hederaTestnet.id });
}
