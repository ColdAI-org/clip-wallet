import type { AssetRef, Network, NetworkId } from "@clip-wallet/core";

/**
 * XRP Ledger networks.
 *  - CAIP-2 (ChainAgnostic namespaces, xrpl/caip2.md): "xrpl:" + the server's `network_id` — `xrpl:0` mainnet,
 *    `xrpl:1` testnet, `xrpl:2` devnet. XLS-72d (Browser Wallet Standard) uses the same ids and the aliases
 *    `xrpl:mainnet` / `xrpl:testnet` / `xrpl:devnet`.
 *  - Public JSON-RPC (no key), checked with `server_info` (network_id, validated ledger, reserves) in Oct 2026:
 *    mainnet xrplcluster.com (XRPL Labs), s1/s2.ripple.com:51234 (Ripple); testnet s.altnet.rippletest.net:51234
 *    (Ripple), testnet.xrpl-labs.com; devnet s.devnet.rippletest.net:51234.
 *  - Reserves then: 1 XRP base, 0.2 XRP per owned object (read live from `server_info`, never hard-coded in sends).
 */
export type XrplNet = "mainnet" | "testnet" | "devnet";

export interface XrplNetSpec {
  caip2: NetworkId;
  networkId: number;
  rpc: string[];
  explorer: string;
  /** Faucet that funds an address (test networks only). */
  faucet?: string;
  /** Ripple USD (RLUSD) issuer: docs.ripple.com / ripple.com/solutions/stablecoin, checked with gateway_balances. */
  rlusd?: string;
  /** Circle USDC issuer (developers.circle.com "USDC contract addresses", XRPL), checked with gateway_balances. */
  usdc?: string;
}

/** Currency codes as the ledger stores them (40 hex digits: the ASCII name, zero-padded). */
export const RLUSD_CODE = "524C555344000000000000000000000000000000";
export const USDC_CODE = "5553444300000000000000000000000000000000";

export const XRPL_NETS: Record<XrplNet, XrplNetSpec> = {
  testnet: {
    caip2: "xrpl:1",
    networkId: 1,
    rpc: ["https://s.altnet.rippletest.net:51234/", "https://testnet.xrpl-labs.com/"],
    explorer: "https://testnet.xrpl.org",
    faucet: "https://faucet.altnet.rippletest.net/accounts",
    rlusd: "rQhWct2fv4Vc4KRjRgMrxa8xPN9Zx9iLKV",
    usdc: "rHuGNhqTG32mfmAvWA8hUyWRLV3tCSwKQt",
  },
  mainnet: {
    caip2: "xrpl:0",
    networkId: 0,
    rpc: ["https://xrplcluster.com/", "https://s1.ripple.com:51234/", "https://s2.ripple.com:51234/"],
    explorer: "https://livenet.xrpl.org",
    rlusd: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De",
    usdc: "rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE",
  },
  devnet: {
    caip2: "xrpl:2",
    networkId: 2,
    rpc: ["https://s.devnet.rippletest.net:51234/"],
    explorer: "https://devnet.xrpl.org",
    faucet: "https://faucet.devnet.rippletest.net/accounts",
  },
};

/** 1 XRP = 1,000,000 drops. */
export const XRP_DECIMALS = 6;
/** Issued tokens: RLUSD and USDC are shown with 6 decimals, other tokens with 15 (the ledger keeps 16 significant digits). */
export const STABLE_DECIMALS = 6;
export const TOKEN_DECIMALS = 15;

export function xrpAsset(networkId: NetworkId): AssetRef {
  return { key: "xrp", symbol: "XRP", name: "XRP", decimals: XRP_DECIMALS, networkId };
}

function network(net: XrplNet): Network {
  const c = XRPL_NETS[net];
  return {
    id: c.caip2,
    family: "xrpl",
    name: net === "mainnet" ? "XRP Ledger" : net === "testnet" ? "XRP Ledger Testnet" : "XRP Ledger Devnet",
    nativeAsset: xrpAsset(c.caip2),
    testnet: net !== "mainnet",
    rpcUrls: c.rpc,
    explorerUrl: c.explorer,
  };
}

export const XRPL_TESTNET = network("testnet");
export const XRPL_MAINNET = network("mainnet");
export const XRPL_DEVNET = network("devnet");
export const XRPL_NETWORKS: Network[] = [XRPL_TESTNET, XRPL_MAINNET, XRPL_DEVNET];

const ALIASES: Record<string, XrplNet> = { "xrpl:mainnet": "mainnet", "xrpl:testnet": "testnet", "xrpl:devnet": "devnet" };

/** "xrpl:1", "xrpl:testnet" (XLS-72d alias), "1" or 1 → the network, else null. */
export function netOf(chain: string | number): XrplNet | null {
  if (typeof chain === "string" && ALIASES[chain]) return ALIASES[chain]!;
  const id = typeof chain === "number" ? chain : /^(?:xrpl:)?(\d+)$/.exec(chain)?.[1];
  for (const [name, c] of Object.entries(XRPL_NETS) as [XrplNet, XrplNetSpec][]) if (String(c.networkId) === String(id)) return name;
  return null;
}

/** The CAIP-2 id for any XLS-72d chain identifier this wallet knows, else null. */
export function fromChainId(chain: string | number): NetworkId | null {
  const n = netOf(chain);
  return n ? XRPL_NETS[n].caip2 : null;
}

export function specFor(networkId: NetworkId): XrplNetSpec | null {
  const n = netOf(networkId);
  return n ? XRPL_NETS[n] : null;
}

/** Readable name of a ledger currency code ("USD", "RLUSD"; 40-hex ASCII names decoded; others shortened). */
export function currencyName(code: string): string {
  if (code.length !== 40) return code;
  if (/^03/i.test(code)) return "LP token"; // XLS-30 AMM LP tokens
  const bytes = code.match(/../g)!.map((h) => parseInt(h, 16));
  const end = bytes.findIndex((b, i) => b === 0 && bytes.slice(i).every((x) => x === 0));
  const text = bytes.slice(0, end < 0 ? 20 : end);
  if (text.length && text.every((b) => b >= 0x20 && b < 0x7f)) return String.fromCharCode(...text);
  return `${code.slice(0, 6)}…`;
}

function looksLikeStable(name: string): boolean {
  const c = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^(US|U5)D/.test(c) || c.includes("USDC") || c.includes("RLUSD") || c.includes("USDT") || c === "XRP";
}

/**
 * AssetRef for an issued token. `address` is "<currency>.<issuer>" (CAIP-19 xrpl `token:` reference). Ripple's RLUSD
 * → key "rlusd", Circle's USDC → key "usdc"; anything else is `xrpl:<currency>.<issuer>`, and an unknown issuer's
 * token that looks like a dollar stablecoin or XRP is marked spam.
 */
export function tokenAsset(networkId: NetworkId, currency: string, issuer: string): AssetRef {
  const spec = specFor(networkId);
  const upper = currency.length === 40 ? currency.toUpperCase() : currency;
  const isRlusd = !!spec?.rlusd && issuer === spec.rlusd && upper === RLUSD_CODE;
  const isUsdc = !!spec?.usdc && issuer === spec.usdc && upper === USDC_CODE;
  const symbol = isRlusd ? "RLUSD" : isUsdc ? "USDC" : currencyName(currency);
  const asset: AssetRef = {
    key: isRlusd ? "rlusd" : isUsdc ? "usdc" : `xrpl:${upper}.${issuer}`,
    symbol,
    name: isRlusd ? "Ripple USD" : isUsdc ? "USD Coin" : symbol,
    decimals: isRlusd || isUsdc ? STABLE_DECIMALS : TOKEN_DECIMALS,
    networkId,
    address: `${upper}.${issuer}`,
  };
  if (!isRlusd && !isUsdc && looksLikeStable(symbol)) asset.spam = true;
  return asset;
}

/** The known tokens on a network (for sends and the token list). */
export function knownTokens(networkId: NetworkId): AssetRef[] {
  const s = specFor(networkId);
  const out: AssetRef[] = [];
  if (s?.rlusd) out.push(tokenAsset(networkId, RLUSD_CODE, s.rlusd));
  if (s?.usdc) out.push(tokenAsset(networkId, USDC_CODE, s.usdc));
  return out;
}

export function explorerTxUrl(net: Network, hash: string): string {
  return `${net.explorerUrl}/transactions/${hash}`;
}
