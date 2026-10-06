import { connect, type Eip1193Provider } from "@clip-wallet/connect";
import { appKit } from "./appkit"; // your createAppKit() instance

// Or reuse any EIP-1193 provider you already have, such as Reown AppKit's.
export const wallet = await connect({
  chains: [11155111],
  fallback: async () => {
    const provider = appKit.getProvider<Eip1193Provider>("eip155");
    if (!provider) throw new Error("Open AppKit and connect a wallet first.");
    return provider;
  },
});
