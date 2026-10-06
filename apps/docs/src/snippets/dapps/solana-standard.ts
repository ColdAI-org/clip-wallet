// Without React: find Clip Wallet in the Wallet Standard registry and wrap it in a wallet-adapter adapter.
import { getWallets } from "@wallet-standard/app";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import { Connection, SystemProgram, Transaction } from "@solana/web3.js";

export async function sendOneLamportToSelf() {
  const wallet = getWallets()
    .get()
    .filter(isWalletAdapterCompatibleStandardWallet)
    .find((w) => w.name === "Clip Wallet");
  if (!wallet) throw new Error("Clip Wallet isn't installed in this browser.");
  const adapter = new StandardWalletAdapter({ wallet });
  await adapter.connect();
  const me = adapter.publicKey!;

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: me, toPubkey: me, lamports: 1 }));
  tx.feePayer = me;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  return adapter.sendTransaction(tx, connection); // solana:signAndSendTransaction
}
