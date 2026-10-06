/**
 * @clip-wallet/connect: Clip Connect, the dapp side. Wallet-agnostic: finds Clip Wallet first and any other wallet
 * after it, through public standards only. Adapters: @clip-wallet/connect/react, /wagmi, /solana.
 *
 * @module
 */
export { connect, type ClipConnection, type ConnectOptions, type ConnectEvent, type PayRequest, type PayResult, type AssetBalance, type ChainCapabilities, type WalletInfo, type WalletConnectOptions, type Family } from "./connect.js";
export { discover, discovered, startDiscovery, rankEip6963, rankStandard, CLIP_WALLET, type Eip1193Provider, type Eip6963ProviderDetail, type Eip6963ProviderInfo, type StandardWallet, type Preference } from "./discovery.js";
export { BUILTIN_ASSETS, NATIVE, assetRegistry, formatAmount, parseAmount, erc20Transfer, type AssetSpec } from "./assets.js";
export { caip10, evmCaip2, evmChainId, parseCaip10, toCaip2, toWalletStandardChain, type Caip2, type Caip10 } from "./caip.js";
