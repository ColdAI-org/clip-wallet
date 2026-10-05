/**
 * An unmodified Reown AppKit dapp (wagmi adapter). AppKit lists injected wallets from EIP-6963 announcements; the
 * injected path needs no WalletConnect relay, so a placeholder project id is enough (the e2e blocks every request to
 * Reown's servers). Discovery only: AppKit's own connect goes through the same wagmi connector the wagmi dapp covers.
 */
import { createAppKit } from "@reown/appkit";
import { sepolia } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";

const projectId = "00000000000000000000000000000000";
const wagmiAdapter = new WagmiAdapter({ networks: [sepolia], projectId });
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks: [sepolia],
  projectId,
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
});

const steps: Record<string, () => Promise<unknown>> = {
  discover: async () => {
    for (let i = 0; i < 100; i++) {
      const hit = appKit.getConnectors().find((c) => c.info?.rdns === "org.coldai.clipwallet" || c.id === "org.coldai.clipwallet");
      if (hit) return { name: hit.name, type: hit.type, chain: hit.chain, rdns: hit.info?.rdns ?? null };
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("AppKit did not list Clip Wallet");
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
