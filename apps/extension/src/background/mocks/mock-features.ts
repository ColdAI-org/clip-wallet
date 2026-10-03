/**
 * Fixture mode: the features (staking, swaps, …) with sample data where the real ones would call the network
 * (staking positions and validators, swap quotes, liquidity positions). Everything else (featured apps,
 * Buy links, Secure Trade's local list) is the real FeaturesService. Never used in the default build.
 */
import type { FeatureRequest, FeaturesService, StakeAssetView, SwapQuoteView, LpPositionView } from "@clip-wallet/features";
import { NET } from "./networks";

export type FeaturesLike = Pick<FeaturesService, "handle" | "refine">;

const STAKING: StakeAssetView[] = [
  {
    assetKey: "hbar",
    symbol: "HBAR",
    name: "HBAR",
    wholeBalance: true,
    howItWorks: "Your whole HBAR balance earns rewards where it is. Nothing moves and you can spend it any time.",
    rewardRate: "About 2.4% a year",
    networkId: NET.hedera,
    positions: [
      { id: "hbar-node-3", assetKey: "hbar", symbol: "HBAR", decimals: 8, amount: "125000000000", amountDisplay: "1,250 HBAR", with: "Node 3 · Hosted by LG, Seoul", status: "active", statusText: "Earning rewards", pendingReward: { amount: "41000000", display: "0.41 HBAR" }, actions: ["change", "unstake"], networkId: NET.hedera },
    ],
  },
  {
    assetKey: "sol",
    symbol: "SOL",
    name: "Solana",
    wholeBalance: false,
    howItWorks: "You put an amount of SOL in a stake account that only you control.",
    rewardRate: "About 6.8% a year",
    networkId: NET.solana,
    positions: [
      { id: "Acct1", assetKey: "sol", symbol: "SOL", decimals: 9, amount: "1000000000", amountDisplay: "1 SOL", with: "Validator APsE…zhhr", status: "active", statusText: "Earning rewards", actions: ["unstake"], networkId: NET.solana },
    ],
  },
  { assetKey: "ada", symbol: "ADA", name: "Cardano", wholeBalance: true, howItWorks: "", positions: [], unavailable: { code: "staking/coming-soon", message: "Staking ADA is coming soon." } },
  { assetKey: "near", symbol: "NEAR", name: "NEAR", wholeBalance: false, howItWorks: "", positions: [], unavailable: { code: "staking/coming-soon", message: "Staking NEAR is coming soon." } },
];

const LP: LpPositionView[] = [
  { id: "lp1", app: "SaucerSwap", pair: "HBAR / USDC", holdings: "120 HBAR + 8.4 USDC", status: "Earning fees", inRange: true, fees: "0.6 HBAR waiting to be collected", url: "https://www.saucerswap.finance/liquidity", networkId: NET.hedera },
];

/** `amount` is what the user typed ("100"). */
function quote(sellKey: string, buyKey: string, amount: string): SwapQuoteView {
  return {
    id: `fixture-${Date.now()}`,
    provider: "0x",
    sell: { assetKey: sellKey, symbol: sellKey.toUpperCase(), amount: String(Math.round(Number(amount) * 1e6)), display: `${amount} ${sellKey.toUpperCase()}` },
    buy: { assetKey: buyKey, symbol: buyKey.toUpperCase(), amount: "3300000000000000", display: `0.0033 ${buyKey.toUpperCase()}` },
    youGet: `You get ~0.0033 ${buyKey.toUpperCase()}`,
    atLeast: `At least 0.00328 ${buyKey.toUpperCase()}, or nothing happens`,
    slippageBps: 50,
    priceImpactPct: 0.04,
    route: "Via Uniswap V3",
    steps: [`Allow 0x to use exactly ${amount} ${sellKey.toUpperCase()}`, "Swap"],
    warnings: [],
    executable: false,
    expiresAt: Date.now() + 30_000,
    networkId: NET.base,
  };
}

export function withFixtureFeatures(real: FeaturesLike): FeaturesLike {
  return {
    refine: (r, d) => real.refine(r, d),
    handle: (async (m: FeatureRequest) => {
      switch (m.type) {
        case "featStakingOverview":
          return structuredClone(STAKING);
        case "featStakingOptions":
          return [
            { id: "v2", title: "Validator APsE…zhhr", detail: "Earns about 6.8% a year · keeps 0% of rewards", apy: 6.8, recommended: true },
            { id: "v1", title: "Validator FwR3…T59f", detail: "Earns about 6.4% a year · keeps 5% of rewards", apy: 6.4 },
          ];
        case "featSwapQuote":
          return quote(m.sell, m.buy, m.amount);
        case "featLpPositions":
          return structuredClone(LP);
        default:
          return real.handle(m);
      }
    }) as FeaturesLike["handle"],
  };
}
