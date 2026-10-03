/**
 * EVM network registry.
 *
 * Membership: every network among the 87 CLPR networks (coldai-clpr-landing `clpr-data.ts` NETWORKS) that
 * runs an EVM a user wallet can sign for with an eip155 address, plus the Sepolia testnets.
 * Several CLPR networks are multi-VM: their EVM layer is listed here (Cronos, Kava, Sei, Mezo, Stable,
 * MANTRA, Injective, Telos, Hydration, Bittensor, Bifrost). Hedera is its own module.
 * Not included: STRATO (SolidVM, not the EVM), Vaulta EVM (17777; its public RPC, explorer and bridge were shut
 * down on 2025-10-08 and api.evm.eosnetwork.com no longer resolves), TRON (own address format), Starknet, Fuel, Mixin and the
 * non-EVM ledgers.
 *
 * Chain ids: cross-checked against viem's chain definitions (viem 2.57) and chainlist (chainid.network),
 * and for the four chains neither has under these ids (Anubis 6714, BOT Chain 677, GRX 1110, Hydration 222222) against the CLPR verifier docs (docs/chains/*.md, live `eth_chainId`) and a live `eth_chainId`
 * on the RPC listed here (2026-10-03). RPC URLs are public endpoints without API keys.
 *
 * `blockscout` is the Blockscout instance root (its `/api/v2/stats` answered on 2026-10-03); it becomes
 * `Network.indexerUrl` as `${blockscout}/api/v2`.
 */
import type { AssetRef, Network } from "@clip-wallet/core";

export interface EvmNetworkSpec {
  slug: string;
  name: string;
  chainId: number;
  native: { symbol: string; name: string; decimals: number; key: string };
  rpcUrls: string[];
  explorerUrl: string;
  blockscout?: string;
  testnet: boolean;
  /** No EIP-1559 on this network: build legacy (EIP-155) transactions. Also auto-detected from the block's baseFee. */
  legacyGas?: boolean;
  /** Which CLPR network this EVM belongs to when it is one VM of a multi-VM chain. */
  evmLayerOf?: string;
}

const ETH = { symbol: "ETH", name: "Ether", decimals: 18, key: "eth" };
const TEST_ETH = { symbol: "ETH", name: "Sepolia Ether", decimals: 18, key: "eth-testnet" };
const coin = (symbol: string, name: string, key = symbol.toLowerCase()) => ({ symbol, name, decimals: 18, key });

export const EVM_NETWORK_SPECS: EvmNetworkSpec[] = [
  { slug: "abstract", name: "Abstract", chainId: 2741, native: ETH, rpcUrls: ["https://api.mainnet.abs.xyz"], explorerUrl: "https://abscan.org", testnet: false },
  { slug: "anubis", name: "Anubis", chainId: 6714, native: coin("gasDAI", "Gas DAI", "gasdai"), rpcUrls: ["https://rpc.anubispace.org"], explorerUrl: "https://anubisscan.io", testnet: false },
  { slug: "arbitrum-nova", name: "Arbitrum Nova", chainId: 42170, native: ETH, rpcUrls: ["https://nova.arbitrum.io/rpc"], explorerUrl: "https://nova.arbiscan.io", blockscout: "https://arbitrum-nova.blockscout.com", testnet: false },
  { slug: "arbitrum-one", name: "Arbitrum One", chainId: 42161, native: ETH, rpcUrls: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"], explorerUrl: "https://arbiscan.io", blockscout: "https://arbitrum.blockscout.com", testnet: false },
  // CLPR's Arc docs pin the testnet id; Arc mainnet is not live in the sources. Native gas is USDC (18 decimals on the EVM side).
  { slug: "arc-testnet", name: "Arc Testnet", chainId: 5042002, native: { symbol: "USDC", name: "USD Coin", decimals: 18, key: "usdc" }, rpcUrls: ["https://rpc.testnet.arc.network"], explorerUrl: "https://testnet.arcscan.app", testnet: true },
  { slug: "aurora", name: "Aurora", chainId: 1313161554, native: ETH, rpcUrls: ["https://mainnet.aurora.dev"], explorerUrl: "https://explorer.mainnet.aurora.dev", blockscout: "https://explorer.mainnet.aurora.dev", testnet: false },
  { slug: "avalanche-c-chain", name: "Avalanche C-Chain", chainId: 43114, native: coin("AVAX", "Avalanche"), rpcUrls: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"], explorerUrl: "https://snowtrace.io", testnet: false },
  { slug: "bnb-smart-chain", name: "BNB Smart Chain", chainId: 56, native: coin("BNB", "BNB"), rpcUrls: ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"], explorerUrl: "https://bscscan.com", testnet: false },
  { slug: "bob", name: "BOB", chainId: 60808, native: ETH, rpcUrls: ["https://rpc.gobob.xyz"], explorerUrl: "https://explorer.gobob.xyz", testnet: false },
  { slug: "bot-chain", name: "BOT Chain", chainId: 677, native: coin("BOT", "BOT"), rpcUrls: ["https://rpc.botchain.ai"], explorerUrl: "https://scan.botchain.ai", testnet: false },
  { slug: "base", name: "Base", chainId: 8453, native: ETH, rpcUrls: ["https://mainnet.base.org", "https://base-rpc.publicnode.com"], explorerUrl: "https://basescan.org", blockscout: "https://base.blockscout.com", testnet: false },
  { slug: "bifrost-network", name: "Bifrost Network", chainId: 3068, native: coin("BFC", "Bifrost"), rpcUrls: ["https://public-01.mainnet.bifrostnetwork.com/rpc"], explorerUrl: "https://explorer.mainnet.bifrostnetwork.com", testnet: false, evmLayerOf: "bifrost-network" },
  { slug: "bittensor", name: "Bittensor EVM", chainId: 964, native: coin("TAO", "Bittensor"), rpcUrls: ["https://lite.chain.opentensor.ai"], explorerUrl: "https://evm.taostats.io", testnet: false, evmLayerOf: "bittensor" },
  { slug: "blast", name: "Blast", chainId: 81457, native: ETH, rpcUrls: ["https://rpc.blast.io"], explorerUrl: "https://blastscan.io", testnet: false },
  { slug: "celo", name: "Celo", chainId: 42220, native: coin("CELO", "Celo"), rpcUrls: ["https://forno.celo.org"], explorerUrl: "https://celoscan.io", blockscout: "https://celo.blockscout.com", testnet: false },
  { slug: "conflux", name: "Conflux eSpace", chainId: 1030, native: coin("CFX", "Conflux"), rpcUrls: ["https://evm.confluxrpc.com"], explorerUrl: "https://evm.confluxscan.org", testnet: false, evmLayerOf: "conflux" },
  { slug: "core", name: "Core", chainId: 1116, native: coin("CORE", "Core"), rpcUrls: ["https://rpc.coredao.org", "https://core.drpc.org"], explorerUrl: "https://scan.coredao.org", testnet: false },
  { slug: "cronos", name: "Cronos EVM", chainId: 25, native: coin("CRO", "Cronos"), rpcUrls: ["https://evm.cronos.org", "https://cronos-evm-rpc.publicnode.com"], explorerUrl: "https://explorer.cronos.org", testnet: false, evmLayerOf: "cronos" },
  { slug: "ethereum", name: "Ethereum", chainId: 1, native: ETH, rpcUrls: ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"], explorerUrl: "https://etherscan.io", blockscout: "https://eth.blockscout.com", testnet: false },
  { slug: "flare", name: "Flare", chainId: 14, native: coin("FLR", "Flare"), rpcUrls: ["https://flare-api.flare.network/ext/C/rpc"], explorerUrl: "https://flare-explorer.flare.network", blockscout: "https://flare-explorer.flare.network", testnet: false },
  { slug: "fraxtal", name: "Fraxtal", chainId: 252, native: coin("FRAX", "Frax"), rpcUrls: ["https://rpc.frax.com"], explorerUrl: "https://fraxscan.com", testnet: false },
  { slug: "grx-chain", name: "GRX Chain", chainId: 1110, native: coin("GRX", "GRX"), rpcUrls: ["https://rpc.grxchain.io"], explorerUrl: "https://grxscan.io", testnet: false },
  { slug: "gnosis-chain", name: "Gnosis Chain", chainId: 100, native: coin("XDAI", "xDAI"), rpcUrls: ["https://rpc.gnosischain.com", "https://gnosis-rpc.publicnode.com"], explorerUrl: "https://gnosisscan.io", blockscout: "https://gnosis.blockscout.com", testnet: false },
  { slug: "hydration", name: "Hydration EVM", chainId: 222222, native: coin("WETH", "Wrapped Ether", "hydration-weth"), rpcUrls: ["https://rpc.hydradx.cloud"], explorerUrl: "https://explorer.evm.hydration.cloud", testnet: false, evmLayerOf: "hydration" },
  { slug: "hyperliquid", name: "HyperEVM", chainId: 999, native: coin("HYPE", "Hyperliquid"), rpcUrls: ["https://rpc.hyperliquid.xyz/evm"], explorerUrl: "https://hyperevmscan.io", testnet: false, evmLayerOf: "hyperliquid" },
  { slug: "immutable-zkevm", name: "Immutable zkEVM", chainId: 13371, native: coin("IMX", "Immutable"), rpcUrls: ["https://rpc.immutable.com"], explorerUrl: "https://explorer.immutable.com", blockscout: "https://explorer.immutable.com", testnet: false },
  { slug: "injective", name: "Injective EVM", chainId: 1776, native: coin("INJ", "Injective"), rpcUrls: ["https://sentry.evm-rpc.injective.network"], explorerUrl: "https://blockscout.injective.network", blockscout: "https://blockscout.injective.network", testnet: false, evmLayerOf: "injective" },
  { slug: "ink", name: "Ink", chainId: 57073, native: ETH, rpcUrls: ["https://rpc-gel.inkonchain.com"], explorerUrl: "https://explorer.inkonchain.com", blockscout: "https://explorer.inkonchain.com", testnet: false },
  { slug: "kub-chain", name: "KUB Chain", chainId: 96, native: coin("KUB", "KUB Coin"), rpcUrls: ["https://rpc.bitkubchain.io"], explorerUrl: "https://kubscan.com", testnet: false },
  { slug: "kaia", name: "Kaia", chainId: 8217, native: coin("KAIA", "Kaia"), rpcUrls: ["https://public-en.node.kaia.io"], explorerUrl: "https://kaiascan.io", testnet: false },
  { slug: "katana", name: "Katana", chainId: 747474, native: ETH, rpcUrls: ["https://rpc.katana.network"], explorerUrl: "https://katanascan.com", testnet: false },
  { slug: "kava", name: "Kava EVM", chainId: 2222, native: coin("KAVA", "Kava"), rpcUrls: ["https://evm.kava.io"], explorerUrl: "https://kavascan.com", testnet: false, evmLayerOf: "kava" },
  { slug: "mantra", name: "MANTRA EVM", chainId: 5888, native: coin("MANTRA", "MANTRA"), rpcUrls: ["https://evm.mantrachain.io"], explorerUrl: "https://blockscout.mantrascan.io", blockscout: "https://blockscout.mantrascan.io", testnet: false, evmLayerOf: "mantra" },
  { slug: "mantle", name: "Mantle", chainId: 5000, native: coin("MNT", "Mantle"), rpcUrls: ["https://rpc.mantle.xyz"], explorerUrl: "https://mantlescan.xyz", testnet: false },
  { slug: "megaeth", name: "MegaETH", chainId: 4326, native: ETH, rpcUrls: ["https://mainnet.megaeth.com/rpc"], explorerUrl: "https://megaeth.blockscout.com", blockscout: "https://megaeth.blockscout.com", testnet: false },
  { slug: "mezo", name: "Mezo", chainId: 31612, native: { symbol: "BTC", name: "Bitcoin on Mezo", decimals: 18, key: "mezo-btc" }, rpcUrls: ["https://mezo-mainnet.boar.network"], explorerUrl: "https://explorer.mezo.org", testnet: false, evmLayerOf: "mezo" },
  { slug: "monad", name: "Monad", chainId: 143, native: coin("MON", "Monad"), rpcUrls: ["https://rpc.monad.xyz"], explorerUrl: "https://monadscan.com", testnet: false },
  { slug: "op-mainnet", name: "OP Mainnet", chainId: 10, native: ETH, rpcUrls: ["https://mainnet.optimism.io", "https://optimism-rpc.publicnode.com"], explorerUrl: "https://optimistic.etherscan.io", blockscout: "https://optimism.blockscout.com", testnet: false },
  { slug: "plasma", name: "Plasma", chainId: 9745, native: coin("XPL", "Plasma"), rpcUrls: ["https://rpc.plasma.to"], explorerUrl: "https://plasmascan.to", testnet: false },
  { slug: "plume", name: "Plume", chainId: 98866, native: coin("PLUME", "Plume"), rpcUrls: ["https://rpc.plume.org"], explorerUrl: "https://explorer.plume.org", blockscout: "https://explorer.plume.org", testnet: false },
  { slug: "polygon-pos", name: "Polygon PoS", chainId: 137, native: coin("POL", "Polygon"), rpcUrls: ["https://polygon-bor-rpc.publicnode.com", "https://polygon.drpc.org"], explorerUrl: "https://polygonscan.com", blockscout: "https://polygon.blockscout.com", testnet: false },
  { slug: "pulsechain", name: "PulseChain", chainId: 369, native: coin("PLS", "Pulse"), rpcUrls: ["https://rpc.pulsechain.com"], explorerUrl: "https://scan.pulsechain.com", testnet: false },
  { slug: "rise", name: "RISE", chainId: 4153, native: ETH, rpcUrls: ["https://rpc.risechain.com"], explorerUrl: "https://explorer.risechain.com", blockscout: "https://explorer.risechain.com", testnet: false },
  { slug: "reya", name: "Reya", chainId: 1729, native: ETH, rpcUrls: ["https://rpc.reya.network"], explorerUrl: "https://explorer.reya.network", blockscout: "https://explorer.reya.network", testnet: false },
  { slug: "robinhood-chain", name: "Robinhood Chain", chainId: 4663, native: ETH, rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], explorerUrl: "https://robinhoodchain.blockscout.com", testnet: false },
  { slug: "ronin", name: "Ronin", chainId: 2020, native: coin("RON", "Ronin"), rpcUrls: ["https://api.roninchain.com/rpc"], explorerUrl: "https://app.roninchain.com", testnet: false },
  { slug: "rootstock", name: "Rootstock", chainId: 30, native: { symbol: "RBTC", name: "Smart Bitcoin", decimals: 18, key: "rbtc" }, rpcUrls: ["https://public-node.rsk.co"], explorerUrl: "https://explorer.rsk.co", blockscout: "https://rootstock.blockscout.com", testnet: false, legacyGas: true },
  { slug: "sei", name: "Sei EVM", chainId: 1329, native: coin("SEI", "Sei"), rpcUrls: ["https://evm-rpc.sei-apis.com"], explorerUrl: "https://seiscan.io", testnet: false, evmLayerOf: "sei" },
  { slug: "soneium", name: "Soneium", chainId: 1868, native: ETH, rpcUrls: ["https://rpc.soneium.org"], explorerUrl: "https://soneium.blockscout.com", blockscout: "https://soneium.blockscout.com", testnet: false },
  { slug: "stable", name: "Stable", chainId: 988, native: { symbol: "USDT0", name: "USDT0", decimals: 18, key: "usdt0" }, rpcUrls: ["https://rpc.stable.xyz"], explorerUrl: "https://stablescan.xyz", testnet: false, evmLayerOf: "stable" },
  { slug: "telos", name: "Telos EVM", chainId: 40, native: coin("TLOS", "Telos"), rpcUrls: ["https://rpc.telos.net"], explorerUrl: "https://teloscan.io", testnet: false, evmLayerOf: "telos" },
  { slug: "unichain", name: "Unichain", chainId: 130, native: ETH, rpcUrls: ["https://mainnet.unichain.org"], explorerUrl: "https://uniscan.xyz", blockscout: "https://unichain.blockscout.com", testnet: false },
  { slug: "world-chain", name: "World Chain", chainId: 480, native: ETH, rpcUrls: ["https://worldchain-mainnet.g.alchemy.com/public"], explorerUrl: "https://worldscan.org", blockscout: "https://worldchain-mainnet.explorer.alchemy.com", testnet: false },
  { slug: "x-layer", name: "X Layer", chainId: 196, native: coin("OKB", "OKB"), rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"], explorerUrl: "https://www.oklink.com/xlayer", testnet: false },
  { slug: "zksync-era", name: "ZKsync Era", chainId: 324, native: ETH, rpcUrls: ["https://mainnet.era.zksync.io"], explorerUrl: "https://explorer.zksync.io", blockscout: "https://zksync.blockscout.com", testnet: false },
  { slug: "linea", name: "Linea", chainId: 59144, native: ETH, rpcUrls: ["https://rpc.linea.build"], explorerUrl: "https://lineascan.build", testnet: false },
  { slug: "scroll", name: "Scroll", chainId: 534352, native: ETH, rpcUrls: ["https://rpc.scroll.io", "https://scroll-rpc.publicnode.com"], explorerUrl: "https://scrollscan.com", blockscout: "https://scroll.blockscout.com", testnet: false },
  { slug: "morph", name: "Morph", chainId: 2818, native: ETH, rpcUrls: ["https://rpc.morphl2.io"], explorerUrl: "https://explorer.morphl2.io", testnet: false },
  { slug: "etherlink", name: "Etherlink", chainId: 42793, native: coin("XTZ", "Tez"), rpcUrls: ["https://node.mainnet.etherlink.com"], explorerUrl: "https://explorer.etherlink.com", blockscout: "https://explorer.etherlink.com", testnet: false, evmLayerOf: "etherlink" },

  /* ---------------------------------------------------------- testnets (default build) */
  { slug: "sepolia", name: "Sepolia", chainId: 11155111, native: TEST_ETH, rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com", "https://11155111.rpc.thirdweb.com"], explorerUrl: "https://sepolia.etherscan.io", blockscout: "https://eth-sepolia.blockscout.com", testnet: true },
  { slug: "base-sepolia", name: "Base Sepolia", chainId: 84532, native: TEST_ETH, rpcUrls: ["https://sepolia.base.org"], explorerUrl: "https://sepolia.basescan.org", blockscout: "https://base-sepolia.blockscout.com", testnet: true },
  { slug: "arbitrum-sepolia", name: "Arbitrum Sepolia", chainId: 421614, native: TEST_ETH, rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"], explorerUrl: "https://sepolia.arbiscan.io", blockscout: "https://arbitrum-sepolia.blockscout.com", testnet: true },
  { slug: "op-sepolia", name: "OP Sepolia", chainId: 11155420, native: TEST_ETH, rpcUrls: ["https://sepolia.optimism.io"], explorerUrl: "https://sepolia-optimism.etherscan.io", blockscout: "https://optimism-sepolia.blockscout.com", testnet: true },
];

export const caip2 = (chainId: number): string => `eip155:${chainId}`;

export function nativeAssetFor(spec: EvmNetworkSpec): AssetRef {
  return { key: spec.native.key, symbol: spec.native.symbol, name: spec.native.name, decimals: spec.native.decimals, networkId: caip2(spec.chainId) };
}

export function toNetwork(spec: EvmNetworkSpec): Network {
  const n: Network = {
    id: caip2(spec.chainId),
    family: "evm",
    name: spec.name,
    nativeAsset: nativeAssetFor(spec),
    testnet: spec.testnet,
    rpcUrls: spec.rpcUrls,
    explorerUrl: spec.explorerUrl,
    chainId: spec.chainId,
  };
  if (spec.blockscout) n.indexerUrl = `${spec.blockscout}/api/v2`;
  return n;
}

export const EVM_NETWORKS: Network[] = EVM_NETWORK_SPECS.map(toNetwork);
export const EVM_TESTNETS: Network[] = EVM_NETWORKS.filter((n) => n.testnet);

const SPEC_BY_ID = new Map(EVM_NETWORK_SPECS.map((s) => [caip2(s.chainId), s]));
export const specFor = (networkId: string): EvmNetworkSpec | undefined => SPEC_BY_ID.get(networkId);
export const networkById = (networkId: string): Network | undefined => EVM_NETWORKS.find((n) => n.id === networkId);
