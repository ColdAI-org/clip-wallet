/**
 * Real dependencies from the packages, for any host. The host constructs the vault (only hosts may import
 * @clip-wallet/vault) and passes it with the vault's hashSignablePayload.
 *
 * @module
 */
import type { ChainModule, Family, SignablePayload } from "@clip-wallet/core";
import type { ClipConfig } from "@clip-wallet/config";
import { createEvmModule } from "@clip-wallet/chains-evm";
import { MIRROR_NODE_URLS, createHederaModule } from "@clip-wallet/chains-hedera";
import { SettleFunding, settleClientFor } from "@clip-wallet/route";
import { isMainnetEnabled } from "@clip-wallet/config";
import { createSolanaModule } from "@clip-wallet/chains-solana";
import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";
import { createSuiModule } from "@clip-wallet/chains-sui";
import { createAptosModule } from "@clip-wallet/chains-aptos";
import { createCardanoModule } from "@clip-wallet/chains-cardano";
import { createSubstrateModule } from "@clip-wallet/chains-substrate";
import { createCosmosModule } from "@clip-wallet/chains-cosmos";
import { createTronModule } from "@clip-wallet/chains-tron";
import { createMultiversXModule } from "@clip-wallet/chains-multiversx";
import { createIcpModule } from "@clip-wallet/chains-icp";
import { createStacksModule } from "@clip-wallet/chains-stacks";
import { createFuelModule } from "@clip-wallet/chains-fuel";
import { createBitcoinCashModule } from "@clip-wallet/chains-bitcoincash";
import { createXrplModule } from "@clip-wallet/chains-xrpl";
import { createStarknetModule } from "@clip-wallet/chains-starknet";
import { createTonModule } from "@clip-wallet/chains-ton";
import { createNearModule } from "@clip-wallet/chains-near";
import { createStellarModule } from "@clip-wallet/chains-stellar";
import { createTezosModule } from "@clip-wallet/chains-tezos";
import { createAlgorandModule } from "@clip-wallet/chains-algorand";
import { BackupClient } from "@clip-wallet/backup-client";
import { MultiNameResolver, type Backend as NameBackend } from "@clip-wallet/names";
import { KnownDappRegistry, OneMaskConnector, ReferencePriceFeed, RoutePlannerAdapter, WalletConnectAdapter, type WalletConnectAdapterOptions } from "./adapters.js";
import { dappRequestNetworks, walletAssets, walletNetworks } from "./catalog.js";
import { createPriceFeed } from "./features.js";
import type { KV } from "./kv.js";
import type { Dependencies, WalletVault } from "./types.js";

export { dappRequestNetworks, walletNetworks, walletAssets } from "./catalog.js";

export interface EngineWiringOptions {
  config: ClipConfig;
  vault: WalletVault;
  hashPayload(payload: SignablePayload): Uint8Array;
  /** Display currency lookup (route fees in fiat). */
  currency: () => Promise<string>;
  walletConnect: Pick<WalletConnectAdapterOptions, "projectId" | "url" | "iconUrl" | "coreOptions" | "walletKitFactory" | "load">;
  /** Extra verified dapp domains (host → name), e.g. a local test page in dev builds. */
  knownDapps?: Record<string, string>;
  /** Where the CoinGecko price snapshot is cached. Without it prices are the reference table (tests). */
  kv?: KV;
  /** CoinGecko demo key (build env; never committed). */
  coingeckoDemoKey?: string;
  /** Extra name backends asked after the built-ins (mobile: Clip Plugins' PluginBackend). */
  extraNames?: NameBackend[];
}

export function createEngineDependencies(o: EngineWiringOptions): Dependencies & { walletConnect: WalletConnectAdapter } {
  const networks = walletNetworks(o.config);
  const families = new Set<Family>(networks.map((n) => n.family));
  const hedera = createHederaModule();
  // Defaults match the vault's: Starknet OpenZeppelin account, TON wallet v5r1, Algorand ARC-52.
  const starknet = createStarknetModule();
  const ton = createTonModule();
  const all: Partial<Record<Family, () => ChainModule>> = {
    evm: createEvmModule,
    hedera: () => hedera,
    solana: createSolanaModule,
    bitcoin: createBitcoinModule,
    sui: createSuiModule,
    aptos: createAptosModule,
    cardano: createCardanoModule,
    substrate: createSubstrateModule,
    starknet: () => starknet,
    ton: () => ton,
    near: createNearModule,
    stellar: createStellarModule,
    tezos: createTezosModule,
    algorand: createAlgorandModule,
    cosmos: () => createCosmosModule({ family: "cosmos" }),
    provenance: () => createCosmosModule({ family: "provenance" }),
    thorchain: () => createCosmosModule({ family: "thorchain" }),
    initia: () => createCosmosModule({ family: "initia" }),
    tron: createTronModule,
    multiversx: createMultiversXModule,
    icp: createIcpModule,
    stacks: createStacksModule,
    fuel: createFuelModule,
    bitcoincash: createBitcoinCashModule,
    xrpl: createXrplModule,
  };
  // One instance per enabled family for the engine's lifetime (modules keep prepare→finalize state).
  const chains: Partial<Record<Family, ChainModule>> = {};
  for (const f of families) {
    const make = all[f];
    if (make) chains[f] = make();
  }
  const prices = o.kv ? createPriceFeed(o.kv, o.coingeckoDemoKey) : new ReferencePriceFeed();
  const backupUrl = o.config.services.backupUrl;
  // Phase 3 "settle on Hedera": only with route.settleOnHedera and a known deployment (testnet only).
  const mainnetOn = isMainnetEnabled(o.config);
  const settle = settleClientFor({ enabled: o.config.route.settleOnHedera, mainnet: mainnetOn, mirrorNodeUrl: MIRROR_NODE_URLS[mainnetOn ? "mainnet" : "testnet"] });
  const settleFunding = settle ? new SettleFunding(settle) : null;
  // Hedera's EVM (296/295): dapps reach it over EIP-1193 and the wallet signs there, but it is never listed or scanned.
  const requestNetworks = dappRequestNetworks(networks, { mainnet: mainnetOn, settleOnHedera: !!settle });
  return {
    mocks: false,
    vault: o.vault,
    hashPayload: o.hashPayload,
    chains,
    networks,
    assets: walletAssets(networks),
    route: new RoutePlannerAdapter(o.config, prices, o.currency, settleFunding),
    settleFunding,
    ...(requestNetworks.length ? { requestNetworks } : {}),
    dapps: new OneMaskConnector([...networks, ...requestNetworks], { starknet: families.has("starknet") ? starknet : undefined, ton: families.has("ton") ? ton : undefined }),
    walletConnect: new WalletConnectAdapter({ ...o.walletConnect, name: o.config.name, networks }),
    prices,
    // ENS (.eth), SNS (.sol), Hedera names and Clip handles, limited to the networks this wallet has. Handle records
    // are checked with each family's own address rules; handles stay off until config.services.clipHandles is set.
    names: new MultiNameResolver({
      networks,
      clip: {
        isAddress: Object.fromEntries(Object.entries(chains).map(([f, m]) => [f, (a: string) => m!.isAddress(a)])),
        ...(o.config.services.clipHandles ?? {}),
      },
      ...(o.extraNames ? { extra: o.extraNames } : {}),
    }),
    backup: backupUrl ? (session) => new BackupClient({ baseUrl: backupUrl, session }) : null,
    registry: new KnownDappRegistry(o.knownDapps),
    hederaAccountId: async (ctx) => (await hedera.getAccountState(ctx)).accountId ?? undefined,
    seedActivity: [],
  };
}
