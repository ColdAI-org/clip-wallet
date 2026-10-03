import { type AssetRef, type ChainContext, ClipError, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import { aptosNetworkOf } from "@clip-wallet/chains-aptos";
import { fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Hyperion (concentrated-liquidity DEX on Aptos). Keyless; addresses and endpoints from the official @hyperionxyz/sdk
 * 0.1.1 (`sdkOptions` for MAINNET / TESTNET, `Swap.estToAmount`, `Swap.swapTransactionPayload`), checked live 2026-10-03:
 *   quote: GET {api}/base/rate/getSwapInfo?amount&from&to&safeMode=false&flag=in → { path: pool addresses, amountIn, amountOut }
 *          (from/to are fungible-asset metadata addresses; APT = 0xa; a coin type's paired FA comes from
 *          view 0x1::coin::paired_metadata<T>()).
 *   build (wallet-built, nothing from the API but the pool list):
 *     {router}::router_v3::swap_batch(signer, path: vector<address>, from: Object<Metadata>, to: Object<Metadata>,
 *                                     amount_in: u64, min_out: u64, recipient: address)              (sell a fungible asset)
 *     {router}::router_v3::swap_batch_coin_entry<CoinIn>(same arguments)                              (sell a legacy coin)
 *   Each pool in the path must hold `{router}::pool_v3::LiquidityPoolV3` (checked before building). The recipient is you
 *   and min_out is enforced on-chain (the router aborts below it). ABIs read from GET /accounts/{router}/module/router_v3.
 * Pools exist on both networks, but testnet has little liquidity: most testnet pairs get "no way to swap these two".
 */
export const HYPERION: Record<"mainnet" | "testnet", { router: string; api: string }> = {
  mainnet: { router: "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c", api: "https://api.hyperion.xyz" },
  testnet: { router: "0x69faed94da99abb7316cb3ec2eeaa1b961a47349fad8c584f67a930b0d14fec7", api: "https://api-testnet.hyperion.xyz" },
};
const APT_FA = `0x${"a".padStart(64, "0")}`;
const MAX_HOPS = 4;

function long(a: string): string {
  return `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

const ADDRESS = /^0x[0-9a-fA-F]{1,64}$/;

interface SwapInfo {
  path?: string[];
  amountIn?: string;
  amountOut?: string;
}

export class HyperionSwap implements SwapProvider {
  readonly id = "hyperion";
  readonly name = "Hyperion";
  readonly family = "aptos" as const;

  constructor(private readonly opts: { apiBase?: Partial<Record<"mainnet" | "testnet", string>>; quoteTtlMs?: number; now?: () => number } = {}) {}

  private deployment(network: Network): { router: string; api: string } | null {
    const n = aptosNetworkOf(network.id);
    if (n !== "mainnet" && n !== "testnet") return null;
    return { router: HYPERION[n].router, api: this.opts.apiBase?.[n] ?? HYPERION[n].api };
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "aptos") return { code: "swap/wrong-family", message: "Hyperion only swaps Aptos tokens." };
    if (!this.deployment(network)) return { code: "swap/unsupported-network", message: "Swapping these tokens isn't available in this test version yet." };
    return null;
  }

  private rest(ctx: ChainContext): string {
    const url = ctx.network.rpcUrls[0];
    if (!url) throw new ClipError("Swapping isn't available right now.", "swap/no-rpc");
    return url.replace(/\/+$/, "");
  }

  /** The fungible-asset metadata address for an asset, plus its coin type when it is a legacy coin. */
  async faOf(a: AssetRef, ctx: ChainContext): Promise<{ fa: string; coinType?: string }> {
    if (!a.address) return { fa: APT_FA };
    if (!a.address.includes("::")) {
      if (!ADDRESS.test(a.address)) throw new ClipError("Clip Wallet can't swap this token.", "swap/bad-asset");
      return { fa: long(a.address) };
    }
    if (/^0x0*1::aptos_coin::AptosCoin$/.test(a.address)) return { fa: APT_FA, coinType: "0x1::aptos_coin::AptosCoin" };
    const r = await fetchJson<[{ vec: { inner: string }[] }]>(ctx.fetch, `${this.rest(ctx)}/view`, "Aptos", {
      body: { function: "0x1::coin::paired_metadata", type_arguments: [a.address], arguments: [] },
    });
    const inner = r[0]?.vec?.[0]?.inner;
    if (!inner) throw new ClipError(`${a.symbol} can't be swapped on Hyperion yet.`, "swap/no-route");
    return { fa: long(inner), coinType: a.address };
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const dep = this.deployment(ctx.network);
    if (!dep) throw new ClipError("Swapping these tokens isn't available in this test version yet.", "swap/unsupported-network");
    const [from, to] = await Promise.all([this.faOf(req.sell, ctx), this.faOf(req.buy, ctx)]);
    if (from.fa === to.fa) throw new ClipError("Pick two different assets.", "swap/same-asset");
    const u = new URL(`${dep.api}/base/rate/getSwapInfo`);
    u.searchParams.set("amount", req.amount);
    u.searchParams.set("from", from.fa);
    u.searchParams.set("to", to.fa);
    u.searchParams.set("safeMode", "false");
    u.searchParams.set("flag", "in");
    const info = await fetchJson<SwapInfo>(ctx.fetch, u.toString(), "Hyperion");
    const out = /^\d+$/.test(info.amountOut ?? "") ? BigInt(info.amountOut!) : 0n;
    const path = (info.path ?? []).filter((p) => typeof p === "string");
    if (!path.length || out <= 0n) throw new ClipError("There's no way to swap these two right now. Try a smaller amount or another token.", "swap/no-route");
    if (path.length > MAX_HOPS || !path.every((p) => ADDRESS.test(p))) throw new ClipError("Hyperion sent a route Clip Wallet won't use. Nothing was sent.", "swap/hyperion-refused");
    if (info.amountIn !== undefined && info.amountIn !== req.amount) throw new ClipError("Hyperion priced a different amount. Try again.", "swap/hyperion-refused");
    // Every hop must be a Hyperion pool (the resource only its router package can create).
    await Promise.all(
      path.map(async (pool) => {
        try {
          await fetchJson(ctx.fetch, `${this.rest(ctx)}/accounts/${long(pool)}/resource/${dep.router}::pool_v3::LiquidityPoolV3`, "Aptos");
        } catch (e) {
          throw new ClipError("Hyperion sent a route through a pool Clip Wallet can't confirm. Nothing was sent.", "swap/hyperion-refused", e);
        }
      }),
    );
    const now = this.opts.now?.() ?? Date.now();
    return {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: out.toString(),
      minBuyAmount: minOut(out, req.slippageBps).toString(),
      slippageBps: req.slippageBps,
      route: ["Hyperion"],
      expiresAt: now + (this.opts.quoteTtlMs ?? 30_000),
      data: { path: path.map(long), from, to, router: dep.router },
    };
  }

  /** The exact entry-function payload for a quote (wire form chains-aptos accepts). */
  payloadFor(quote: SwapQuote, me: string): { function: `${string}::${string}::${string}`; typeArguments: string[]; functionArguments: unknown[] } {
    const d = quote.data as { path: string[]; from: { fa: string; coinType?: string }; to: { fa: string }; router: string };
    const args = [d.path, d.from.fa, d.to.fa, quote.sellAmount, quote.minBuyAmount, long(me)];
    return d.from.coinType && d.from.fa !== APT_FA
      ? { function: `${d.router}::router_v3::swap_batch_coin_entry`, typeArguments: [d.from.coinType], functionArguments: args }
      : { function: `${d.router}::router_v3::swap_batch`, typeArguments: [], functionArguments: args };
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const me = long(ctx.account.address);
    return [
      {
        title: `Swap ${quote.sell.symbol} for ${quote.buy.symbol}`,
        request: {
          id: randomId(),
          origin: WALLET_ORIGIN,
          via: "injected",
          family: "aptos",
          networkId: ctx.network.id,
          method: "aptos:signAndSubmitTransaction",
          params: { inputs: [{ account: me, payload: this.payloadFor(quote, me) }] },
        },
      },
    ];
  }
}
