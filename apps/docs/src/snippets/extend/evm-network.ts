// A new EVM network is one entry in EVM_NETWORK_SPECS (packages/chains-evm/src/networks.ts), plus a registry test.
import { CURATED_TOKENS, looksLikeSpam, toNetwork, type EvmNetworkSpec } from "@clip-wallet/chains-evm";

export const exampleSepolia: EvmNetworkSpec = {
  slug: "example-sepolia", // what "evm:example-sepolia" in clip.config.ts matches
  name: "Example Sepolia", // shown only in Advanced mode and the network chip
  chainId: 999_999_001,
  native: { symbol: "ETH", name: "Sepolia Ether", decimals: 18, key: "eth-testnet" }, // test ETH never merges with ETH
  rpcUrls: ["https://rpc.sepolia.example.org", "https://rpc2.sepolia.example.org"], // public endpoints, no API keys
  explorerUrl: "https://explorer.sepolia.example.org",
  blockscout: "https://explorer.sepolia.example.org", // becomes Network.indexerUrl (…/api/v2)
  testnet: true,
};

const network = toNetwork(exampleSepolia);
console.log(network.id, network.testnet); // "eip155:999999001" true

// Tokens go in CURATED_TOKENS (packages/chains-evm/src/tokens.ts).
type CuratedToken = (typeof CURATED_TOKENS)[number];
export const exampleTokens: CuratedToken[] = [
  // The issuer's own deployment shares the asset key, so it merges with USDC everywhere else.
  { chainId: 999_999_001, address: "0x00000000000000000000000000000000000000a1", key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6 },
  // A bridged copy gets its own key and bridged: true. It never merges with the real thing.
  { chainId: 999_999_001, address: "0x00000000000000000000000000000000000000b2", key: "usdc.e", symbol: "USDC.e", name: "Bridged USDC", decimals: 6, bridged: true },
];

// Anything else calling itself USDC is a look-alike and stays spam.
console.log(looksLikeSpam("USDC", "USD Coin", {})); // true
console.log(looksLikeSpam("USDC", "USD Coin", { curated: true })); // false
