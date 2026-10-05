/**
 * An unmodified Solana dapp: @solana/wallet-adapter over the Wallet Standard (getWallets → StandardWalletAdapter, as
 * @solana/wallet-adapter-react's useStandardWalletAdapters does), connect and signMessage.
 */
import { getWallets } from "@wallet-standard/app";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";

let adapter: StandardWalletAdapter | undefined;

const find = () => {
  const wallet = getWallets()
    .get()
    .find((w) => w.name === "Clip Wallet" && isWalletAdapterCompatibleStandardWallet(w));
  if (!wallet) throw new Error("Clip Wallet was not detected");
  return wallet;
};

const steps: Record<string, () => Promise<unknown>> = {
  detect: async () => {
    adapter = new StandardWalletAdapter({ wallet: find() as never });
    return { name: adapter.name, readyState: adapter.readyState, supportedTransactionVersions: [...(adapter.supportedTransactionVersions ?? [])].sort() };
  },
  connect: async () => {
    await adapter!.connect();
    return { connected: adapter!.connected, publicKey: adapter!.publicKey?.toBase58().length ? "base58" : "none" };
  },
  signMessage: async () => {
    const sig = await adapter!.signMessage!(new TextEncoder().encode("Hello from an unmodified Solana dapp"));
    return { bytes: sig.length };
  },
};

(window as unknown as { __compat: unknown }).__compat = { run: (s: string) => steps[s]!() };
