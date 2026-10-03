import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";
import { Asset, StrKey } from "@stellar/stellar-base";

/**
 * Stellar networks. CAIP-2 ids per ChainAgnostic namespaces/stellar/caip2.md: `stellar:testnet`, `stellar:pubnet`
 * (also the chain ids WalletConnect and stellar-wallets-kit use). Passphrases checked against `GET /` on each
 * public Horizon (`network_passphrase`) and Soroban RPC `getNetwork`.
 */
export type StellarNet = "testnet" | "pubnet";

export const STELLAR_PASSPHRASES: Record<StellarNet, string> = {
  testnet: "Test SDF Network ; September 2015",
  pubnet: "Public Global Stellar Network ; September 2015",
};

export const STELLAR_HORIZON: Record<StellarNet, string> = {
  testnet: "https://horizon-testnet.stellar.org",
  pubnet: "https://horizon.stellar.org",
};

/**
 * Soroban RPC. SDF runs a public RPC for testnet only (developers.stellar.org "RPC providers"); mainnet needs a
 * provider, so it is unset by default and configurable with `createStellarModule({ sorobanRpcUrl })`.
 */
export const STELLAR_SOROBAN_RPC: Partial<Record<StellarNet, string>> = {
  testnet: "https://soroban-testnet.stellar.org",
};

/** Circle USDC issuers (developers.circle.com "USDC contract addresses"). */
export const USDC_ISSUERS: Record<StellarNet, string> = {
  pubnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

/** Native XLM: 7 decimals (1 XLM = 10,000,000 stroops). */
export const XLM_DECIMALS = 7;

export function xlmAsset(networkId: NetworkId): AssetRef {
  return { key: "xlm", symbol: "XLM", name: "Stellar Lumens", decimals: XLM_DECIMALS, networkId };
}

function network(net: StellarNet): Network {
  const id = `stellar:${net}`;
  return {
    id,
    family: "stellar",
    name: net === "pubnet" ? "Stellar" : "Stellar Testnet",
    nativeAsset: xlmAsset(id),
    testnet: net === "testnet",
    rpcUrls: [STELLAR_HORIZON[net]],
    explorerUrl: `https://stellar.expert/explorer/${net === "pubnet" ? "public" : "testnet"}`,
  };
}

export const STELLAR_TESTNET = network("testnet");
export const STELLAR_PUBNET = network("pubnet");
export const STELLAR_NETWORKS: Network[] = [STELLAR_TESTNET, STELLAR_PUBNET];

export function netOf(networkId: NetworkId): StellarNet | null {
  if (networkId === "stellar:testnet") return "testnet";
  if (networkId === "stellar:pubnet") return "pubnet";
  return null;
}

/** Network passphrase for a NetworkId (`stellar:testnet` / `stellar:pubnet`). */
export function networkPassphrase(networkId: NetworkId): string {
  const n = netOf(networkId);
  if (!n) throw new Error(`Not a Stellar network: ${networkId}`);
  return STELLAR_PASSPHRASES[n];
}

/** NetworkId for a passphrase, or null for an unknown (private) network. */
export function fromPassphrase(passphrase: string): NetworkId | null {
  for (const [n, p] of Object.entries(STELLAR_PASSPHRASES)) if (p === passphrase) return `stellar:${n}`;
  return null;
}

/** A classic asset as Stellar describes it (SEP-11 "CODE:ISSUER", or "native"). */
export interface ClassicAsset {
  code: string;
  issuer?: string;
}

/**
 * AssetRef for a classic asset. `address` is the SEP-11 canonical form "CODE:ISSUER".
 * Circle's USDC → key "usdc"; others `stellar:<CODE>-<ISSUER>`. Anything else calling itself USDC is spam.
 */
export function classicAsset(networkId: NetworkId, code: string, issuer?: string): AssetRef {
  if (!issuer || code === "native") return xlmAsset(networkId);
  const n = netOf(networkId);
  const isUsdc = n !== null && code === "USDC" && issuer === USDC_ISSUERS[n];
  const asset: AssetRef = {
    key: isUsdc ? "usdc" : `stellar:${code}-${issuer}`,
    symbol: code,
    name: isUsdc ? "USD Coin" : code,
    decimals: XLM_DECIMALS,
    networkId,
    address: `${code}:${issuer}`,
  };
  if (!isUsdc && looksLikeUsdc(code)) asset.spam = true;
  if (code === "XLM") asset.spam = true; // a credit asset pretending to be lumens
  return asset;
}

function looksLikeUsdc(code: string): boolean {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.startsWith("USDC") || c === "USD" || c === "U5DC";
}

/** Parses an AssetRef (or a classic asset) into a stellar-base Asset. */
export function toStellarAsset(a: AssetRef | ClassicAsset): Asset {
  if ("key" in a) {
    if (!a.address) return Asset.native();
    const [code, issuer] = a.address.split(":");
    if (!code || !issuer || !StrKey.isValidEd25519PublicKey(issuer)) throw new Error(`not a classic Stellar asset: ${a.address}`);
    return new Asset(code, issuer);
  }
  if (!a.issuer || a.code === "native") return Asset.native();
  return new Asset(a.code, a.issuer);
}

export function assetOf(networkId: NetworkId, a: Asset): AssetRef {
  return a.isNative() ? xlmAsset(networkId) : classicAsset(networkId, a.getCode(), a.getIssuer());
}

/** SEP-41 / Soroban token AssetRef (decimals and symbol from the contract when known). */
export function sep41Asset(networkId: NetworkId, contract: string, meta?: { symbol?: string; name?: string; decimals?: number }): AssetRef {
  return {
    key: `sep41:${contract}`,
    symbol: meta?.symbol || `${contract.slice(0, 4)}…${contract.slice(-4)}`,
    name: meta?.name || meta?.symbol || "Token",
    decimals: meta?.decimals ?? 0,
    networkId,
    address: contract,
  };
}

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/tx/${hash}`;
}
