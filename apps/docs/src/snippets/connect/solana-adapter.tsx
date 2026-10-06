import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { clusterApiUrl } from "@solana/web3.js";
import { clipSolanaAdapter } from "@clip-wallet/connect/solana";

export function Providers({ children }: { children: React.ReactNode }) {
  // One adapter that prefers Clip Wallet, else another installed Solana wallet; null when there is none.
  const wallets = useMemo(() => {
    const adapter = clipSolanaAdapter();
    return adapter ? [adapter] : [];
  }, []);
  return (
    <ConnectionProvider endpoint={clusterApiUrl("devnet")}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
