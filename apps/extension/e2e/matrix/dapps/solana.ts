/**
 * Solana (devnet): @solana/wallet-adapter over the Wallet Standard (getWallets → StandardWalletAdapter, as
 * wallet-adapter-react's useStandardWalletAdapters does), signMessage verified with @solana/wallet-standard-util,
 * and a 1-lamport SystemProgram transfer to yourself sent with adapter.sendTransaction (solana:signAndSendTransaction).
 */
import { getWallets } from "@wallet-standard/app";
import { isWalletAdapterCompatibleStandardWallet } from "@solana/wallet-adapter-base";
import { StandardWalletAdapter } from "@solana/wallet-standard-wallet-adapter-base";
import { verifyMessageSignature } from "@solana/wallet-standard-util";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { MESSAGE, expose, waitFor } from "../dapp-kit";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
let adapter: StandardWalletAdapter;

expose({
  info: { dapp: "@solana/wallet-adapter (StandardWalletAdapter) + @solana/web3.js in a local page, devnet", why: "the wallet-adapter example dapp is this library in a React shell; a local page avoids its build and CDN" },
  steps: {
    connect: async () => {
      const wallet = await waitFor(() => getWallets().get().find((w) => w.name === "Clip Wallet" && isWalletAdapterCompatibleStandardWallet(w)), "Clip Wallet (Wallet Standard)");
      adapter = new StandardWalletAdapter({ wallet: wallet as never });
      await adapter.connect();
      return { address: adapter.publicKey!.toBase58() };
    },
    sign: async () => {
      const message = new TextEncoder().encode(MESSAGE);
      const signature = await adapter.signMessage!(message);
      const valid = verifyMessageSignature({ message, signedMessage: message, signature, publicKey: adapter.publicKey!.toBytes() });
      return { valid, how: "@solana/wallet-standard-util verifyMessageSignature (ed25519)" };
    },
    send: async () => {
      const me = adapter.publicKey!;
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: me, toPubkey: new PublicKey(me), lamports: 1 }));
      tx.feePayer = me;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      return { id: await adapter.sendTransaction(tx, connection) };
    },
  },
});
