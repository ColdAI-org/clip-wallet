import { connect } from "@clip-wallet/connect";

// Base Sepolia and Ethereum Sepolia. Clip Wallet first; any other wallet if Clip isn't installed.
const wallet = await connect({ chains: [84532, 11155111] });
console.log(wallet.wallet.name, wallet.accounts); // "Clip Wallet", ["eip155:84532:0x…"]

const paid = await wallet.pay({ asset: "usdc", amount: "25", to: "0x000000000000000000000000000000000000dEaD" });
if (paid.fallback) console.log("A plain transfer: the balance on", paid.chain, "had to cover it.");
const { status, transactionHashes } = await paid.wait(); // "confirmed" | "failed"
console.log(status, transactionHashes);
