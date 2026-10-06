// Home shows one row per asset: same-issuer balances merge across networks; bridged copies stay separate.
import { mergeBalances } from "@clip-wallet/ui";
import type { AssetRef, TokenBalance } from "@clip-wallet/core";

const usdc = (networkId: string, address: string): AssetRef => ({ key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId, address });

const balances: TokenBalance[] = [
  { asset: usdc("eip155:84532", "0x036CbD53842c5426634e7929541eC2318f3dCF7e"), amount: "300000000", fiatValue: 300 }, // Base Sepolia
  { asset: usdc("eip155:11155111", "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"), amount: "112000000", fiatValue: 112 }, // Sepolia
  {
    // A bridged copy: its own key and bridged: true, so it never merges with Circle's USDC.
    asset: { key: "usdc.e", symbol: "USDC.e", name: "Bridged USDC", decimals: 6, networkId: "eip155:421614", address: "0x0000000000000000000000000000000000000abc", bridged: true },
    amount: "5000000",
    fiatValue: 5,
  },
];

const { assets, total } = mergeBalances(balances);
for (const row of assets) console.log(row.symbol, row.amount, row.bridged ? "(bridged)" : "", `${row.parts.length} network(s)`);
// USDC 412000000  2 network(s)
// USDC.e 5000000 (bridged) 1 network(s)
console.log(total); // 417
