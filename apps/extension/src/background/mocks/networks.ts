/** MOCK: testnet catalogue until the chain packages export theirs. Testnets only (AGENTS rule 6). */
import type { AssetRef, Network } from "@clip-wallet/core";

const native = (key: string, symbol: string, name: string, decimals: number, networkId: string): AssetRef => ({
  key,
  symbol,
  name,
  decimals,
  networkId,
});

export const MOCK_NETWORKS: Network[] = [
  {
    id: "eip155:84532",
    family: "evm",
    name: "Base Sepolia",
    chainId: 84532,
    nativeAsset: native("eth", "ETH", "Ether", 18, "eip155:84532"),
    testnet: true,
    rpcUrls: ["https://sepolia.base.org"],
    explorerUrl: "https://sepolia.basescan.org",
  },
  {
    id: "eip155:11155111",
    family: "evm",
    name: "Ethereum Sepolia",
    chainId: 11155111,
    nativeAsset: native("eth", "ETH", "Ether", 18, "eip155:11155111"),
    testnet: true,
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    explorerUrl: "https://sepolia.etherscan.io",
  },
  {
    id: "eip155:421614",
    family: "evm",
    name: "Arbitrum Sepolia",
    chainId: 421614,
    nativeAsset: native("eth", "ETH", "Ether", 18, "eip155:421614"),
    testnet: true,
    rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
    explorerUrl: "https://sepolia.arbiscan.io",
  },
  {
    id: "hedera:testnet",
    family: "hedera",
    name: "Hedera Testnet",
    nativeAsset: native("hbar", "HBAR", "HBAR", 8, "hedera:testnet"),
    testnet: true,
    rpcUrls: ["https://testnet.hashio.io/api"],
    explorerUrl: "https://hashscan.io/testnet",
    indexerUrl: "https://testnet.mirrornode.hedera.com",
  },
  {
    id: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    family: "solana",
    name: "Solana Devnet",
    nativeAsset: native("sol", "SOL", "Solana", 9, "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"),
    testnet: true,
    rpcUrls: ["https://api.devnet.solana.com"],
    explorerUrl: "https://explorer.solana.com/?cluster=devnet",
  },
  {
    id: "bip122:000000000933ea01ad0ee984209779ba",
    family: "bitcoin",
    name: "Bitcoin Testnet",
    nativeAsset: native("btc", "BTC", "Bitcoin", 8, "bip122:000000000933ea01ad0ee984209779ba"),
    testnet: true,
    rpcUrls: ["https://mempool.space/testnet/api"],
    explorerUrl: "https://mempool.space/testnet",
  },
];

export const NET = {
  base: "eip155:84532",
  sepolia: "eip155:11155111",
  arb: "eip155:421614",
  hedera: "hedera:testnet",
  solana: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  bitcoin: "bip122:000000000933ea01ad0ee984209779ba",
} as const;

/** USDC deployments (testnet addresses are illustrative). Same issuer → same key "usdc". */
export const USDC: Record<string, AssetRef> = {
  [NET.base]: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET.base, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" },
  [NET.sepolia]: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET.sepolia, address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" },
  [NET.hedera]: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET.hedera, address: "0.0.429274" },
  [NET.solana]: { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: NET.solana, address: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
};

export const USDC_E: AssetRef = {
  key: "usdc.e",
  symbol: "USDC.e",
  name: "Bridged USDC",
  decimals: 6,
  networkId: NET.arb,
  address: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  bridged: true,
};

/** Which assets each network can carry (used for send/receive candidates even at zero balance). */
export function knownAssets(networks: Network[]): AssetRef[] {
  return [...networks.map((n) => n.nativeAsset), ...Object.values(USDC), USDC_E];
}
