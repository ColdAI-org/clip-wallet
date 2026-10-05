/**
 * An unmodified Sui dapp: @mysten/wallet-standard detection exactly as @mysten/dapp-kit does it (getWallets +
 * isWalletWithRequiredFeatureSet with its required sui:signTransaction and sui-chain filter), then standard:connect.
 */
import { getWallets, isWalletWithRequiredFeatureSet, type WalletWithRequiredFeatures } from "@mysten/wallet-standard";

let wallet: WalletWithRequiredFeatures | undefined;

const steps: Record<string, () => Promise<unknown>> = {
  detect: async () => {
    // dapp-kit's WalletProvider filter: required sui:signTransaction and a sui: chain. Without it this found Clip's
    // Solana wallet (also named "Clip Wallet", registered first) and never tested Sui at all.
    const all = getWallets()
      .get()
      .filter((w) => isWalletWithRequiredFeatureSet(w, ["sui:signTransaction"]) && w.chains.some((c) => c.startsWith("sui:")));
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
