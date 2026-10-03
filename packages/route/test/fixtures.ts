import type { AssetRef, TokenBalance } from "@clip-wallet/core";
import type { Edge, Ledger, RouteGraphData } from "../src/clprouter.js";
import type { RouterDeployment } from "../src/deployments.js";

export const SEPOLIA = "eip155:11155111";
export const BASE_SEPOLIA = "eip155:84532";
export const HEDERA = "hedera:testnet";
export const HEDERA_LEDGER = "eip155:296";

const CH1 = `0x${"11".repeat(32)}`;
const CH2 = `0x${"22".repeat(32)}`;
const CH3 = `0x${"33".repeat(32)}`;
export const CONN1 = `0x${"a1".repeat(32)}`;
const CONN2 = `0x${"a2".repeat(32)}`;
const CONN3 = `0x${"a3".repeat(32)}`;

function ledger(id: string, name: string, nativeUsd: number, gasPriceNative: number): Ledger {
  return { id, name, nativeUsd, gasPriceNative, enqueueGas: 200_000, execGasPerMessage: 300_000, avgTxGas: 100_000 };
}

function edge(from: string, to: string, channelId: string, connectorId: string, over: Partial<Edge> = {}): Edge {
  return {
    from,
    to,
    channelId,
    verifierFamily: "ethereum-sync-committee",
    trustTier: "committee",
    finalized: true,
    timing: { sourceFinalityS: 780, bundleCadenceS: 60, proofGenS: 30, verifyS: 10 },
    bundle: { gas: 1_000_000, calldataBytes: 20_000, messagesPerBundle: 4 },
    connectors: [{ id: connectorId, marginUsd: 0.05, balanceUsd: 1_000, successRate: 0.99 }],
    status: "active",
    history: { attempts: 100, successes: 99, pauses30d: 0 },
    maxPayloadBytes: 8192,
    offChain: { kWhPerBundle: 0.002, gridKgPerKWh: 0.3 },
    ...over,
  };
}

/** Sepolia -> Hedera (sync committee), Base Sepolia -> Sepolia, and the stub-verified way back Hedera -> Sepolia. */
export function fixtureGraph(): RouteGraphData {
  return {
    version: "fixture",
    ledgers: [
      ledger(SEPOLIA, "Ethereum (Sepolia test network)", 2000, 2e-9),
      ledger(BASE_SEPOLIA, "Base (Sepolia test network)", 2000, 1e-10),
      ledger(HEDERA_LEDGER, "Hedera (test network)", 0.1, 7e-7),
    ],
    edges: [
      edge(SEPOLIA, HEDERA_LEDGER, CH1, CONN1),
      edge(HEDERA_LEDGER, SEPOLIA, CH1, CONN1, { verifierFamily: "test-only-stub", trustTier: "attested", notes: "TEST ONLY" }),
      edge(BASE_SEPOLIA, SEPOLIA, CH2, CONN2, { timing: { sourceFinalityS: 120, bundleCadenceS: 30, proofGenS: 30, verifyS: 10 } }),
      edge(SEPOLIA, BASE_SEPOLIA, CH2, CONN2),
      edge(BASE_SEPOLIA, HEDERA_LEDGER, CH3, CONN3, { status: "paused" }),
    ],
  };
}

/** Same graph, but the only way into Hedera is a stub verifier. */
export function stubOnlyGraph(): RouteGraphData {
  const g = fixtureGraph();
  g.edges[0] = { ...g.edges[0]!, verifierFamily: "test-only-stub", trustTier: "attested" };
  return g;
}

function dep(networkId: string, routerLedgerId: string, chainId: number, router: string, testnet: boolean): RouterDeployment {
  return {
    networkId,
    routerLedgerId,
    chainId,
    testnet,
    router: router as `0x${string}`,
    clprService: "0xa6db474e3047c3d43b10a4ff7abad547d89982b9",
    providerRegistry: "0x6D8a65a9E85C423ACe3E0C4074508a9AcD63958c",
    quarantineVault: "0x6f7756640C2cf1db14d2789F33966D0eB0960b4a",
    fixtures: {},
    inboundVerifiers: {},
    status: "fixture",
  };
}

export const ROUTER_SEPOLIA = "0x3Ec8a28f6AD20FE1070819f56B29be120700A653";
export const ROUTER_HEDERA = "0xF398F961088af7aF74bff8fc409a535023913E5F";
export const ROUTER_BASE = "0x00000000000000000000000000000000000000bA";

export function fixtureDeployments(testnet = true): RouterDeployment[] {
  return [
    dep(SEPOLIA, SEPOLIA, 11155111, ROUTER_SEPOLIA, testnet),
    dep(BASE_SEPOLIA, BASE_SEPOLIA, 84532, ROUTER_BASE, testnet),
    dep(HEDERA, HEDERA_LEDGER, 296, ROUTER_HEDERA, testnet),
  ];
}

export const HBAR: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: HEDERA };
export const ETH_SEPOLIA: AssetRef = { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: SEPOLIA };
export const ETH_BASE: AssetRef = { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: BASE_SEPOLIA };
export const USDC_HEDERA: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: HEDERA, address: "0.0.429274" };
export const USDC_BASE: AssetRef = { key: "usdc", symbol: "USDC", name: "USD Coin", decimals: 6, networkId: BASE_SEPOLIA, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
export const USDC_BRIDGED: AssetRef = { ...USDC_BASE, key: "usdc.e", bridged: true, networkId: SEPOLIA, address: "0x1111111111111111111111111111111111111111" };

export const PORTFOLIO: TokenBalance[] = [
  { asset: HBAR, amount: "100000000" }, // 1 HBAR
  { asset: ETH_SEPOLIA, amount: "500000000000000000", fiatValue: 1000 }, // 0.5 ETH
  { asset: ETH_BASE, amount: "0" },
  { asset: USDC_BASE, amount: "40000000", fiatValue: 40 },
  { asset: USDC_BRIDGED, amount: "5000000", fiatValue: 5 },
];

export const PAYER = "0x1234567890123456789012345678901234567890";
export const SELLER = "0x5e11e00000000000000000000000000000005e11";
export const HEDERA_APP = "0xDbB0EbcBf8fa0cE4886fbe8Ae0C24C6D68B8bC69";
