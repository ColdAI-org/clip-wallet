import { type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import type { Step } from "../steps.js";
import type { Unavailable } from "../views.js";
import type { SwapProvider, SwapQuote, SwapQuoteRequest } from "./types.js";

/**
 * DexHunter (https://dexhunter.gitbook.io/dexhunter-partners, checked 2026-10-03): base https://api-us.dexhunterv3.app,
 * "All API requests must include the X-Partner-Id header". It routes across many Cardano DEXes (WingRiders,
 * SundaeSwap, Splash, …), each with its own order contract and datum, so its transactions can't be checked with the
 * Minswap allow-list. Wired here, off: without a partner key it says so; with one it still stays off until each
 * DEX's order scripts and datums are allow-listed and verified like `MinswapSwap` does.
 */
export const DEXHUNTER_BASE = "https://api-us.dexhunterv3.app";

export class DexHunterSwap implements SwapProvider {
  readonly id = "dexhunter";
  readonly name = "DexHunter";
  readonly family = "cardano" as const;

  constructor(private readonly opts: { apiKey?: string } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "cardano") return { code: "swap/wrong-family", message: "DexHunter only swaps on Cardano." };
    if (network.testnet) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    if (!this.opts.apiKey) return { code: "swap/not-configured", message: "Swapping through DexHunter needs a partner key that isn't set up in this build." };
    return { code: "swap/not-verified", message: "Swapping through DexHunter isn't switched on in this build yet." };
  }

  async quote(_req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network)!;
    throw new ClipError(why.message, why.code);
  }

  async build(_quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const why = this.availability(ctx.network)!;
    throw new ClipError(why.message, why.code);
  }
}
