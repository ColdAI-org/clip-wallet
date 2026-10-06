/**
 * @clip-wallet/features — HashPack-parity features as background services: staking, swaps, on-ramp,
 * Secure Trade, featured apps, LP positions and the price feed. Pure logic, no keys: everything ends in a
 * DappRequest on the normal approval path.
 *
 * @module
 */
export * from "./views.js";
export * from "./host.js";
export * from "./messages.js";
export { FeaturesService } from "./background.js";
export { queueSteps, refineDecoded, registerIntent, type Step, type Intent } from "./steps.js";
export * from "./staking/index.js";
export * from "./swap/index.js";
export * from "./onramp/index.js";
export * from "./trade/index.js";
export { FEATURED_DAPPS, TRADE_DISCLAIMER, featuredFor, isFeaturedOrigin, tradeAndEarnFor } from "./dapps/featured.js";
export { saucerSwapPositions, uniswapPositions, UNISWAP_V3_NPM, decodeSlot0 } from "./lp/readers.js";
export { amountsForLiquidity, sqrtRatioAtTick, MIN_TICK, MAX_TICK } from "./lp/math.js";
export { CoinGeckoPriceFeed, type CoinGeckoOptions, type SyncPriceFeed } from "./prices/coingecko.js";
export { COINGECKO_IDS } from "./prices/ids.js";
export { onlyPrograms, programIdsOf, JUPITER_V6_PROGRAM, STAKE_PROGRAM } from "./solana-verify.js";
export { formatUnits, parseUnits, longZero, fromLongZero } from "./util.js";
