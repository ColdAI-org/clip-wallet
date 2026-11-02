import { type AssetRef, type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN, labelled, msg, titled, withoutTrailing } from "@clip-wallet/core";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, isAddressEqual, toHex } from "viem";
import type { FeatureHost } from "../host.js";
import { ethCall, fetchJson } from "../http.js";
import type { Step } from "../steps.js";
import { formatUnits, percent, randomId } from "../util.js";
import type { Unavailable } from "../views.js";
import { CLIP_FEE, SODAX_FEE_RECEIVERS, clipFeeOn, isReviewedFeeReceiver, parseFeeReceivers } from "./sodax-fee.js";
import {
  SODAX_DEADLINE_S,
  SODAX_NATIVE,
  SODAX_SPOKES,
  SONIC_RPC_URL,
  type SodaxIntent,
  type SodaxSpoke,
  type SodaxSwapPlan,
  assetInfoCall,
  checkSodaxSwap,
  hubWalletCall,
  isHubAssetOf,
  readHubWallet,
  sodaxSwapTx,
} from "./sodax-intent.js";
import { type SwapProvider, type SwapQuote, type SwapQuoteRequest, minOut } from "./types.js";

/**
 * Cross-network swaps through SODAX (docs/features/sodax-swaps.md), with the disclosed 0.875 % Clip fee, paid to
 * ColdAI LLC.
 *
 * SODAX's swap API needs a partner key, so the wallet talks to an ExClip server's public proxy, which holds it
 * (ExClip apps/server/src/services/sodaxProxy.ts:31-51, routes/exclip.ts:53-55 and :76-77). Paths and shapes are
 * @sodax/swaps-api 2.2.0 dist/index.mjs (client and response schemas) and @sodax/types 2.2.0
 * dist/backend/backendApiV2.d.ts (request bodies):
 *   GET  {server}/api/exclip/config                → { sodaxConfigured, tradingEnabled, partnerFeeBps } (ExClip services/config.ts:57-67)
 *   GET  {server}/api/exclip/sodax/swaps/tokens    → { [chainKey]: SwapToken[] }   (:5350-5358, :5516-5524)
 *   POST {server}/api/exclip/sodax/swaps/quote     → { quotedAmount }              (:5386-5389, :5534-5547; body d.ts:214-231)
 *   POST {server}/api/exclip/sodax/swaps/submit-tx → { success, data: { status } } (:5422-5429, :5708-5716; body d.ts:463-474)
 * The server must charge no fee of its own (partnerFeeBps 0): it would pin one into the quote (sodaxProxy.ts:97-101) and
 * the minimum you get would be set below what the swap can really give.
 *
 * The server only quotes. The wallet builds the transaction itself (./sodax-intent.ts) from what it checked on Sonic
 * (your hub wallet, and that each hub asset is the token you chose), and checks the exact bytes before they can be
 * approved: the fee receiver is on the reviewed list, the fee is at most 0.875 %, and everything else is the plan. Your
 * own signer signs on the normal approval path. Once the swap is sent, submit-tx hands it to SODAX; a submit that
 * doesn't go through is kept on the device and retried.
 *
 * Off unless the build sets both the server and a reviewed fee receiver; mainnet only (SODAX has no test networks).
 * Tokenised stocks (isRwa) are never offered.
 */
export interface SodaxSwapOptions {
  /** ExClip server base URL (https). Unset: SODAX is off and hidden. */
  serverUrl?: string;
  /** Where the Clip fee goes (ColdAI LLC's address). Must be on sodax-fee-receivers.json, or SODAX is off. */
  feeReceiver?: string;
  /** The wallet's name (config.name), for refusals ("… so Clip Wallet stopped it"). */
  walletName: string;
  testnet: boolean;
  /** Keeps submits that haven't gone through (the features host's kv). */
  kv?: FeatureHost["kv"];
  /** Tests only: a reviewed list other than the committed one. */
  receivers?: readonly string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A token in SODAX's list (@sodax/swaps-api dist/index.mjs:5350-5358). `isRwa` isn't in that schema but is in the raw
 * list: SODAX flags its tokenised stocks with it (the bundled token configs, e.g. dist/index.mjs:512-521), and ExClip
 * refuses them by it (sodaxProxy.ts:153-168).
 */
export interface SodaxToken {
  symbol: string;
  decimals: number;
  address: string;
  hubAsset: string;
  isRwa?: boolean;
}

/** What a quote keeps for build(): the plan without its per-signature fields, and where the swap arrives. */
interface SodaxQuoteData {
  plan: Omit<SodaxSwapPlan, "intentId" | "deadline">;
  arrivesOn: string;
}

/** submit-tx's body, as the SDK sends it: relayData is the hub-call payload (@sodax/sdk 2.2.0 dist/index.mjs:31057-31063, :31441). */
interface SubmitBody {
  txHash: string;
  srcChainKey: string;
  walletAddress: string;
  intent: Record<string, string | boolean>;
  relayData: string;
}

const OFF = "Swapping these tokens isn't switched on in this build.";
const CACHE_MS = 5 * 60_000;
const PENDING_KEY = "features:sodax:pending-submits";
const PENDING_MAX_AGE_MS = 24 * 60 * 60_000;
const SUBMIT_ATTEMPTS = 3;
const RECEIPT_POLL_MS = 2_000;
const RECEIPT_WAIT_MS = 90_000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** SODAX's token list without tokenised stocks: every token whose isRwa isn't plainly false or absent is dropped. */
export function sodaxTokens(body: unknown): Record<string, SodaxToken[]> {
  const out: Record<string, SodaxToken[]> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const [key, list] of Object.entries(body as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[key] = list.filter((t): t is SodaxToken => {
      if (!t || typeof t !== "object") return false;
      const x = t as Record<string, unknown>;
      return (x.isRwa === undefined || x.isRwa === false) && typeof x.symbol === "string" && Number.isInteger(x.decimals)
        && typeof x.address === "string" && ADDRESS.test(x.address) && typeof x.hubAsset === "string" && ADDRESS.test(x.hubAsset);
    });
  }
  return out;
}

/** The intent as submit-tx takes it: bigints as decimal strings (swaps-api dist/index.mjs:28-43), no feeAmount (sdk :34123-34126). */
function wireIntent(i: SodaxIntent): Record<string, string | boolean> {
  return {
    intentId: i.intentId.toString(),
    creator: i.creator,
    inputToken: i.inputToken,
    outputToken: i.outputToken,
    inputAmount: i.inputAmount.toString(),
    minOutputAmount: i.minOutputAmount.toString(),
    deadline: i.deadline.toString(),
    allowPartialFill: i.allowPartialFill,
    srcChain: i.srcChain.toString(),
    dstChain: i.dstChain.toString(),
    srcAddress: i.srcAddress,
    dstAddress: i.dstAddress,
    solver: i.solver,
    data: i.data,
  };
}

/** A fresh intent id, as the SDK makes one (sdk dist/index.mjs:6774-6781). */
function randomUint256(): bigint {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return BigInt(`0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
}

export class SodaxSwap implements SwapProvider {
  readonly id = "sodax";
  readonly name = "SODAX";
  readonly family = "evm" as const;
  readonly crossNetwork = true as const;

  private readonly receivers: readonly string[];
  private server?: { at: number; ok: boolean };
  private tokenList?: { at: number; list: Record<string, SodaxToken[]> };
  private readonly hubWallets = new Map<string, string>();
  private readonly hubAssets = new Set<string>();
  private retrying?: Promise<void>;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: SodaxSwapOptions) {
    this.receivers = opts.receivers ? parseFeeReceivers({ receivers: opts.receivers }) : SODAX_FEE_RECEIVERS;
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  private url(path: string): string {
    return `${withoutTrailing(this.opts.serverUrl!, "/")}/api/exclip/${path}`;
  }

  availability(network: Network): Unavailable | null {
    if (network.family !== "evm") return { code: "swap/wrong-family", message: "SODAX only swaps from EVM networks in this build." };
    if (this.opts.testnet || network.testnet) return { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." };
    if (!this.opts.serverUrl?.startsWith("https://") || !this.opts.feeReceiver) return { code: "swap/not-configured", message: OFF };
    if (!isReviewedFeeReceiver(this.opts.feeReceiver, this.receivers)) return { code: "swap/fee-receiver-not-allowed", message: OFF };
    if (!network.chainId || !SODAX_SPOKES[network.chainId]) return { code: "swap/unsupported-network", message: "Swapping isn't available here yet." };
    return null;
  }

  async quote(req: SwapQuoteRequest, ctx: ChainContext): Promise<SwapQuote> {
    const why = this.availability(ctx.network);
    if (why) throw new ClipError(why.message, why.code);
    const f = ctx.fetch;
    // Earlier submits that didn't go through are retried alongside, never in the way of a price.
    void this.retryPending(f);
    const src = SODAX_SPOKES[ctx.network.chainId!]!;
    const there = req.destination;
    const dst = there && this.availability(there.network) === null ? SODAX_SPOKES[there.network.chainId!] : undefined;
    if (!there || !dst || dst.relayId === src.relayId || !ADDRESS.test(there.address)) {
      throw new ClipError(msg("bg.err.noSwapRoute"), "swap/no-route");
    }
    await this.ready(f);
    const [sellToken, buyToken] = await Promise.all([this.token(f, src, req.sell), this.token(f, dst, req.buy)]);
    const gross = BigInt(req.amount);
    const fee = clipFeeOn(gross);
    if (fee <= 0n) throw new ClipError(msg("bg.err.swapTooSmall"), "swap/too-small");
    const from = getAddress(ctx.account.address);
    const [hubWallet] = await Promise.all([this.hubWallet(f, src, from), this.checkHubAsset(f, sellToken, src), this.checkHubAsset(f, buyToken, dst)]);
    // The quote is for what is swapped after the fee. No partnerFee is sent: without one SODAX charges none
    // (@sodax/types backendApiV2.d.ts:37-40), and the server pins its own anyway (sodaxProxy.ts:97-101).
    const q = await fetchJson<{ quotedAmount?: unknown }>(f, this.url("sodax/swaps/quote"), "SODAX", {
      body: { tokenSrc: sellToken.address, tokenSrcChainKey: src.key, tokenDst: buyToken.address, tokenDstChainKey: dst.key, amount: (gross - fee).toString(), quoteType: "exact_input" },
    });
    const out = typeof q.quotedAmount === "string" && /^\d{1,78}$/.test(q.quotedAmount) ? BigInt(q.quotedAmount) : 0n;
    const floor = minOut(out, req.slippageBps);
    if (floor <= 0n) throw new ClipError(msg("bg.err.noSwapRouteToken"), "swap/no-route");
    const plan: SodaxQuoteData["plan"] = {
      src,
      dst,
      from,
      to: getAddress(there.address),
      sellToken: getAddress(sellToken.address),
      sellHubAsset: getAddress(sellToken.hubAsset),
      buyHubAsset: getAddress(buyToken.hubAsset),
      hubWallet,
      gross,
      fee,
      feeReceiver: getAddress(this.opts.feeReceiver!),
      minOut: floor,
    };
    const quote: SwapQuote = {
      providerId: this.id,
      provider: this.name,
      networkId: ctx.network.id,
      sell: req.sell,
      buy: req.buy,
      sellAmount: gross.toString(),
      buyAmount: out.toString(),
      minBuyAmount: floor.toString(),
      slippageBps: req.slippageBps,
      route: [this.name],
      expiresAt: this.now() + 30_000,
      clipFee: { pct: CLIP_FEE.percent, amount: fee.toString(), receiver: plan.feeReceiver, name: CLIP_FEE.name, receivedBy: CLIP_FEE.receivedBy },
      data: { plan, arrivesOn: there.network.name } satisfies SodaxQuoteData,
    };
    if (req.sell.address && (await this.allowance(ctx, req.sell.address, src.assetManager)) < gross) {
      quote.approval = { spender: src.assetManager, spenderName: this.name, amount: gross.toString() };
    }
    return quote;
  }

  async build(quote: SwapQuote, ctx: ChainContext): Promise<Step[]> {
    const { plan: base, arrivesOn } = quote.data as SodaxQuoteData;
    const from = getAddress(ctx.account.address);
    // The hub wallet and both addresses belong to the account that was quoted.
    if (!isAddressEqual(from, getAddress(base.from))) throw new ClipError("This price expired. Get a new one.", "swap/quote-expired");
    const name = this.opts.walletName;
    const mk = (params: Record<string, string>): DappRequest => ({
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "evm",
      networkId: ctx.network.id,
      method: "eth_sendTransaction",
      params: [params],
    });
    const sold = (amount: string | bigint) => `${formatUnits(amount, quote.sell.decimals)} ${quote.sell.symbol}`;
    const nowSec = () => BigInt(Math.floor(this.now() / 1000));
    // Checked now as well as when it is built: a swap queued after a permission can't show its refusal, so a plan
    // that would be refused stops here, before anything is approved.
    const probe: SodaxSwapPlan = { ...base, intentId: 1n, deadline: nowSec() + SODAX_DEADLINE_S };
    const t = sodaxSwapTx(probe).tx;
    checkSodaxSwap({ to: t.to, data: t.data, value: t.value }, probe, { name, nowSec: nowSec(), receivers: this.receivers });
    const steps: Step[] = [];
    if (quote.approval && quote.sell.address) {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [getAddress(quote.approval.spender), BigInt(quote.approval.amount)] });
      steps.push({
        ...titled(msg("bg.req.allowUseExactly", { spender: this.name, amount: sold(quote.approval.amount) })),
        lines: [{ label: "Limit", value: "Only this amount, for this swap" }],
        request: mk({ from, to: getAddress(quote.sell.address), value: "0x0", data }),
        // The swap's gas is estimated on chain, so the permission has to be in a block first.
        finish: async (r) => {
          if (typeof r === "string" && TX_HASH.test(r)) await this.mined(ctx, r);
          return r;
        },
      });
    }
    let plan: SodaxSwapPlan | undefined;
    const check = (r: DappRequest) =>
      checkSodaxSwap((r.params as { to?: string; data?: string; value?: string }[] | undefined)?.[0] ?? {}, plan!, {
        name,
        nowSec: nowSec(),
        receivers: this.receivers,
      });
    steps.push({
      ...titled(msg("bg.req.swap", { pay: sold(base.gross), get: `~${formatUnits(quote.buyAmount, quote.buy.decimals)} ${quote.buy.symbol}` })),
      // Fixed labels are translated by their text (knownMsg); the fee's has a value, so it carries its Msg.
      lines: [
        labelled(msg("bg.label.walletFee", { name: CLIP_FEE.name }), `${percent(CLIP_FEE.percent, 3)} · ${sold(base.fee)}`),
        { label: "Fee goes to", value: `${CLIP_FEE.receivedBy}, ${base.feeReceiver}` },
        { label: "You get at least", value: `${formatUnits(base.minOut, quote.buy.decimals)} ${quote.buy.symbol}` },
        { label: "Arrives on", value: arrivesOn },
      ],
      // Built when it is its turn: a fresh intent id and a ten-minute deadline, checked before it can be approved.
      request: async () => {
        plan = { ...base, intentId: randomUint256(), deadline: nowSec() + SODAX_DEADLINE_S };
        const { tx } = sodaxSwapTx(plan);
        const request = mk({ from, to: getAddress(tx.to), data: tx.data, value: toHex(tx.value) });
        check(request);
        return request;
      },
      verify: (r) => {
        try {
          check(r);
          return true;
        } catch {
          return false;
        }
      },
      // The check matches the bytes to the plan these lines come from, so the fee stays in view even if the network
      // can't dry-run the swap and the review stays unreadable (blocked unless blind signing is allowed).
      linesProven: true,
      finish: async (r) => {
        if (plan && typeof r === "string" && TX_HASH.test(r)) await this.submit(ctx.fetch, plan, r);
        return r;
      },
    });
    return steps;
  }

  /** The server is set up for this: SODAX configured, trading on, and no fee of its own. */
  private async ready(f: typeof fetch): Promise<void> {
    if (!this.server || this.now() - this.server.at > CACHE_MS) {
      const c = await fetchJson<{ sodaxConfigured?: unknown; tradingEnabled?: unknown; partnerFeeBps?: unknown }>(f, this.url("config"), "SODAX");
      this.server = { at: this.now(), ok: c.sodaxConfigured === true && c.tradingEnabled === true && c.partnerFeeBps === 0 };
    }
    if (!this.server.ok) throw new ClipError(msg("bg.err.swappingUnavailable"), "swap/server-not-ready");
  }

  private async token(f: typeof fetch, spoke: SodaxSpoke, asset: AssetRef): Promise<SodaxToken> {
    if (!this.tokenList || this.now() - this.tokenList.at > CACHE_MS) {
      this.tokenList = { at: this.now(), list: sodaxTokens(await fetchJson<unknown>(f, this.url("sodax/swaps/tokens"), "SODAX")) };
    }
    const want = (asset.address ?? SODAX_NATIVE).toLowerCase();
    const t = this.tokenList.list[spoke.key]?.find((x) => x.address.toLowerCase() === want && x.decimals === asset.decimals);
    if (!t) throw new ClipError(msg("bg.err.swapAssetUnavailable", { symbol: asset.symbol }), "swap/asset-unavailable");
    return t;
  }

  /** Sonic says the hub asset stands for this token on this network; otherwise the list is wrong and nothing is built. */
  private async checkHubAsset(f: typeof fetch, t: SodaxToken, spoke: SodaxSpoke): Promise<void> {
    const key = `${spoke.relayId}|${t.address}|${t.hubAsset}`.toLowerCase();
    if (this.hubAssets.has(key)) return;
    const call = assetInfoCall(t.hubAsset);
    if (!isHubAssetOf(await ethCall(f, SONIC_RPC_URL, call.to, call.data, "SODAX"), spoke, t.address)) {
      throw new ClipError(msg("bg.swap.intentMismatch", { name: this.opts.walletName }), "swap/hub-asset-mismatch");
    }
    this.hubAssets.add(key);
  }

  private async hubWallet(f: typeof fetch, spoke: SodaxSpoke, user: string): Promise<string> {
    const key = `${spoke.relayId}|${user.toLowerCase()}`;
    const hit = this.hubWallets.get(key);
    if (hit) return hit;
    const call = hubWalletCall(spoke, user);
    const result = await ethCall(f, SONIC_RPC_URL, call.to, call.data, "SODAX");
    let wallet: string;
    try {
      wallet = readHubWallet(result);
    } catch (e) {
      throw new ClipError(msg("bg.err.couldntReach", { what: "SODAX" }), "swap/hub-wallet", e);
    }
    this.hubWallets.set(key, wallet);
    return wallet;
  }

  private async allowance(ctx: ChainContext, token: string, spender: string): Promise<bigint> {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [getAddress(ctx.account.address), getAddress(spender)] });
    const result = await ethCall(ctx.fetch, ctx.network.rpcUrls[0]!, getAddress(token), data, ctx.network.name);
    try {
      return decodeFunctionResult({ abi: erc20Abi, functionName: "allowance", data: result });
    } catch {
      return 0n;
    }
  }

  /** Waits for a transaction to be in a block. A failed one stops the flow; a slow one lets the next step's own preview tell. */
  private async mined(ctx: ChainContext, hash: string): Promise<void> {
    const until = this.now() + RECEIPT_WAIT_MS;
    for (;;) {
      const r = await fetchJson<{ result?: { status?: string } | null }>(ctx.fetch, ctx.network.rpcUrls[0]!, ctx.network.name, {
        body: { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] },
      }).catch(() => undefined);
      const status = r?.result?.status;
      if (status === "0x1") return;
      if (status === "0x0") throw new ClipError(msg("bg.err.cat.sendFailed"), "swap/permission-failed");
      if (this.now() >= until) return;
      await this.sleep(RECEIPT_POLL_MS);
    }
  }

  /** Hands the sent swap to SODAX (submit-tx). Kept on the device until it goes through, for at most a day. */
  private async submit(f: typeof fetch, plan: SodaxSwapPlan, txHash: string): Promise<void> {
    const { intent, hubCalls } = sodaxSwapTx(plan);
    const body: SubmitBody = { txHash, srcChainKey: plan.src.key, walletAddress: getAddress(plan.from), intent: wireIntent(intent), relayData: hubCalls };
    await this.pending((list) => [...list, { at: this.now(), body }]);
    for (let i = 0; i < SUBMIT_ATTEMPTS; i++) {
      if (await this.post(f, body)) return this.pending((list) => list.filter((p) => p.body.txHash !== txHash));
      if (i + 1 < SUBMIT_ATTEMPTS) await this.sleep(2_000 * (i + 1));
    }
  }

  /** Retries the submits still on the device (each quote starts it). One run at a time; never throws. */
  retryPending(f: typeof fetch): Promise<void> {
    this.retrying ??= this.retryAll(f)
      .catch(() => undefined)
      .finally(() => {
        this.retrying = undefined;
      });
    return this.retrying;
  }

  private async retryAll(f: typeof fetch): Promise<void> {
    const list = (await this.opts.kv?.get<{ at: number; body: SubmitBody }[]>(PENDING_KEY)) ?? [];
    if (!list.length) return;
    const done = new Set<string>();
    for (const p of list) if (this.now() - p.at > PENDING_MAX_AGE_MS || (await this.post(f, p.body))) done.add(p.body.txHash);
    if (done.size) await this.pending((rest) => rest.filter((p) => !done.has(p.body.txHash)));
  }

  /** Read-modify-write of the kept submits, one at a time (a retry can run while a swap is being handed over). */
  private pending(update: (list: { at: number; body: SubmitBody }[]) => { at: number; body: SubmitBody }[]): Promise<void> {
    const kv = this.opts.kv;
    if (!kv) return Promise.resolve();
    const run = this.writes.then(async () => kv.set(PENDING_KEY, update((await kv.get<{ at: number; body: SubmitBody }[]>(PENDING_KEY)) ?? [])));
    this.writes = run.catch(() => undefined);
    return run;
  }

  private async post(f: typeof fetch, body: SubmitBody): Promise<boolean> {
    try {
      const r = await fetchJson<{ success?: unknown }>(f, this.url("sodax/swaps/submit-tx"), "SODAX", { body, timeoutMs: 15_000 });
      return r.success === true;
    } catch {
      return false;
    }
  }
}
