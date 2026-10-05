/**
 * An unmodified Sui dapp: @mysten/wallet-standard detection exactly as @mysten/dapp-kit does it (getWallets +
 * isWalletWithRequiredFeatureSet), then standard:connect.
 */
import { getWallets, isWalletWithRequiredFeatureSet, type WalletWithRequiredFeatures } from "@mysten/wallet-standard";

let wallet: WalletWithRequiredFeatures | undefined;

const steps: Record<string, () => Promise<unknown>> = {
  detect: async () => {
    const all = getWallets().get().filter((w) => isWalletWithRequiredFeatureSet(w));
    wallet = all.find((w) => w.name === "Clip Wallet") as WalletWithRequiredFeatures | undefined;
    if (!wallet) throw new Error("Clip Wallet was not detected");
    return { name: wallet.name, chains: wallet.chains.filter((c) => c.startsWith("sui:")).sort(), features: Object.keys(wallet.features).sort() };
  },
  connect: async () => {
    const r = await wallet!.features["standard:connect"].connect();
    return { accounts: r.accounts.length, chains: [...(r.accounts[0]?.chains ?? [])].sort() };
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
