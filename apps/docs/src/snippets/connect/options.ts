import { connect, type ConnectOptions } from "@clip-wallet/connect";

const options: ConnectOptions = {
  // Which wallet to prefer when several are installed. Default: Clip Wallet. Kit-built wallets announce their own.
  prefer: { rdns: "com.example.mywallet", name: "My Wallet" },
  // Families to connect. EVM by default; each other family asks once through the Wallet Standard.
  families: ["evm", "solana"],
  // EVM chains your app works on: balances, pay() without a chain, and the WalletConnect fallback.
  chains: [84532, 11155111],
  // Read-only RPC per chain id, so balances() can read chains the wallet isn't on right now.
  rpc: { 84532: "https://sepolia.base.org", 11155111: "https://ethereum-sepolia-rpc.publicnode.com" },
  // How long to wait for wallets to announce themselves (EIP-6963, Wallet Standard). Default 120 ms.
  waitMs: 200,
};

export const wallet = await connect(options);
