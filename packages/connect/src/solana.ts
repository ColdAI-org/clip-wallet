/**
 * Solana wallet-adapter compatible wrapper (peer: @solana/wallet-standard-wallet-adapter-base).
 *
 *   const adapter = clipSolanaAdapter();          // StandardWalletAdapter for Clip, else another Solana wallet
 *   <WalletProvider wallets={adapter ? [adapter] : []}>   // @solana/wallet-adapter-react
 *
 * @solana/wallet-adapter-react already lists every Wallet Standard wallet by itself; this only helps an app that wants
 * a single adapter that prefers Clip Wallet (or another wallet you name).
 */
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import { CLIP_WALLET, discovered, rankStandard, startDiscovery, type Preference, type StandardWallet } from "./discovery.js";

const SOLANA_FEATURES = ["standard:connect", "standard:events", "solana:signTransaction", "solana:signAndSendTransaction"];

/** A Wallet Standard wallet that can act as a Solana wallet-adapter wallet (the adapter's own requirement list). */
export function isSolanaWallet(w: StandardWallet): boolean {
  return w.chains.some((c) => c.startsWith("solana:")) && SOLANA_FEATURES.every((f) => f in w.features);
}

export function findSolanaWallet(prefer: Preference = CLIP_WALLET): StandardWallet | undefined {
  startDiscovery();
  return rankStandard(discovered().standard.filter(isSolanaWallet), prefer)[0];
}

export function clipSolanaAdapter(prefer: Preference = CLIP_WALLET): StandardWalletAdapter | null {
  const w = findSolanaWallet(prefer);
  return w ? new StandardWalletAdapter({ wallet: w as never }) : null;
}
