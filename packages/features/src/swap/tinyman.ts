import { type AssetRef, type ChainContext, ClipError, type Network, msg, say } from "@clip-wallet/core";
import { type GroupTxnSpec, buildGroup, encodeUint64, logicSigAddress, netOf, readAccount, readLocalState } from "@clip-wallet/chains-algorand";
import type { Step } from "../steps.js";
import { b64ToBytes, formatUnits } from "../util.js";
import type { Unavailable } from "../views.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Tinyman AMM v2, quoted on-chain and built by the wallet (no API, no key):
 *  - Validator app ids from tinyman-js-sdk `src/validator.ts` (V2: testnet 148607000, mainnet 1002541853).
 *  - Pool address = logic signature of the v2 `pool_logicsig` template (tinyman-js-sdk `src/contract/v2/asc.json`)
 *    with bytes 3..27 replaced by uint64(validator app id) ‖ uint64(larger asset id) ‖ uint64(smaller asset id)
 *    (`TinymanContractV2.generateLogicSigAccountForPool`; ALGO = 0).
 *  - Reserves and fee from the pool's local state in the validator app (`asset_1_reserves`, `asset_2_reserves`,
 *    `total_fee_share`, `asset_1_id`, `asset_2_id`), read with algod `GET /v2/accounts/{pool}/applications/{app}`.
 *  - Fixed-input maths from `calculateFixedInputSwap` (tinyman-js-sdk `src/swap/v2/index.ts`).
 *  - Group (tinyman-amm-contracts-v2 `amm_approval.tl` "swap": Gtxn[N-1] input transfer, Gtxn[N] app call):
 *      [axfer 0 to yourself, if the bought token isn't added yet]
 *      pay / axfer exactly `amount` → pool
 *      appl NoOp validator ["swap", "fixed-input", uint64(min output)], accounts [pool], assets [asset1, asset2],
 *      fee = 2 × min fee (one inner transfer).
 *    The minimum output is enforced by the app: less → the whole group fails.
 */
export const TINYMAN_V2_VALIDATOR: Record<"mainnet" | "testnet", bigint> = { testnet: 148607000n, mainnet: 1002541853n };
export const TINYMAN_V2_POOL_TEMPLATE = "BoAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgQBbNQA0ADEYEkQxGYEBEkSBAUM=";
/** V2 pools refuse inputs below ceil(1 / 0.003) base units (tinyman-js-sdk `getV2MinSwapAssetInAmount`). */
export const TINYMAN_MIN_INPUT = 334n;
const OPT_IN_LOCK = 100_000n;
const ASSUMED_MIN_FEE = 1000n;

const te = new TextEncoder();

/** Tinyman v2 pool address for two asset ids (0 = ALGO). */
export function tinymanPoolAddress(validatorAppId: bigint, a: bigint, b: bigint): string {
  if (a === b) throw new Error("same asset");
  const [hi, lo] = a > b ? [a, b] : [b, a];
  const t = b64ToBytes(TINYMAN_V2_POOL_TEMPLATE);
  const program = new Uint8Array(t.length);
  program.set(t.subarray(0, 3), 0);
  program.set(encodeUint64(validatorAppId), 3);
  program.set(encodeUint64(hi), 11);
  program.set(encodeUint64(lo), 19);
  program.set(t.subarray(27), 27);
  return logicSigAddress(program);
}

/** Fixed-input output and fee (base units), exactly as the v2 pool computes them. */
export function fixedInputSwap(inputSupply: bigint, outputSupply: bigint, amountIn: bigint, totalFeeShare: bigint): { out: bigint; fee: bigint } {
  const fee = (amountIn * totalFeeShare) / 10_000n;
  const swapAmount = amountIn - fee;
  const k = inputSupply * outputSupply;
  const out = outputSupply - k / (inputSupply + swapAmount) - 1n;
  return { out, fee };
}

function assetIdOf(a: AssetRef): bigint {
  if (!a.address) return 0n;
  if (!/^\d+$/.test(a.address)) throw new ClipError(msg("bg.err.swapAssetUnavailable", { symbol: a.symbol }), "swap/tinyman-bad-asset");
  return BigInt(a.address);
}

interface TinymanQuoteData {
  validator: string;
  pool: string;
  asset1: string;
  asset2: string;
  optIn: boolean;
}

export class TinymanSwap implements SwapProvider {
  readonly id = "tinyman";
  readonly name = "Tinyman";
  readonly family = "algorand" as const;

  constructor(private readonly opts: { quoteTtlMs?: number; now?: () => number } = {}) {}

  availability(network: Network): Unavailable | null {
    if (network.family !== "algorand" || !netOf(network.id)) return { code: "swap/wrong-family", message: "Tinyman only swaps Algorand tokens." };
    return null;
  }

  private validator(ctx: ChainContext): bigint {
    const n = netOf(ctx.network.id);
    if (!n) throw new ClipError("Swapping isn't available on this network.", "swap/wrong-network");
    return TINYMAN_V2_VALIDATOR[n];
  }

  /** Balance, opt-in and fee checks (plain errors). Returns whether the bought token must be added first. */
  private async check(sell: AssetRef, buy: AssetRef, amount: bigint, ctx: ChainContext): Promise<boolean> {
    const sellId = assetIdOf(sell);
    const buyId = assetIdOf(buy);
    const acct = await readAccount(ctx, [sellId, buyId].filter((x) => x > 0n));
    if (acct.rekeyed) throw new ClipError("This account is controlled by another key, so Clip Wallet can't sign for it.", "algorand/rekeyed");
    const optIn = buyId > 0n && !acct.holdings.get(buyId.toString());
    if (buyId > 0n && acct.holdings.get(buyId.toString())?.frozen) throw new ClipError(`Your ${buy.symbol} is frozen by its issuer, so you can't receive more.`, "swap/frozen");
    if (sellId > 0n) {
      const h = acct.holdings.get(sellId.toString());
      if (!h || h.amount < amount) throw new ClipError(msg("bg.err.notEnoughForSwap", { symbol: sell.symbol }), "swap/insufficient");
      if (h.frozen) throw new ClipError(`Your ${sell.symbol} is frozen by its issuer, so it can't move right now.`, "swap/frozen");
    }
    const fees = ASSUMED_MIN_FEE * (optIn ? 4n : 3n);
    const needAlgo = fees + (optIn ? OPT_IN_LOCK : 0n) + (sellId === 0n ? amount : 0n);
    const spendable = acct.balance - acct.minBalance;
    if (needAlgo > spendable) {
      const extra = optIn ? ` Adding ${buy.symbol} also locks 0.1 ALGO.` : "";
      throw new ClipError(`You don't have enough ALGO for this swap and its ${formatUnits(fees, 6)} ALGO fee. Some ALGO has to stay in your account.${extra}`, "swap/insufficient");
    }
    return optIn;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const validator = this.validator(ctx);
    const sellId = assetIdOf(req.sell);
    const buyId = assetIdOf(req.buy);
    if (sellId === buyId) throw new ClipError("Pick two different assets.", "swap/same-asset");
    const amount = BigInt(req.amount);
    if (amount < TINYMAN_MIN_INPUT) throw new ClipError("This amount is too small to swap. Try a larger amount.", "swap/too-small");

    const pool = tinymanPoolAddress(validator, sellId, buyId);
    const state = await readLocalState(ctx, pool, validator);
    const noPool = new ClipError("There's no way to swap these two right now. Try another token.", "swap/no-route");
    if (!state) throw noPool;
    const n = (k: string) => {
      const v = state.get(k);
      return typeof v === "bigint" ? v : null;
    };
    const a1 = n("asset_1_id");
    const a2 = n("asset_2_id");
    const r1 = n("asset_1_reserves");
    const r2 = n("asset_2_reserves");
    const feeShare = n("total_fee_share");
    const [hi, lo] = sellId > buyId ? [sellId, buyId] : [buyId, sellId];
    // The pool account must really be the pool of exactly these two assets.
    if (a1 !== hi || a2 !== lo || r1 === null || r2 === null || feeShare === null || feeShare >= 10_000n) throw noPool;
    const [inSupply, outSupply] = sellId === a1 ? [r1, r2] : [r2, r1];
    if (inSupply <= 0n || outSupply <= 0n) throw noPool;
    const { out } = fixedInputSwap(inSupply, outSupply, amount, feeShare);
    if (out <= 0n) throw new ClipError("This amount is too small to swap. Try a larger amount.", "swap/too-small");
    if (out >= outSupply) throw new ClipError("There isn't enough in this pool for that amount. Try a smaller amount.", "swap/no-liquidity");
    const minBuy = minOut(out, req.slippageBps);
    if (minBuy <= 0n) throw new ClipError("This amount is too small to swap. Try a larger amount.", "swap/too-small");

    const optIn = await this.check(req.sell, req.buy, amount, ctx);
    // Price impact against the pool's spot price (fee included), in percent.
    const impact = Math.max(0, (1 - (Number(out) * Number(inSupply)) / (Number(amount) * Number(outSupply))) * 100);
    const now = (this.opts.now ?? Date.now)();
    const q: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: req.amount,
      buyAmount: out.toString(),
      minBuyAmount: minBuy.toString(),
      slippageBps: req.slippageBps,
      priceImpactPct: impact,
      route: ["Tinyman"],
      expiresAt: now + (this.opts.quoteTtlMs ?? 30_000),
      data: { validator: validator.toString(), pool, asset1: hi.toString(), asset2: lo.toString(), optIn } satisfies TinymanQuoteData,
    };
    if (optIn) q.association = { tokenId: buyId.toString(), symbol: req.buy.symbol };
    return q;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const d = quote.data as TinymanQuoteData;
    const validator = this.validator(ctx);
    const sellId = assetIdOf(quote.sell);
    const buyId = assetIdOf(quote.buy);
    // Re-derive rather than trust the stored quote data.
    const pool = tinymanPoolAddress(validator, sellId, buyId);
    if (pool !== d.pool || d.validator !== validator.toString()) throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    const [hi, lo] = sellId > buyId ? [sellId, buyId] : [buyId, sellId];
    const amount = BigInt(quote.sellAmount);
    const minBuy = BigInt(quote.minBuyAmount);
    const sell = quote.sell.symbol;
    const buy = quote.buy.symbol;
    const lines = [
      { label: "Route", value: "Tinyman" },
      { label: "At least", value: `${formatUnits(minBuy, quote.buy.decimals)} ${buy}, or nothing happens` },
    ];
    if (d.optIn) lines.push({ label: "Also", value: `Adds ${buy} to your account first. That locks 0.1 ALGO while ${buy} is in your account.` });
    return [
      {
        title: d.optIn ? `Add ${buy} and swap ${sell} for ${buy}` : say("bg.req.swap", { pay: sell, get: buy }),
        lines,
        request: async () => {
          const optIn = await this.check(quote.sell, quote.buy, amount, ctx);
          const me = ctx.account.address;
          const specs: GroupTxnSpec[] = [];
          if (optIn) specs.push({ type: "axfer", receiver: me, amount: 0n, assetId: buyId });
          specs.push(sellId === 0n ? { type: "pay", receiver: pool, amount } : { type: "axfer", receiver: pool, amount, assetId: sellId });
          specs.push({
            type: "appl",
            appId: validator,
            args: [te.encode("swap"), te.encode("fixed-input"), encodeUint64(minBuy)],
            accounts: [pool],
            foreignAssets: [hi, lo],
            feeMultiplier: 2,
          });
          return (await buildGroup(specs, ctx)).request;
        },
      },
    ];
  }
}
