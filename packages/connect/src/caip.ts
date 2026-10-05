/**
 * CAIP-2 chain ids and CAIP-10 account ids (https://chainagnostic.org/CAIPs/caip-2, caip-10) for every family a
 * wallet can expose, plus the Wallet Standard chain names that map onto them.
 */

/** "eip155:1", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "sui:testnet", "bip122:000000000019d6689c085ae165831e93". */
export type Caip2 = `${string}:${string}`;
/** "<caip2>:<address>". */
export type Caip10 = `${string}:${string}:${string}`;

/** Wallet Standard chain names whose CAIP-2 reference differs (Solana genesis hashes, Bitcoin genesis prefixes). */
const WALLET_STANDARD_TO_CAIP2: Record<string, Caip2> = {
  "solana:mainnet": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana:devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  "solana:testnet": "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  "bitcoin:mainnet": "bip122:000000000019d6689c085ae165831e93",
  "bitcoin:testnet": "bip122:000000000933ea01ad0ee984209779ba",
  "bitcoin:signet": "bip122:00000008819873e925422c1ff0f99f7c",
  "bitcoin:regtest": "bip122:0f9188f13cb7b2c71f2a335e3a4fc328",
};

/** A Wallet Standard chain ("solana:devnet") or a CAIP-2 id as CAIP-2. */
export function toCaip2(chain: string): Caip2 {
  return WALLET_STANDARD_TO_CAIP2[chain] ?? (chain as Caip2);
}

/** The Wallet Standard name of a CAIP-2 chain, when it has one ("solana:EtWT…" → "solana:devnet"). */
export function toWalletStandardChain(caip2: string): string {
  for (const [ws, c] of Object.entries(WALLET_STANDARD_TO_CAIP2)) if (c === caip2) return ws;
  return caip2;
}

export function evmCaip2(chainId: number | string): Caip2 {
  const n = typeof chainId === "number" ? chainId : chainId.startsWith("0x") ? Number.parseInt(chainId, 16) : Number(chainId);
  return `eip155:${n}`;
}

/** eip155 CAIP-2 → numeric chain id, else undefined. */
export function evmChainId(caip2: string): number | undefined {
  const m = /^eip155:(\d+)$/.exec(caip2);
  return m ? Number(m[1]) : undefined;
}

export function caip10(chain: Caip2, address: string): Caip10 {
  return `${chain}:${address}`;
}

export function parseCaip10(id: string): { chain: Caip2; namespace: string; address: string } | undefined {
  const parts = id.split(":");
  if (parts.length < 3) return undefined;
  const address = parts.slice(2).join(":");
  return { chain: `${parts[0]}:${parts[1]}`, namespace: parts[0]!, address };
}

export const toHex = (n: number | bigint) => `0x${n.toString(16)}` as `0x${string}`;
