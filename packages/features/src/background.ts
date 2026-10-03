import type { DappRequest, DecodedRequest } from "@clip-wallet/core";
import { tokenAssetKey } from "@clip-wallet/chains-hedera";
import { featuredFor } from "./dapps/featured.js";
import type { FeatureHost, FeaturesConfig } from "./host.js";
import { saucerSwapPositions, uniswapPositions } from "./lp/readers.js";
import type { FeatureRequest, FeatureResponseMap } from "./messages.js";
import { BanxaOnRamp, C14OnRamp, MoonPayOnRamp, OnRampService } from "./onramp/index.js";
import { HederaStaking, SolanaStaking, StakingService } from "./staking/index.js";
import { refineDecoded } from "./steps.js";
import { type RouteQuoter, JupiterSwap, SaucerSwap, SwapService, ZeroExSwap } from "./swap/index.js";
import { SecureTradeService } from "./trade/index.js";
import type { LpPositionView } from "./views.js";

/**
 * The background side of every feature screen. One instance per background lifetime. Holds no keys: every
 * action ends in host.enqueue(), i.e. the normal approval path.
 */
export class FeaturesService {
  readonly staking: StakingService;
  readonly swaps: SwapService;
  readonly onramp: OnRampService;
  readonly trade: SecureTradeService;

  constructor(
    private readonly host: FeatureHost,
    config: FeaturesConfig,
    deps: { route?: RouteQuoter } = {},
  ) {
    this.staking = new StakingService(host, [new HederaStaking(), new SolanaStaking(config.solanaValidators)]);
    this.swaps = new SwapService(
      host,
      [new SaucerSwap(), new JupiterSwap({ apiKey: config.swap?.jupiterApiKey }), new ZeroExSwap({ apiKey: config.swap?.zeroExApiKey })],
      { route: deps.route, defaultSlippageBps: config.swap?.defaultSlippageBps },
    );
    this.onramp = new OnRampService(host, [new MoonPayOnRamp(config.onramp?.moonpay), new BanxaOnRamp(config.onramp?.banxa), new C14OnRamp(config.onramp?.c14)], {
      testnet: config.testnet,
    });
    this.trade = new SecureTradeService(host, { linkBase: config.tradeLinkBase });
  }

  /** Call from WalletService.enqueueTransaction right after the chain module's decode(). */
  refine(request: DappRequest, decoded: DecodedRequest): DecodedRequest {
    return refineDecoded(request, decoded);
  }

  async handle<T extends FeatureRequest["type"]>(m: Extract<FeatureRequest, { type: T }>): Promise<FeatureResponseMap[T]> {
    return (await this.dispatch(m as FeatureRequest)) as FeatureResponseMap[T];
  }

  private async dispatch(m: FeatureRequest): Promise<unknown> {
    switch (m.type) {
      case "featStakingOverview":
        return this.staking.overview();
      case "featStakingOptions":
        return this.staking.options(m.assetKey);
      case "featStake":
        return this.staking.stake(m);
      case "featStakeAction":
        return this.staking.act(m);
      case "featSwapStatus":
        return this.swaps.status();
      case "featSwapQuote":
        return this.swaps.quote(m);
      case "featSwapExecute":
        return this.swaps.execute(m.quoteId);
      case "featBuyAssets":
        return this.onramp.buyable();
      case "featBuyOptions":
        return this.onramp.options(m);
      case "featTradeList":
        return this.trade.list();
      case "featTradeCreate":
        return this.trade.createOffer(m);
      case "featTradeReview":
        return this.trade.review(m.link);
      case "featTradeAccept":
        return this.trade.accept(m.link);
      case "featFeatured":
        return featuredFor(new Set(this.host.networks().map((n) => n.family)));
      case "featLpPositions":
        return this.lpPositions();
    }
  }

  async lpPositions(): Promise<LpPositionView[]> {
    const usd = (k: string) => this.host.usd(k);
    const all = await Promise.all(
      this.host.networks().map(async (n) => {
        try {
          const ctx = await this.host.ctx(n.id);
          if (n.family === "hedera") return await saucerSwapPositions(ctx, usd, (t) => tokenAssetKey(n.id, t));
          if (n.family === "evm") {
            const keyOf = (addr: string) => this.host.assets().find((a) => a.networkId === n.id && a.address?.toLowerCase() === addr.toLowerCase())?.key;
            return await uniswapPositions(ctx, usd, keyOf);
          }
        } catch {
          // One network failing shouldn't hide the others.
        }
        return [];
      }),
    );
    return all.flat();
  }
}
