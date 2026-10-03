/**
 * AssetRef.key → CoinGecko coin id. Ids checked against https://api.coingecko.com/api/v3/coins/list
 * (2026-10-03). Only the SAME issuer's asset shares a key (see core AssetRef), so one id per key is right.
 *
 * Testnet keys ("usdc-testnet", "btc-testnet") map to the mainnet coin so testnet balances read as money,
 * as the Phase 1 reference table did. They have no market value; `PriceFeed.testnetValues` turns it off.
 */
export const COINGECKO_IDS: Record<string, string> = {
  // Phase 1 families
  eth: "ethereum",
  hbar: "hedera-hashgraph",
  sol: "solana",
  btc: "bitcoin",
  usdc: "usd-coin",
  usdt: "tether",
  dai: "dai",
  weth: "weth",
  wbtc: "wrapped-bitcoin",
  "hts:0.0.731861": "saucerswap", // SAUCE (mainnet token id)
  sauce: "saucerswap",
  // EVM network coins
  pol: "polygon-ecosystem-token",
  matic: "polygon-ecosystem-token",
  arb: "arbitrum",
  op: "optimism",
  avax: "avalanche-2",
  bnb: "binancecoin",
  // Phase 2 families (native coins)
  dot: "polkadot",
  ada: "cardano",
  near: "near",
  xtz: "tezos",
  sui: "sui",
  apt: "aptos",
  strk: "starknet",
  ton: "the-open-network",
  // chains-ton keys the native coin "gram" (Toncoin was renamed Gram on 2026-06-15; same coin, same CoinGecko id).
  gram: "the-open-network",
  xlm: "stellar",
  algo: "algorand",
};

/** Keys that only exist on test networks and borrow the mainnet coin's price for display. */
export const TESTNET_ALIASES: Record<string, string> = {
  "usdc-testnet": "usdc",
  "btc-testnet": "btc",
  // chains-evm (and chains-starknet on Sepolia) key testnet ETH "eth-testnet".
  "eth-testnet": "eth",
  // Westend (WND) and Paseo (PAS) are the Polkadot test networks' coins.
  wnd: "dot",
  pas: "dot",
};

/** Bridged stablecoins priced as the dollar they track (display only). */
export const PEGGED_USD = new Set(["usdc.e", "usdbc"]);
