import { connect } from "@clip-wallet/connect";

// Nothing injected (a phone browser, a browser without a wallet): fall back to WalletConnect.
// Clip Connect never ships a project id: use your own from Reown Cloud.
export const wallet = await connect({
  chains: [84532],
  walletConnect: {
    projectId: "YOUR_REOWN_PROJECT_ID",
    metadata: { name: "Example app", description: "Example app", url: "https://example.app", icons: [] },
    // Lets your bundler see the optional peer dependency; it is only loaded on this path. The wrapper adapts
    // EthereumProvider.init's options type to the loose one Clip Connect declares.
    load: async () => {
      const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
      return { EthereumProvider: { init: (o) => EthereumProvider.init(o as unknown as Parameters<typeof EthereumProvider.init>[0]) } };
    },
  },
});
