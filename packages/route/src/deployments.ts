import type { NetworkId } from "@clip-wallet/core";

/**
 * CLPRouter testnet deployment (pre-audit, re-audit in progress), copied from clprouter
 * deployments/sepolia.json and deployments/hedera-testnet.json. Every address is public and Sourcify-verified.
 *
 * State on 2026-10-01 (see clprouter deployments/README.md):
 *  - Sepolia -> Hedera Channel: open on Sepolia, NOT open on Hedera (completeChannel fails with INSUFFICIENT_GAS),
 *    so no route has been delivered yet.
 *  - The Sepolia side verifies Hedera with `TestOnlyStubVerifier`: insecure, accepts no bundles. Receipts back to
 *    Sepolia never verify; a route sent from Sepolia settles there only through `reclaim` after its deadline.
 */
export interface RouterDeployment {
  /** Wallet network id (CAIP-2 as @clip-wallet/core uses it). */
  networkId: NetworkId;
  /** Ledger id the Router uses on-chain (Hedera's Routers run on its EVM, so `eip155:296`). */
  routerLedgerId: string;
  chainId: number;
  testnet: boolean;
  router: `0x${string}`;
  clprService: `0x${string}`;
  providerRegistry: `0x${string}`;
  quarantineVault: `0x${string}`;
  /** Applications deployed for testing; never route value to them on mainnet. */
  fixtures: Record<string, `0x${string}`>;
  /** Verifiers this ledger uses to check incoming bundles, keyed by peer router ledger id. */
  inboundVerifiers: Record<string, { name: string; address: `0x${string}`; testOnly: boolean }>;
  status: string;
}

export interface ChannelDeployment {
  channelId: `0x${string}`;
  connectorId: `0x${string}`;
  /** Router ledger ids. */
  between: [string, string];
  /** Per side: is the Channel open on that ledger? */
  open: Record<string, boolean>;
}

export const SEPOLIA_NETWORK_ID = "eip155:11155111";
export const HEDERA_TESTNET_NETWORK_ID = "hedera:testnet";
export const HEDERA_MAINNET_NETWORK_ID = "hedera:mainnet";

export const TESTNET_DEPLOYMENTS: readonly RouterDeployment[] = [
  {
    networkId: SEPOLIA_NETWORK_ID,
    routerLedgerId: "eip155:11155111",
    chainId: 11155111,
    testnet: true,
    router: "0x3Ec8a28f6AD20FE1070819f56B29be120700A653",
    clprService: "0xa6db474e3047c3d43b10a4ff7abad547d89982b9",
    providerRegistry: "0x6D8a65a9E85C423ACe3E0C4074508a9AcD63958c",
    quarantineVault: "0x6f7756640C2cf1db14d2789F33966D0eB0960b4a",
    fixtures: { TestnetConnector: "0xe8cb0088BBDf16F256F854485B34117412992816" },
    inboundVerifiers: {
      "eip155:296": {
        name: "TestOnlyStubVerifier",
        address: "0xad0216795c8d30E510c6B7Cc61621A52bA36aE7A",
        testOnly: true,
      },
    },
    status: "pre-audit (re-audit in progress)",
  },
  {
    networkId: HEDERA_TESTNET_NETWORK_ID,
    routerLedgerId: "eip155:296",
    chainId: 296,
    testnet: true,
    router: "0xF398F961088af7aF74bff8fc409a535023913E5F",
    clprService: "0xa6db474e3047c3d43b10a4ff7abad547d89982b9",
    providerRegistry: "0x6D8a65a9E85C423ACe3E0C4074508a9AcD63958c",
    quarantineVault: "0x6f7756640C2cf1db14d2789F33966D0eB0960b4a",
    fixtures: {
      TestnetConnector: "0xe8cb0088BBDf16F256F854485B34117412992816",
      TestnetRouteApp: "0xDbB0EbcBf8fa0cE4886fbe8Ae0C24C6D68B8bC69",
    },
    inboundVerifiers: {
      "eip155:11155111": {
        name: "EthMainnetVerifier",
        address: "0x92646d66A66E93411D6f679f4B4BEFEBdB3371bd",
        testOnly: false,
      },
    },
    status: "pre-audit (re-audit in progress)",
  },
];

export const TESTNET_CHANNELS: readonly ChannelDeployment[] = [
  {
    channelId: "0x8a15fe9f8ea6a20841a9983e2e6176b4bcf1e01530348632d9488be92a4145e0",
    connectorId: "0xed6c8cc0435a52b5c29628f1d0751f619dfa44d212a7829d10e3b6f98df151d3",
    between: ["eip155:11155111", "eip155:296"],
    open: { "eip155:11155111": true, "eip155:296": false },
  },
];

/** Hedera's Routers run on the Hedera EVM; everything else uses its own CAIP-2 id. */
const ROUTER_LEDGER: Record<string, string> = {
  [HEDERA_TESTNET_NETWORK_ID]: "eip155:296",
  [HEDERA_MAINNET_NETWORK_ID]: "eip155:295",
};

export function routerLedgerId(networkId: NetworkId): string {
  return ROUTER_LEDGER[networkId] ?? networkId;
}

export function networkIdForRouterLedger(ledgerId: string): NetworkId {
  for (const [net, ledger] of Object.entries(ROUTER_LEDGER)) if (ledger === ledgerId) return net;
  return ledgerId;
}

export function isHederaNetwork(networkId: NetworkId): boolean {
  return networkId.startsWith("hedera:") || networkId === "eip155:296" || networkId === "eip155:295";
}

export function findDeployment(
  deployments: readonly RouterDeployment[],
  networkIdOrLedger: string,
): RouterDeployment | undefined {
  return deployments.find((d) => d.networkId === networkIdOrLedger || d.routerLedgerId === networkIdOrLedger);
}
