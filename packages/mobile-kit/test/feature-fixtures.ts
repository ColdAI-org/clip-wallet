/**
 * Sample feature answers for the screen tests, shaped like @clip-wallet/features' views (the real services
 * call staking/swap/on-ramp APIs and Hedera). Public, made-up data only.
 */
import type { OnRampView, StakeAssetView, StakeOptionView, SwapQuoteView, TradeOfferView, TradeReviewView } from "@clip-wallet/ui";

/** Return this from an answer to queue a real (stub) approval in the engine and answer with its id. */
export const QUEUE = Symbol("queue");

export const OFFER_LINK = "clipwallet://trade#offer=eyJ2IjoxLCJuIjoiaGVkZXJhOnRlc3RuZXQifQ";

export const STAKING: StakeAssetView[] = [
  {
    assetKey: "hbar",
    symbol: "HBAR",
    name: "Hedera",
    wholeBalance: true,
    howItWorks: "Your whole HBAR balance earns rewards where it is. Nothing is locked; you can spend it any time.",
    rewardRate: "About 2.5% a year",
    positions: [],
  },
  {
    assetKey: "sol",
    symbol: "SOL",
    name: "Solana",
    wholeBalance: false,
    howItWorks: "You pick an amount. It starts earning in about 2 days and takes about 2 days to unlock.",
    rewardRate: "About 6.8% a year",
    positions: [
      {
        id: "stake-1",
        assetKey: "sol",
        symbol: "SOL",
        decimals: 9,
        amount: "2000000000",
        amountDisplay: "2 SOL",
        with: "Validator Everstake",
        status: "active",
        statusText: "Earning rewards",
        actions: ["unstake"],
        networkId: "solana:devnet",
      },
    ],
  },
  { assetKey: "ada", symbol: "ADA", name: "Cardano", wholeBalance: true, howItWorks: "", positions: [], unavailable: { code: "staking/coming-soon", message: "Staking ADA is coming soon." } },
];

export const STAKE_OPTIONS: StakeOptionView[] = [
  { id: "v1", title: "Validator Everstake", detail: "Earns about 6.8% a year · keeps 5% of rewards", recommended: true },
  { id: "v2", title: "Validator Figment", detail: "Earns about 6.6% a year · keeps 7% of rewards" },
];

export const QUOTE: SwapQuoteView = {
  id: "q1",
  provider: "0x",
  sell: { assetKey: "eth", symbol: "ETH", amount: "100000000000000000", display: "0.1 ETH" },
  buy: { assetKey: "usdc", symbol: "USDC", amount: "250000000", display: "250 USDC" },
  youGet: "You get ~250 USDC",
  atLeast: "At least 248.75 USDC, or nothing happens",
  slippageBps: 50,
  priceImpactPct: 0.12,
  route: "Via Uniswap",
  steps: ["Swap"],
  warnings: [],
  executable: true,
  expiresAt: Date.now() + 60_000,
  networkId: "eip155:11155111",
};

export const ONRAMP: OnRampView = {
  assetKey: "sol",
  symbol: "SOL",
  explainer: "Your SOL arrives in your wallet. Clip Wallet picked the cheapest way to receive it.",
  options: [
    { provider: "banxa", name: "Banxa", methods: "Card, bank transfer", url: "https://clip.banxa-sandbox.com/?coinType=SOL" },
    { provider: "moonpay", name: "MoonPay", unavailable: { code: "onramp/not-configured", message: "Buying with MoonPay isn't switched on in this build." } },
  ],
};

export const TRADE: TradeOfferView = {
  id: "offer-1",
  role: "maker",
  mode: "scheduled",
  title: "Trade 10 HBAR for 5 SAUCE with 0.0.1001",
  give: { kind: "asset", assetKey: "hbar", symbol: "HBAR", amount: "1000000000", display: "10 HBAR" },
  get: { kind: "asset", assetKey: "sauce", symbol: "SAUCE", amount: "5000000", display: "5 SAUCE" },
  counterparty: "0.0.1001",
  status: "waiting",
  statusText: "Waiting for 0.0.1001 to accept",
  link: OFFER_LINK,
  expiresAt: Date.now() + 86_400_000,
  createdAt: Date.now() - 60_000,
  notes: [],
};

export const REVIEW: TradeReviewView = {
  offer: { ...TRADE, role: "taker", title: "Trade 5 SAUCE for 10 HBAR with 0.0.2002", counterparty: "0.0.2002" },
  title: "Accept trade",
  lines: [{ label: "Expires", value: "in 1 day" }],
  balanceChanges: [],
  warnings: [],
  steps: ["Add SAUCE to your account", "Accept the trade"],
};

export const FEATURE_ANSWERS: Record<string, (m: Record<string, unknown>) => unknown> = {
  featFeatured: () => [{ name: "SaucerSwap", url: "https://www.saucerswap.finance/", domain: "saucerswap.finance", category: "swap", description: "Swap tokens and earn from liquidity.", family: "hedera" }],
  featLpPositions: () => [],
  featStakingOverview: () => STAKING,
  featStakingOptions: () => STAKE_OPTIONS,
  featStake: () => QUEUE,
  featStakeAction: () => QUEUE,
  featSwapStatus: () => [],
  featSwapQuote: () => QUOTE,
  featSwapExecute: () => QUEUE,
  featBuyAssets: () => [{ assetKey: "sol", symbol: "SOL", name: "Solana" }],
  featBuyOptions: () => ONRAMP,
  featTradeList: () => [TRADE],
  featTradeCreate: () => QUEUE,
  featTradeReview: () => REVIEW,
  featTradeAccept: () => QUEUE,
};
