/**
 * Feature services (staking, swaps, buy, Secure Trade, explore, prices) for the background. New file from the
 * Phase 2 "features" stream; wired in by docs/phase2/integration/features.md. Holds no keys: every action ends
 * in `enqueue`, the WalletService's normal approval path.
 */
import type { AssetRef, ChainContext, DappRequest, DecodedRequest, Network, TokenBalance } from "@clip-wallet/core";
import { CoinGeckoPriceFeed, FeaturesService, type FeatureHost, type FeaturesConfig } from "@clip-wallet/features";
import { createRouteClient } from "@clip-wallet/route";
import type { KV } from "../shared/storage";

/** What the WalletService exposes to the features (see the integration doc for the public methods). */
export interface FeatureHostDeps {
  networks: Network[];
  assets: AssetRef[];
  kv: KV;
  ctx(networkId: string): Promise<ChainContext>;
  balances(): Promise<TokenBalance[]>;
  /** WalletService.enqueueWalletRequest: decode → approval queue; resolves with finalize()'s result. */
  enqueue(request: DappRequest, appName: string): Promise<{ id: string; promise: Promise<unknown> }>;
  decode(request: DappRequest): Promise<DecodedRequest>;
  usd(assetKey: string): number | undefined;
}

export function createFeatureHost(d: FeatureHostDeps): FeatureHost {
  return {
    networks: () => d.networks,
    assets: () => d.assets,
    ctx: (id) => d.ctx(id),
    balances: () => d.balances(),
    async enqueue(request, meta) {
      // Wallet-built: the approval shows the wallet as the app, never "unrecognised site".
      request.origin = "wallet";
      const { id, promise } = await d.enqueue(request, meta.appName);
      return { id, result: promise };
    },
    decode: (r) => d.decode(r),
    kv: { get: (k) => d.kv.get(k), set: (k, v) => d.kv.set(k, v) },
    usd: (k) => d.usd(k),
    fetch: globalThis.fetch.bind(globalThis),
  };
}

/** The CoinGecko price feed (replaces ReferencePriceFeed). Keys come from build config, never committed. */
export function createPriceFeed(kv: KV, demoApiKey?: string): CoinGeckoPriceFeed {
  const feed = new CoinGeckoPriceFeed({ fetch: globalThis.fetch.bind(globalThis), store: kv, demoApiKey });
  void feed.load().then(() => feed.refresh());
  return feed;
}

export function createFeatures(host: FeatureHost, config: FeaturesConfig): FeaturesService {
  return new FeaturesService(host, config, { route: createRouteClient({ network: config.testnet ? "testnet" : "mainnet" }) });
}
