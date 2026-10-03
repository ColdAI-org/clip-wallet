/**
 * Real dependencies from the packages, for any host. The host constructs the vault (only hosts may import
 * @clip-wallet/vault) and passes it with the vault's hashSignablePayload.
 */
import type { ChainModule, Family, SignablePayload } from "@clip-wallet/core";
import type { ClipConfig } from "@clip-wallet/config";
import { createEvmModule } from "@clip-wallet/chains-evm";
import { createHederaModule } from "@clip-wallet/chains-hedera";
import { createSolanaModule } from "@clip-wallet/chains-solana";
import { createBitcoinModule } from "@clip-wallet/chains-bitcoin";
import { KnownDappRegistry, NoNameResolver, OneMaskConnector, ReferencePriceFeed, RoutePlannerAdapter, WalletConnectAdapter, type WalletConnectAdapterOptions } from "./adapters.js";
import { walletAssets, walletNetworks } from "./catalog.js";
import type { Dependencies, WalletVault } from "./types.js";

export { walletNetworks, walletAssets } from "./catalog.js";

export interface EngineWiringOptions {
  config: ClipConfig;
  vault: WalletVault;
  hashPayload(payload: SignablePayload): Uint8Array;
  /** Display currency lookup (route fees in fiat). */
  currency: () => Promise<string>;
  walletConnect: Pick<WalletConnectAdapterOptions, "projectId" | "url" | "iconUrl" | "coreOptions" | "walletKitFactory" | "load">;
  /** Extra verified dapp domains (host → name), e.g. a local test page in dev builds. */
  knownDapps?: Record<string, string>;
}

export function createEngineDependencies(o: EngineWiringOptions): Dependencies & { walletConnect: WalletConnectAdapter } {
  const networks = walletNetworks(o.config);
  const families = new Set<Family>(networks.map((n) => n.family));
  const hedera = createHederaModule();
  const all: Partial<Record<Family, ChainModule>> = { evm: createEvmModule(), hedera, solana: createSolanaModule(), bitcoin: createBitcoinModule() };
  const chains: Partial<Record<Family, ChainModule>> = {};
  for (const f of families) if (all[f]) chains[f] = all[f];
  const prices = new ReferencePriceFeed();
  return {
    mocks: false,
    vault: o.vault,
    hashPayload: o.hashPayload,
    chains,
    networks,
    assets: walletAssets(networks),
    route: new RoutePlannerAdapter(o.config, prices, o.currency),
    dapps: new OneMaskConnector(networks),
    walletConnect: new WalletConnectAdapter({ ...o.walletConnect, name: o.config.name, networks }),
    prices,
    names: new NoNameResolver(),
    registry: new KnownDappRegistry(o.knownDapps),
    hederaAccountId: async (ctx) => (await hedera.getAccountState(ctx)).accountId ?? undefined,
    seedActivity: [],
  };
}
