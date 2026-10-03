import type { Family, Network, NetworkId } from "@clip-wallet/core";

/**
 * Network helpers. 1Mask never invents networks: everything here is derived from the
 * wallet's network registry (`Network[]` handed in by the extension).
 */

export function parseCaip2(id: NetworkId): { namespace: string; reference: string } | undefined {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return undefined;
  return { namespace: id.slice(0, i), reference: id.slice(i + 1) };
}

/** Numeric EVM chain id for an eip155 network, from `chainId` or the CAIP-2 reference. */
export function evmChainId(net: Network): number | undefined {
  if (typeof net.chainId === "number") return net.chainId;
  const p = parseCaip2(net.id);
  if (p?.namespace !== "eip155") return undefined;
  const n = Number(p.reference);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function toHexChainId(n: number): string {
  return `0x${n.toString(16)}`;
}

/** Parses "0x1", "0X01", or a decimal string/number into a chain id. */
export function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const v = value.trim();
  const n = /^0x[0-9a-f]+$/i.test(v) ? Number.parseInt(v.slice(2), 16) : /^[0-9]+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function findEvmNetwork(networks: readonly Network[], chainId: number): Network | undefined {
  return networks.find((n) => n.id.startsWith("eip155:") && evmChainId(n) === chainId);
}

/* ---------------------------------------------------------------- Wallet Standard chain ids */

/** CAIP-2 genesis-hash references → Solana Wallet Standard chain ids (@solana/wallet-standard-chains). */
export const SOLANA_GENESIS_TO_WS: Record<string, `solana:${string}`> = {
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "solana:mainnet",
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1: "solana:devnet",
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z": "solana:testnet",
};

/** CAIP-2 bip122 genesis references → Bitcoin Wallet Standard chain ids (@exodus/bitcoin-wallet-standard BITCOIN_CHAINS). */
export const BITCOIN_GENESIS_TO_WS: Record<string, `bitcoin:${string}`> = {
  "000000000019d6689c085ae165831e93": "bitcoin:mainnet",
  "000000000933ea01ad0ee984209779ba": "bitcoin:testnet", // testnet3
  "00000000da84f2bafbbc53dee25a72ae": "bitcoin:testnet", // testnet4 (no separate Wallet Standard id yet)
  "00000008819873e925422c1ff0f99f7c": "bitcoin:signet",
  "0f9188f13cb7b2c71f2a335e3a4fc328": "bitcoin:regtest",
};

/** Wallet Standard chain id for a registry network ("solana:devnet", "bitcoin:testnet"). */
export function walletStandardChain(net: Network): `${string}:${string}` | undefined {
  const p = parseCaip2(net.id);
  if (!p) return undefined;
  if (p.namespace === "solana") return SOLANA_GENESIS_TO_WS[p.reference];
  if (p.namespace === "bip122") return BITCOIN_GENESIS_TO_WS[p.reference];
  return undefined;
}

/** Resolve a Wallet Standard chain id (or a CAIP-2 id) back to a registry network of the family. */
export function networkForChain(
  networks: readonly Network[],
  family: Family,
  chain: string | undefined,
): Network | undefined {
  if (!chain) return undefined;
  return networks.find((n) => n.family === family && (n.id === chain || walletStandardChain(n) === chain));
}

/**
 * Hedera's EVM chains. Decision (see README "Hedera"): JSON-RPC style requests on eip155:295/296/297
 * stay family "evm" and are served by chains-evm through the Hashio JSON-RPC relay; native
 * `hedera_*` methods arrive over WalletConnect with family "hedera".
 */
export const HEDERA_EVM_CHAIN_IDS = { mainnet: 295, testnet: 296, previewnet: 297 } as const;

/** Default `familyForNetwork` hook: the registry's own family. */
export function defaultFamilyForNetwork(net: Network): Family {
  return net.family;
}
