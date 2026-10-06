/**
 * The wallet's network and asset catalogue for all 14 families, from the chain packages, filtered by
 * clip.config. One copy for every host (the extension re-exports it).
 * Testnets only unless clip.config opts into mainnet with the checklist (AGENTS rule 6).
 *
 * @module
 */
import type { AssetRef, Network } from "@clip-wallet/core";
import { enabledFamilies, includesEvmChain, isMainnetEnabled, type ClipConfig } from "@clip-wallet/config";
import { EVM_NETWORKS, CURATED_TOKENS, HEDERA_EVM_NETWORKS } from "@clip-wallet/chains-evm";

type CuratedToken = (typeof CURATED_TOKENS)[number];
import { HEDERA_MAINNET, HEDERA_TESTNET, USDC_TOKEN_IDS, ledgerOf, tokenAssetKey as htsKey } from "@clip-wallet/chains-hedera";
import { SOLANA_DEVNET, SOLANA_MAINNET, USDC_MINTS, tokenAssetKey as splKey } from "@clip-wallet/chains-solana";
import { BITCOIN_NETWORKS } from "@clip-wallet/chains-bitcoin";
import { CARDANO_NETWORKS } from "@clip-wallet/chains-cardano/networks";
import { SUBSTRATE_NETWORKS, SUBSTRATE_SPECS, caip2Of } from "@clip-wallet/chains-substrate/networks";
import { STARKNET_MAINNET, STARKNET_SEPOLIA, CURATED_TOKENS as STARKNET_TOKENS, STARKNET_CHAINS } from "@clip-wallet/chains-starknet/networks";
import { TON_MAINNET, TON_TESTNET } from "@clip-wallet/chains-ton/networks";
import { SUI_MAINNET, SUI_TESTNET, USDC_COIN_TYPES, coinAssetKey as suiKey } from "@clip-wallet/chains-sui/networks";
import { APTOS_MAINNET, APTOS_TESTNET, USDC_METADATA, assetKey as aptosKey } from "@clip-wallet/chains-aptos/networks";
import { NEAR_NETWORKS, USDC_CONTRACTS, tokenAssetKey as nep141Key } from "@clip-wallet/chains-near/networks";
import { STELLAR_NETWORKS, USDC_ISSUERS, classicAsset } from "@clip-wallet/chains-stellar/networks";
import { TEZOS_NETWORKS, KNOWN_TOKENS as TEZOS_TOKENS } from "@clip-wallet/chains-tezos/networks";
import { ALGORAND_NETWORKS, ALGORAND_NETS, asaAssetKey } from "@clip-wallet/chains-algorand/networks";
// networks87
import { COSMOS_NETWORKS, assetOf as cosmosAssetOf, specOf as cosmosSpecOf } from "@clip-wallet/chains-cosmos/networks";
import { TRON_NETWORKS, usdtAsset as tronUsdt } from "@clip-wallet/chains-tron/networks";
import { MULTIVERSX_NETWORKS } from "@clip-wallet/chains-multiversx/networks";
import { ICP_IDS, ICP_NETWORKS, LEDGERS as ICP_LEDGERS, ledgerAsset as icpLedgerAsset } from "@clip-wallet/chains-icp/networks";
import { STACKS_NETWORKS, specFor as stacksSpecFor, tokenAsset as stacksTokenAsset } from "@clip-wallet/chains-stacks/networks";
import { FUEL_NETWORKS, assetFor as fuelAssetFor, specFor as fuelSpecFor } from "@clip-wallet/chains-fuel/networks";

/** Same mapping as chains-evm's (unexported) curatedAsset(). */
function curatedAsset(t: CuratedToken): AssetRef {
  const a: AssetRef = { key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId: `eip155:${t.chainId}`, address: t.address };
  if (t.bridged) a.bridged = true;
  return a;
}

export function walletNetworks(config: Pick<ClipConfig, "networks" | "mainnet">): Network[] {
  const mainnet = isMainnetEnabled(config);
  const families = enabledFamilies(config);
  const all: Network[] = [
    ...EVM_NETWORKS.filter((n) => n.chainId !== undefined && includesEvmChain(config, n.chainId)),
    HEDERA_TESTNET,
    HEDERA_MAINNET,
    SOLANA_DEVNET,
    SOLANA_MAINNET,
    ...BITCOIN_NETWORKS.filter((n) => n.name !== "Bitcoin Signet"),
    ...CARDANO_NETWORKS,
    ...SUBSTRATE_NETWORKS,
    STARKNET_SEPOLIA,
    STARKNET_MAINNET,
    TON_TESTNET,
    TON_MAINNET,
    SUI_TESTNET,
    SUI_MAINNET,
    APTOS_TESTNET,
    APTOS_MAINNET,
    ...NEAR_NETWORKS,
    ...STELLAR_NETWORKS,
    ...TEZOS_NETWORKS,
    ...ALGORAND_NETWORKS,
    ...COSMOS_NETWORKS,
    ...TRON_NETWORKS,
    ...MULTIVERSX_NETWORKS,
    ...ICP_NETWORKS,
    ...STACKS_NETWORKS,
    ...FUEL_NETWORKS,
  ];
  return all.filter((n) => (families as readonly string[]).includes(n.family) && (mainnet || n.testnet));
}

/**
 * Networks dapps may use and the wallet signs on, but never lists or scans: Hedera's EVM (eip155:296 testnet, 295
 * mainnet), whenever the wallet has Hedera. Hedera EVM dapps (wagmi's hederaTestnet, Scaffold-HBAR, MetaMask-style
 * Hedera dapps) connect over EIP-1193 and ask for chain 296; without it in 1Mask's registry they got "Clip Wallet only
 * connects to the networks it ships with". It stays out of walletNetworks() so HBAR isn't counted twice (see
 * HEDERA_EVM_SPECS). Settle on Hedera also signs here (its claim / withdraw), so it is included when `settleOnHedera`.
 */
export function dappRequestNetworks(networks: Network[], opts: { mainnet: boolean; settleOnHedera?: boolean }): Network[] {
  if (!opts.settleOnHedera && !networks.some((n) => n.family === "hedera")) return [];
  return HEDERA_EVM_NETWORKS.filter((n) => opts.mainnet || n.testnet);
}

/**
 * Keys come from each chain package's own helpers so they match what getBalances returns.
 * NOTE (cross-package): chains-evm keys testnet USDC "usdc-testnet" while chains-hedera/-solana key
 * theirs "usdc", so testnet USDC does not merge across families until the packages agree.
 */
/** Assets each network can carry, even at zero balance: native coins plus curated tokens. */
export function walletAssets(networks: Network[]): AssetRef[] {
  const out: AssetRef[] = networks.map((n) => n.nativeAsset);
  const ids = new Set(networks.map((n) => n.id));
  for (const t of CURATED_TOKENS) {
    const a = curatedAsset(t);
    if (ids.has(a.networkId)) out.push(a);
  }
  for (const n of networks) {
    if (n.family === "hedera") {
      const id = USDC_TOKEN_IDS[ledgerOf(n.id)];
      if (id) out.push({ key: htsKey(n.id, id), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: id });
    }
    if (n.family === "substrate") {
      const spec = SUBSTRATE_SPECS.find((sp) => caip2Of(sp.genesisHash) === n.id);
      for (const a of spec?.assets ?? []) out.push({ key: a.key, symbol: a.symbol, name: a.name, decimals: a.decimals, networkId: n.id, address: String(a.id) });
    }
    if (n.family === "starknet") {
      for (const t of STARKNET_TOKENS) {
        if (STARKNET_CHAINS[t.chain].caip2 !== n.id || t.key === "strk") continue;
        out.push({ key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId: n.id, address: t.address, ...(t.bridged ? { bridged: true } : {}) });
      }
    }
    // TON has no curated testnet jettons; on mainnet USD₮ shows up from balances.
    if (n.family === "solana") {
      const mint = USDC_MINTS[n.testnet ? "devnet" : "mainnet"];
      if (mint) out.push({ key: splKey(n.id, mint), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: mint });
    }
    if (n.family === "sui") {
      const type = USDC_COIN_TYPES[n.testnet ? "testnet" : "mainnet"];
      if (type) out.push({ key: suiKey(n.id, type), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: type });
    }
    if (n.family === "aptos") {
      const fa = USDC_METADATA[n.testnet ? "testnet" : "mainnet"];
      if (fa) out.push({ key: aptosKey(n.id, fa), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: fa });
    }
    if (n.family === "near") {
      const contract = USDC_CONTRACTS[n.testnet ? "testnet" : "mainnet"];
      out.push({ key: nep141Key(n.id, contract), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: contract });
    }
    if (n.family === "stellar") out.push(classicAsset(n.id, "USDC", USDC_ISSUERS[n.testnet ? "testnet" : "pubnet"]));
    if (n.family === "algorand") {
      const id = ALGORAND_NETS[n.testnet ? "testnet" : "mainnet"].usdc;
      out.push({ key: asaAssetKey(n.id, id), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: id });
    }
    // networks87: the curated tokens each module lists even at zero.
    const cs = cosmosSpecOf(n.id);
    if (cs) for (const t of cs.tokens ?? []) if (t.alwaysShow || t.key === "usdc") out.push(cosmosAssetOf(cs, t.denom));
    if (n.family === "tron") {
      const u = tronUsdt(n.id);
      if (u) out.push(u);
    }
    if (n.family === "icp") {
      const net = n.id === ICP_IDS.mainnet ? "mainnet" : "test";
      for (const l of ICP_LEDGERS[net].slice(1)) out.push(icpLedgerAsset(n.id, l, false));
    }
    if (n.family === "stacks") for (const t of stacksSpecFor(n.id)?.tokens ?? []) out.push(stacksTokenAsset(n.id, t.assetId, t));
    if (n.family === "fuel") for (const t of fuelSpecFor(n.id)?.tokens ?? []) out.push(fuelAssetFor(n.id, t.assetId));
    if (n.family === "tezos") {
      for (const t of TEZOS_TOKENS.filter((t) => t.networkId === n.id && t.key === "usdt")) {
        out.push({ key: t.key, symbol: t.symbol, name: t.name, decimals: t.decimals, networkId: n.id, address: `${t.contract}:${t.tokenId}` });
      }
    }
  }
  return out;
}
