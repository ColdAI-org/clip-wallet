/**
 * Feature services (staking, swaps, buy, Secure Trade, explore, prices) for any host. Holds no keys: every
 * action ends in `enqueue`, the host's normal approval path.
 *
 * @module
 */
import { WALLET_ORIGIN, type AssetRef, type ChainContext, type DappRequest, type DecodedRequest, type Network, type TokenBalance } from "@clip-wallet/core";
import { CoinGeckoPriceFeed, FeaturesService, type FeatureHost, type FeaturesConfig } from "@clip-wallet/features";
import { createRouteClient } from "@clip-wallet/route";
import type { KV } from "./kv.js";

/** What the wallet exposes to the features. */
export interface FeatureHostDeps {
  networks: Network[];
  assets: AssetRef[];
  kv: KV;
  ctx(networkId: string): Promise<ChainContext>;
  balances(): Promise<TokenBalance[]>;
  /** decode → approval queue; resolves with finalize()'s result. */
  enqueue(request: DappRequest, appName: string): Promise<{ id: string; promise: Promise<unknown> }>;
  decode(request: DappRequest): Promise<DecodedRequest>;
  usd(assetKey: string): number | undefined;
  fetch?: typeof fetch;
}

export function createFeatureHost(d: FeatureHostDeps): FeatureHost {
  return {
    networks: () => d.networks,
    assets: () => d.assets,
    ctx: (id) => d.ctx(id),
    balances: () => d.balances(),
    async enqueue(request, meta) {
      // Wallet-built: the approval shows the wallet as the app, never "unrecognised site".
      request.origin = WALLET_ORIGIN;
      const { id, promise } = await d.enqueue(request, meta.appName);
      return { id, result: promise };
    },
    decode: (r) => d.decode(r),
    kv: { get: (k) => d.kv.get(k), set: (k, v) => d.kv.set(k, v) },
    usd: (k) => d.usd(k),
    fetch: d.fetch ?? globalThis.fetch.bind(globalThis),
  };
}

/** The CoinGecko price feed. Keys come from build config, never committed. */
export function createPriceFeed(kv: KV, demoApiKey?: string, f: typeof fetch = globalThis.fetch.bind(globalThis)): CoinGeckoPriceFeed {
  const feed = new CoinGeckoPriceFeed({ fetch: f, store: kv, demoApiKey });
  void feed.load().then(() => feed.refresh()).catch(() => undefined);
  return feed;
}

export function createFeatures(host: FeatureHost, config: FeaturesConfig): FeaturesService {
  return new FeaturesService(host, config, { route: createRouteClient({ network: config.testnet ? "testnet" : "mainnet" }) });
}
