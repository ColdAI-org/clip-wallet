/**
 * The wallet's network and asset catalogue, from the chain packages, filtered by clip.config.
 * Testnets only unless clip.config opts into mainnet with the checklist (AGENTS rule 6).
 * Same rules as apps/extension/src/shared/catalog.ts, owned here so every host shares one copy.
 */
import type { AssetRef, Network } from "@clip-wallet/core";
import { enabledFamilies, includesEvmChain, isMainnetEnabled, type ClipConfig } from "@clip-wallet/config";
import { EVM_NETWORKS, CURATED_TOKENS } from "@clip-wallet/chains-evm";
import { HEDERA_MAINNET, HEDERA_TESTNET, USDC_TOKEN_IDS, ledgerOf, tokenAssetKey as htsKey } from "@clip-wallet/chains-hedera";
import { SOLANA_DEVNET, SOLANA_MAINNET, USDC_MINTS, tokenAssetKey as splKey } from "@clip-wallet/chains-solana";
import { BITCOIN_NETWORKS } from "@clip-wallet/chains-bitcoin";

type CuratedToken = (typeof CURATED_TOKENS)[number];

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
  ];
  return all.filter((n) => (families as readonly string[]).includes(n.family) && (mainnet || n.testnet));
}

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
    if (n.family === "solana") {
      const mint = USDC_MINTS[n.testnet ? "devnet" : "mainnet"];
      if (mint) out.push({ key: splKey(n.id, mint), symbol: "USDC", name: "USD Coin", decimals: 6, networkId: n.id, address: mint });
    }
  }
  return out;
}

/** Networks as the inpage providers may see them: public facts only, one RPC (never an override). */
export function publicNetworks(networks: Network[]): Network[] {
  return networks.map((n) => ({ ...n, rpcUrls: n.rpcUrls.slice(0, 1) }));
}
