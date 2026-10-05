/**
 * Phase 3: the settle client for this build (`settleClientFor`), and `settleFundingOption`, a one-line description of
 * the best Connector quote for a shortfall. Paying through a quote is ./settle-funding.ts (`SettleFunding`).
 */
import type { AssetRef, Network } from "@clip-wallet/core";
import { SETTLE_DEPLOYMENTS, settleOnHedera, type CoverAssetConfig, type SettleOnHederaClient } from "./phase3.js";
import type { Shortfall } from "./types.js";

export interface SettleFundingOption {
  /** "Get 25 USDC from a bonded Connector" (the quote's own title). */
  title: string;
  /** Deposit · fee · what you're paid if it's late · time, in the quote's plain words. */
  detail: string;
}

/** HBAR as the order book's cover asset (address(0) = HBAR in tinybars inside Hedera's EVM). */
function hbarCover(hederaChainId: number): CoverAssetConfig {
  const asset: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: `eip155:${hederaChainId}` };
  return { address: "0x0000000000000000000000000000000000000000", asset };
}

/**
 * The settle client for this build, or null: off unless the config switch is on AND a deployment for the network
 * is known (SETTLE_DEPLOYMENTS: testnet only).
 */
export function settleClientFor(o: { enabled: boolean; mainnet: boolean; mirrorNodeUrl?: string; fetch?: typeof fetch }): SettleOnHederaClient | null {
  if (!o.enabled) return null;
  const dep = SETTLE_DEPLOYMENTS.find((d) => d.network === (o.mainnet ? "mainnet" : "testnet"));
  if (!dep) return null;
  return settleOnHedera({
    ...dep,
    ...(o.mirrorNodeUrl ? { mirrorNodeUrl: o.mirrorNodeUrl } : {}),
    ...(o.fetch ? { fetch: o.fetch } : {}),
    coverAssets: [hbarCover(dep.hederaChainId)],
  });
}

/**
 * The best Connector quote for one shortfall, paid from the same asset on another EVM network, delivered to `account`.
 * Null when there is nothing to pay from, no Connector answers, or anything fails (the normal route still shows).
 */
export async function settleFundingOption(settle: SettleOnHederaClient, s: Shortfall, account: string | undefined, networks: Network[]): Promise<SettleFundingOption | null> {
  if (!account) return null;
  const from = s.sameAssetElsewhere.find((b) => b.asset.networkId.startsWith("eip155:") && networks.some((n) => n.id === b.asset.networkId));
  if (!from) return null;
  try {
    const [q] = await settle.quoteConnectors({
      from: { networkId: from.asset.networkId, asset: from.asset },
      to: { networkId: s.asset.networkId, asset: s.asset, amount: s.missing, recipient: account },
      user: account,
    });
    if (!q) return null;
    const d = q.display;
    return {
      title: q.title ?? `Get ${s.asset.symbol} from a bonded Connector`,
      detail: d ? [d.deposit, d.fee, d.cover, d.time].filter(Boolean).join(" · ") : (q.steps ?? []).join(" · "),
    };
  } catch {
    return null;
  }
}
