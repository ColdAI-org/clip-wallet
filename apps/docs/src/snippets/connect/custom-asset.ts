import { BUILTIN_ASSETS, connect, type AssetSpec } from "@clip-wallet/connect";

// Built in: each EVM chain's native coin ("eth", "hbar", "pol", "avax") and Circle's USDC ("usdc").
console.log(BUILTIN_ASSETS.map((a) => a.key));

// Anything else: give it a key and its address per chain. Same key = same asset on every chain.
const exampleToken: AssetSpec = {
  key: "exm",
  symbol: "EXM",
  decimals: 18,
  on: { "eip155:84532": "0x0000000000000000000000000000000000001234" },
};

const wallet = await connect({ chains: [84532], assets: [exampleToken] });
await wallet.pay({ asset: "exm", amount: "1.5", to: "0x000000000000000000000000000000000000dEaD" });

// A token you don't want to name: pass its address and decimals instead of a key (needs `chain`).
await wallet.pay({ asset: { address: "0x0000000000000000000000000000000000001234", decimals: 18, symbol: "EXM" }, amount: 1n, to: "0x000000000000000000000000000000000000dEaD", chain: 84532 });
