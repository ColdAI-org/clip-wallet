import { type AssetRef, type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import {
  type Connection,
  type SubstrateModule,
  type XcmLocation,
  assetLocation,
  connect,
  nativeLocation,
  readStorage,
  runtimeCall,
  specOf,
  spendableNative,
  substrateModule,
} from "@clip-wallet/chains-substrate";
import type { Step } from "../steps.js";
import { formatUnits } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Asset Hub's native AMM (pallet `AssetConversion`, Uniswap-v2 style, every pool paired with the relay token).
 * No third party, no approvals: the swap call moves your tokens itself, and `amount_out_min` is enforced
 * on-chain (the extrinsic fails and nothing moves if the output would be lower).
 *
 *  - Quote: runtime API `AssetConversionApi.quote_price_exact_tokens_for_tokens(asset1, asset2, amount, include_fee
 *    = true)` per hop (it prices one pool), and `get_reserves` for price impact. Read through `state_call`.
 *  - Ids: XCM Locations. The relay token is `{ parents: 1, interior: Here }`; a pallet-assets token is
 *    `{ parents: 0, interior: X2[PalletInstance(50), GeneralIndex(id)] }` (AssetConversion.Pools keys, read live).
 *  - Swap: `swap_exact_tokens_for_tokens(path, amount_in, amount_out_min, send_to = you, keep_alive)`. Token →
 *    token goes through the relay token: [A, native, B].
 */

const QUOTE_TTL_MS = 30_000;

interface HubData {
  /** Pallet-assets ids, "native" for the relay token, in path order. */
  path: ("native" | number)[];
  keepAlive: boolean;
}

const locOf = (x: "native" | number): XcmLocation => (x === "native" ? nativeLocation() : assetLocation(x));

function idOf(a: AssetRef): "native" | number {
  if (!a.address) return "native";
  const id = Number(a.address);
  if (!/^\d+$/.test(a.address) || !Number.isSafeInteger(id)) throw new ClipError(`Swapping ${a.symbol} isn't available yet.`, "swap/unsupported-asset");
  return id;
}

export class AssetHubSwap implements SwapProvider {
  readonly id = "assethub";
  readonly name = "Asset Hub";
  readonly family = "substrate" as const;
  private readonly module: SubstrateModule;

  constructor(opts: { module?: SubstrateModule } = {}) {
    this.module = opts.module ?? substrateModule;
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "substrate") return { code: "swap/wrong-family", message: "Asset Hub only swaps Polkadot tokens." };
    if (!specOf(network.id)?.assetHub || !network.rpcUrls.length) return { code: "swap/unsupported", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private async conn(ctx: ChainContext): Promise<Connection> {
    const c = await connect(ctx);
    if (!c.rt.hasApi("AssetConversionApi", "quote_price_exact_tokens_for_tokens") || !c.rt.hasCall("AssetConversion", "swap_exact_tokens_for_tokens")) {
      throw new ClipError("Swapping these tokens isn't available in this test version yet.", "swap/unsupported");
    }
    return c;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    if (req.sell.networkId !== ctx.network.id || req.buy.networkId !== ctx.network.id) throw new ClipError("Pick two tokens on the same network.", "swap/wrong-network");
    const c = await this.conn(ctx);
    const sellId = idOf(req.sell);
    const buyId = idOf(req.buy);
    if (sellId === buyId) throw new ClipError("Pick two different tokens.", "swap/same-token");
    const amount = BigInt(req.amount);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "swap/bad-amount");
    const path: ("native" | number)[] = sellId === "native" || buyId === "native" ? [sellId, buyId] : [sellId, "native", buyId];

    // Output and the no-impact (spot) output, hop by hop.
    let out = amount;
    let spot = amount;
    for (let i = 0; i + 1 < path.length; i++) {
      const [a, b] = [locOf(path[i]!), locOf(path[i + 1]!)];
      const q = await runtimeCall<bigint | undefined>(c.rpc, c.rt, "AssetConversionApi", "quote_price_exact_tokens_for_tokens", [a, b, out, true]).catch(() => undefined);
      if (q === undefined || q === null || BigInt(q) <= 0n) {
        throw new ClipError(`There's no way to swap ${req.sell.symbol} for ${req.buy.symbol} right now. Try a smaller amount or another token.`, "swap/no-route");
      }
      out = BigInt(q);
      const r = await runtimeCall<[bigint, bigint] | undefined>(c.rpc, c.rt, "AssetConversionApi", "get_reserves", [a, b]).catch(() => undefined);
      spot = r && BigInt(r[0]) > 0n ? (spot * BigInt(r[1])) / BigInt(r[0]) : 0n;
    }
    const minBuy = minOut(out, req.slippageBps);
    if (minBuy <= 0n) throw new ClipError("That amount is too small to swap. Try a bigger one.", "swap/too-small");

    // Selling the relay token: keep the account alive and leave room for the fee.
    let keepAlive = true;
    if (sellId === "native") {
      const spendable = await spendableNative(c);
      const feeBuffer = 10n ** BigInt(Math.max(0, c.spec.decimals - 2));
      if (amount + feeBuffer > spendable) {
        throw new ClipError(`Swap a little less ${c.spec.symbol}: your account must keep a minimum balance plus a little for the network fee.`, "swap/insufficient");
      }
    } else {
      // Selling all of a token closes its balance (keep_alive = false); anything less must leave its minimum.
      const [asset, held] = await Promise.all([
        readStorage<{ min_balance: bigint }>(c.rpc, c.rt, "Assets", "Asset", sellId),
        readStorage<{ balance: bigint }>(c.rpc, c.rt, "Assets", "Account", sellId, c.me),
      ]);
      const bal = BigInt(held?.balance ?? 0n);
      if (amount > bal) throw new ClipError(`You don't have enough ${req.sell.symbol} for this swap.`, "swap/insufficient");
      const min = BigInt(asset?.min_balance ?? 0n);
      if (amount === bal) keepAlive = false;
      else if (bal - amount < min) {
        throw new ClipError(`Swap all your ${req.sell.symbol}, or leave at least ${formatUnits(min, req.sell.decimals)} ${req.sell.symbol}.`, "swap/below-minimum");
      }
    }
    // Buying a token you don't hold yet: the amount must reach that token's minimum balance.
    if (buyId !== "native") {
      const [asset, held] = await Promise.all([
        readStorage<{ min_balance: bigint }>(c.rpc, c.rt, "Assets", "Asset", buyId),
        readStorage<{ balance: bigint }>(c.rpc, c.rt, "Assets", "Account", buyId, c.me),
      ]);
      const min = BigInt(asset?.min_balance ?? 0n);
      if (!held && minBuy < min) {
        throw new ClipError(`Swap a bit more: you'd get less than the smallest amount of ${req.buy.symbol} an account can hold (${formatUnits(min, req.buy.decimals)}).`, "swap/below-minimum");
      }
    }

    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: amount.toString(),
      buyAmount: out.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      route: path.length > 2 ? [`Asset Hub pools (via ${c.spec.symbol})`] : ["Asset Hub pool"],
      expiresAt: Date.now() + QUOTE_TTL_MS,
      data: { path, keepAlive } satisfies HubData,
    };
    if (spot > 0n && spot > out) q.priceImpactPct = Number(((spot - out) * 1_000_000n) / spot) / 10_000;
    return q;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const d = quote.data as HubData;
    if (!d || !Array.isArray(d.path) || d.path.length < 2) throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    if (idOf(quote.sell) !== d.path[0] || idOf(quote.buy) !== d.path[d.path.length - 1]) throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    const sell = `${formatUnits(quote.sellAmount, quote.sell.decimals)} ${quote.sell.symbol}`;
    const buy = `${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}`;
    return [
      {
        title: `Swap ${sell} for ~${buy}`,
        lines: [{ label: "You get at least", value: `${formatUnits(quote.minBuyAmount, quote.buy.decimals)} ${quote.buy.symbol}, or nothing happens` }],
        request: async () => {
          const c = await connect(ctx);
          return this.module.buildCall(
            {
              pallet: "AssetConversion",
              call: "swap_exact_tokens_for_tokens",
              args: {
                path: d.path.map(locOf),
                amount_in: BigInt(quote.sellAmount),
                amount_out_min: BigInt(quote.minBuyAmount),
                send_to: c.me,
                keep_alive: d.keepAlive,
              },
            },
            ctx,
          );
        },
      },
    ];
  }
}
