import type { AssetRef, DappRequest, NetworkId } from "@clip-wallet/core";
import { ClipError, say } from "@clip-wallet/core";
import { decodeEventLog, decodeFunctionResult, encodeEventTopics, encodeFunctionData, getAddress, isAddress, keccak256 } from "viem";
import type { Address, Hex } from "viem";
import { hederaRecipientToEvm } from "./client.js";
import { routerLedgerId } from "./deployments.js";
import { formatDuration, formatUnits } from "./format.js";
import type {
  ConnectorBond,
  ConnectorDirectoryEntry,
  ConnectorQuote,
  ConnectorQuoteRequest,
  CoverAssetConfig,
  OrderStatus,
  SettleOnHederaClient,
  SettleOnHederaOptions,
  SettleOrder,
} from "./phase3.js";
import { SETTLE_ORDER_BOOK_ABI } from "./settle-abi.js";
import {
  addressToBytes32,
  buildDepositRequests,
  bytes32ToAddress,
  isSignature,
  ledgerHash,
  quoteFromJson,
  quoteToJson,
  recoverQuoteSigner,
  settleOrderId,
  type SettleQuote,
} from "./settle-quote.js";
import { JsonRpcReader, MIRROR_LOG_WINDOW_S, MirrorNodeReader, type HederaReader } from "./settle-reader.js";

/**
 * "Settle on Hedera" client (Phase 3). Reads the order book on Hedera, asks Connectors for signed quotes and
 * verifies every one before showing it, and builds the requests the wallet approves (deposit, claim, withdraw).
 * Nothing here signs. Contracts: CLPRouter `src/settle/*.sol`, branch feat/settle-on-hedera.
 */

/** On-chain `SettleOrderBook.Status`. */
export const ON_CHAIN_STATUS = ["NONE", "OPEN", "DELIVERED", "DEFAULTED", "CANCELLED", "REJECTED"] as const;
export type OnChainStatus = (typeof ON_CHAIN_STATUS)[number];

/** Connector `POST /quote` answer (see the Connector quote API in the CLPRouter repo). */
export interface ConnectorQuoteResponse {
  quote: unknown;
  signature: string;
  orderId: string;
  srcLedgerId?: string;
  dstLedgerId?: string;
  fee?: { asset: string; amount: string };
  owedOnDefault: string;
  deliveryP90S: number;
  connector?: { name?: string; address?: string; signer?: string };
  orderBook?: string;
  hederaChainId?: number;
}

export interface OnChainOrder {
  connector: Address;
  status: OnChainStatus;
  deadline: number;
  coverAsset: Address;
  openedAt: number;
  refundTo: Address;
  dstLedger: Hex;
  assetOut: Hex;
  recipient: Hex;
  amountOut: bigint;
  owedOnDefault: bigint;
  reserved: bigint;
}

interface Verified {
  quote: SettleQuote;
  signature: Hex;
  orderId: Hex;
  from: NetworkId;
  depositApp: Address;
  user: Address;
}

interface SessionOrder {
  order: SettleOrder;
  verified: Verified;
}

/** Why a Connector's answer was dropped (collected, never shown raw to the user). */
class Drop extends Error {}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO32 = `0x${"00".repeat(32)}` as const;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ORDER_OPENED_TOPIC = encodeEventTopics({ abi: SETTLE_ORDER_BOOK_ABI, eventName: "OrderOpened" })[0] as Hex;

const UNKNOWN_ASSET = (networkId: NetworkId): AssetRef => ({ key: "unknown", symbol: "", name: "Unknown", decimals: 0, networkId });

function same(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

function show(amount: bigint | string, asset: AssetRef): string {
  return `${formatUnits(amount, asset.decimals)} ${asset.symbol}`.trim();
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function when(unixS: number): string {
  return new Date(unixS * 1000).toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC");
}

/** Best quote first: least to pay for the same delivery, then faster, then more cover. */
export function compareConnectorQuotes(a: ConnectorQuote, b: ConnectorQuote): number {
  const da = BigInt(a.deposit.amount);
  const db = BigInt(b.deposit.amount);
  if (da !== db) return da < db ? -1 : 1;
  if (a.deliveryP90S !== b.deliveryP90S) return a.deliveryP90S - b.deliveryP90S;
  const ca = BigInt(a.bond.amount);
  const cb = BigInt(b.bond.amount);
  return ca === cb ? 0 : ca > cb ? -1 : 1;
}

/** Plain words for an order's status. */
export function describeOrder(o: Pick<SettleOrder, "status" | "quote" | "claimableFrom" | "owedToYou"> & { reserved?: string; owedOnDefault?: string }): string {
  const name = o.quote.name ?? "The Connector";
  const cover = o.quote.bond.amount !== "0" ? show(o.quote.bond.amount, o.quote.bond.asset) : "the cover";
  switch (o.status) {
    case "quoted":
      return "Offer received. Nothing has been paid yet.";
    case "awaiting-deposit":
      return "Waiting for your payment.";
    case "deposited": {
      const short =
        o.reserved !== undefined && o.owedOnDefault !== undefined && BigInt(o.reserved) < BigInt(o.owedOnDefault)
          ? ` Only ${show(o.reserved, o.quote.bond.asset)} of the promised cover is set aside.`
          : "";
      return `Paid. ${name} is delivering.${short}`;
    }
    case "delivered":
    case "settled":
      return "Delivered. This order is complete.";
    case "defaulted":
      return `${name} missed the deadline. You can claim ${cover} from its bond now.`;
    case "paid-from-bond":
      return o.owedToYou
        ? `${name} missed the deadline. ${show(o.owedToYou.amount, o.owedToYou.asset)} from its bond is waiting for you to collect.`
        : `${name} didn't deliver, so you were paid ${cover} from its bond.`;
    case "refunded":
      return "Your payment was returned.";
    case "rejected":
      return "Hedera refused this order: the offer wasn't signed by the Connector's registered key. There is no cover for it.";
  }
}

export class SettleClient implements SettleOnHederaClient {
  readonly network: "testnet" | "mainnet";
  readonly orderBook: Address;
  readonly hederaChainId: number;
  readonly hederaNetworkId: NetworkId;
  private readonly opts: SettleOnHederaOptions;
  private readonly reader: HederaReader;
  private readonly fetchImpl: typeof fetch;
  private readonly verified = new WeakMap<ConnectorQuote, Verified>();
  private readonly sessions = new Map<string, SessionOrder>();
  private proofGrace?: number;

  constructor(opts: SettleOnHederaOptions, reader?: HederaReader) {
    this.opts = opts;
    this.network = opts.network ?? "testnet";
    if (!isAddress(opts.orderBook, { strict: false })) throw new ClipError("The order book address isn't valid.", "settle-bad-config");
    this.orderBook = getAddress(opts.orderBook);
    this.hederaChainId = opts.hederaChainId;
    if (this.network === "mainnet" && opts.hederaChainId !== 295) {
      throw new ClipError("Mainnet orders must settle on Hedera mainnet.", "mainnet-with-testnet-deployments");
    }
    if (this.network === "testnet" && opts.hederaChainId === 295) {
      throw new ClipError("Test builds can't settle on Hedera mainnet.", "testnet-with-mainnet-deployments");
    }
    this.hederaNetworkId = opts.hederaNetworkId ?? `eip155:${opts.hederaChainId}`;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (reader) this.reader = reader;
    else if (opts.mirrorNodeUrl) this.reader = new MirrorNodeReader(opts.mirrorNodeUrl, this.fetchImpl);
    else if (opts.jsonRpcUrl) this.reader = new JsonRpcReader(opts.jsonRpcUrl, this.fetchImpl);
    else throw new ClipError("Settling on Hedera needs a mirror node or JSON-RPC URL.", "settle-bad-config");
  }

  private nowS(): number {
    return Math.floor((this.opts.now ?? Date.now)() / 1000);
  }

  // ── Order-book reads ────────────────────────────────────────────────────

  private async read<const F extends string>(functionName: F, args: readonly unknown[] = []): Promise<any> {
    const data = encodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, functionName, args } as never);
    const raw = await this.reader.call(this.orderBook, data);
    try {
      return decodeFunctionResult({ abi: SETTLE_ORDER_BOOK_ABI, functionName, data: raw } as never);
    } catch (e) {
      throw new ClipError("Hedera sent an answer we don't understand. Try again later.", "hedera-bad-response", e);
    }
  }

  private async grace(): Promise<number> {
    if (this.proofGrace === undefined) this.proofGrace = Number(await this.read("PROOF_GRACE"));
    return this.proofGrace;
  }

  /** `orders(orderId)` from the order book. */
  async readOrder(orderId: string): Promise<OnChainOrder> {
    if (!HEX32.test(orderId)) throw new ClipError("That order id isn't valid.", "bad-order-id");
    const r = (await this.read("orders", [orderId])) as readonly [Address, number, bigint, Address, bigint, Address, Hex, Hex, Hex, bigint, bigint, bigint];
    const status = ON_CHAIN_STATUS[Number(r[1])];
    if (!status) throw new ClipError("Hedera sent an answer we don't understand. Try again later.", "hedera-bad-response");
    return {
      connector: getAddress(r[0]),
      status,
      deadline: Number(r[2]),
      coverAsset: getAddress(r[3]),
      openedAt: Number(r[4]),
      refundTo: getAddress(r[5]),
      dstLedger: r[6],
      assetOut: r[7],
      recipient: r[8],
      amountOut: r[9],
      owedOnDefault: r[10],
      reserved: r[11],
    };
  }

  /** Hedera's clock (latest block), unix seconds. */
  hederaNow(): Promise<number> {
    return this.reader.now();
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private coverAsset(address: string): CoverAssetConfig | undefined {
    return this.opts.coverAssets.find((c) => same(c.address, address));
  }

  private connectorEntry(id: string): ConnectorDirectoryEntry | undefined {
    return this.opts.connectors.find((c) => same(c.id, id));
  }

  private deposit(networkId: NetworkId): Address | undefined {
    const d = this.opts.deposits[networkId];
    return d && isAddress(d, { strict: false }) ? getAddress(d) : undefined;
  }

  /** The 20-byte form the contracts use for an asset (zero = native coin; Hedera 0.0.N tokens as long-zero). */
  private assetAddress(asset: AssetRef): Address {
    if (!asset.address) return ZERO_ADDRESS;
    if (isAddress(asset.address, { strict: false })) return getAddress(asset.address);
    if (/^0\.0\.\d+$/.test(asset.address)) return hederaRecipientToEvm(asset.address);
    throw new ClipError(`${asset.symbol} can't be used for this kind of order yet.`, "settle-unsupported-asset");
  }

  private networkForLedger(hash: Hex): NetworkId | undefined {
    for (const n of Object.keys(this.opts.deposits)) if (same(ledgerHash(routerLedgerId(n)), hash)) return n;
    return undefined;
  }

  // ── Quotes ──────────────────────────────────────────────────────────────

  private async askConnector(c: ConnectorDirectoryEntry, body: unknown): Promise<ConnectorQuoteResponse> {
    const timeoutMs = this.opts.quoteTimeoutMs ?? 8000;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Drop("didn't answer in time"));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        this.fetchImpl(`${c.url.replace(/\/+$/, "")}/quote`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: ctl.signal,
        }),
        timeout,
      ]);
      let json: any;
      try {
        json = await Promise.race([res.json(), timeout]);
      } catch (e) {
        if (e instanceof Drop) throw e;
        throw new Drop(`answered with something that isn't JSON (HTTP ${res.status})`);
      }
      if (res.status !== 200) {
        const code = typeof json?.code === "string" ? json.code : `http-${res.status}`;
        throw new Drop(`can't quote (${code}${typeof json?.error === "string" ? `: ${json.error}` : ""})`);
      }
      if (typeof json !== "object" || json === null) throw new Drop("answered with an empty quote");
      return json as ConnectorQuoteResponse;
    } catch (e) {
      if (e instanceof Drop) throw e;
      throw new Drop("couldn't be reached");
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask every Connector in the directory in parallel and return only quotes that check out against the request,
   * their signature and the order book on Hedera, best first. One Connector failing never fails the call; when none
   * is left, the ClipError's `cause` lists why each was dropped.
   */
  async quoteConnectors(req: ConnectorQuoteRequest): Promise<ConnectorQuote[]> {
    if (!req.from.networkId.startsWith("eip155:")) {
      throw new ClipError("Paying from this kind of network isn't available for this yet.", "settle-evm-only");
    }
    if (req.from.asset.networkId !== req.from.networkId || req.to.asset.networkId !== req.to.networkId) {
      throw new ClipError("That asset isn't on the network it's being paid from.", "settle-asset-network");
    }
    const depositApp = this.deposit(req.from.networkId);
    if (!depositApp) {
      throw new ClipError("Paying from this network isn't available for this yet.", "settle-no-deposit");
    }
    if (!req.user || !isAddress(req.user, { strict: false })) {
      throw new ClipError("We need your account to ask for a quote.", "settle-no-account");
    }
    const refundTo = req.refundTo ?? req.user;
    if (!isAddress(refundTo, { strict: false }) || BigInt(refundTo) === 0n) {
      throw new ClipError("The Hedera account for refunds isn't valid.", "settle-bad-refund");
    }
    let amountOut: bigint;
    try {
      amountOut = BigInt(req.to.amount);
    } catch {
      throw new ClipError("Enter an amount above zero.", "bad-amount");
    }
    if (amountOut <= 0n) throw new ClipError("Enter an amount above zero.", "bad-amount");
    if (this.opts.connectors.length === 0) {
      throw new ClipError("No Connector is set up for this wallet yet.", "settle-no-connectors");
    }
    const assetIn = this.assetAddress(req.from.asset);
    const assetOut = this.assetAddress(req.to.asset);
    const recipient = hederaRecipientToEvm(req.to.recipient);
    const srcLedgerId = routerLedgerId(req.from.networkId);
    const dstLedgerId = routerLedgerId(req.to.networkId);
    const ctx: QuoteContext = {
      req,
      srcLedgerId,
      dstLedgerId,
      srcLedger: ledgerHash(srcLedgerId),
      dstLedger: ledgerHash(dstLedgerId),
      depositApp,
      user: getAddress(req.user),
      refundTo: getAddress(refundTo),
      assetIn,
      assetOut,
      recipient,
      amountOut,
    };
    const body = {
      srcLedger: srcLedgerId,
      assetIn,
      dstLedger: dstLedgerId,
      assetOut,
      amountOut: amountOut.toString(),
      recipient,
      user: ctx.user,
      refundTo: ctx.refundTo,
      ...(req.deadline !== undefined ? { deadline: req.deadline } : {}),
    };

    const hederaNow = this.reader.now();
    hederaNow.catch(() => undefined);
    const reasons: string[] = [];
    const results = await Promise.all(
      this.opts.connectors.map(async (c) => {
        try {
          const answer = await this.askConnector(c, body);
          return await this.verifyAnswer(c, answer, ctx, hederaNow);
        } catch (e) {
          if (e instanceof Drop) reasons.push(`${c.name}: ${e.message}`);
          else if (e instanceof ClipError) reasons.push(`${c.name}: ${e.userMessage}`);
          else reasons.push(`${c.name}: ${(e as Error)?.message ?? "failed"}`);
          return undefined;
        }
      }),
    );
    const quotes = results.filter((q): q is ConnectorQuote => !!q).sort(compareConnectorQuotes);
    if (quotes.length === 0) {
      throw new ClipError(
        "No Connector can take this order right now. Try again in a minute or change the amount.",
        "settle-no-quotes",
        reasons,
      );
    }
    return quotes;
  }

  private async verifyAnswer(
    c: ConnectorDirectoryEntry,
    a: ConnectorQuoteResponse,
    ctx: QuoteContext,
    hederaNowP: Promise<number>,
  ): Promise<ConnectorQuote> {
    let q: SettleQuote;
    try {
      q = quoteFromJson(a.quote);
    } catch (e) {
      throw new Drop(`sent a malformed quote (${(e as Error).message})`);
    }
    if (!isSignature(a.signature)) throw new Drop("sent a quote without a valid signature");
    if (typeof a.orderId !== "string" || !HEX32.test(a.orderId)) throw new Drop("sent a quote without an order id");
    if (typeof a.owedOnDefault !== "string" || !/^\d+$/.test(a.owedOnDefault)) throw new Drop("didn't say what it owes on default");
    const deliveryP90S = Number(a.deliveryP90S);
    if (!Number.isFinite(deliveryP90S) || deliveryP90S < 0) throw new Drop("didn't say how long delivery takes");
    if (a.orderBook !== undefined && !same(a.orderBook, this.orderBook)) throw new Drop("quoted for a different order book");
    if (a.hederaChainId !== undefined && a.hederaChainId !== this.hederaChainId) throw new Drop("quoted for a different Hedera network");

    // The quote must be for this Connector and say exactly what was asked.
    if (!same(q.connector, c.id)) throw new Drop("quote names a different Connector");
    if (a.connector?.address !== undefined && !same(a.connector.address, c.id)) throw new Drop("quote names a different Connector");
    if (a.srcLedgerId !== undefined && a.srcLedgerId !== ctx.srcLedgerId) throw new Drop("quote is for a different source network");
    if (a.dstLedgerId !== undefined && a.dstLedgerId !== ctx.dstLedgerId) throw new Drop("quote is for a different destination network");
    if (!same(q.srcLedger, ctx.srcLedger)) throw new Drop("quote is for a different source network");
    if (!same(q.dstLedger, ctx.dstLedger)) throw new Drop("quote is for a different destination network");
    if (!same(q.depositApp, addressToBytes32(ctx.depositApp))) throw new Drop("quote uses a deposit contract we don't know");
    if (!same(q.user, addressToBytes32(ctx.user))) throw new Drop("quote is for a different payer");
    if (!same(q.refundTo, ctx.refundTo)) throw new Drop("quote refunds a different Hedera account");
    if (!same(q.assetIn, addressToBytes32(ctx.assetIn))) throw new Drop("quote asks for a different asset");
    if (!same(q.assetOut, addressToBytes32(ctx.assetOut))) throw new Drop("quote delivers a different asset");
    if (q.amountOut !== ctx.amountOut) throw new Drop("quote delivers a different amount");
    if (!same(q.recipient, addressToBytes32(ctx.recipient))) throw new Drop("quote delivers to a different recipient");
    if (ctx.req.deadline !== undefined && q.deadline < BigInt(ctx.req.deadline)) throw new Drop("quote's deadline is earlier than asked");
    const payTo = bytes32ToAddress(q.payTo);
    if (!payTo || BigInt(payTo) === 0n) throw new Drop("quote pays to an invalid account");
    if (q.amountIn === 0n) throw new Drop("quote asks for nothing");
    if (!(q.issuedAt <= q.expiry && q.expiry < q.deadline)) throw new Drop("quote's times are inconsistent");
    const now = BigInt(this.nowS());
    const minLife = BigInt(this.opts.minQuoteLifetimeS ?? 60);
    if (q.expiry < now) throw new Drop("quote has expired");
    if (q.expiry < now + minLife) throw new Drop("quote expires too soon");
    if (q.issuedAt > now + 300n) throw new Drop("quote is dated in the future");
    const cover = this.coverAsset(q.coverAsset);
    if (!cover) throw new Drop("quote's cover is in an asset we don't accept");

    // Signature: the order id is the EIP-712 digest; the signer must be the Connector's registered key.
    const orderId = settleOrderId(q, this.hederaChainId, this.orderBook);
    if (!same(orderId, a.orderId)) throw new Drop("quote's order id doesn't match its contents");
    let signer: Address;
    try {
      signer = await recoverQuoteSigner(orderId, a.signature as Hex);
    } catch {
      throw new Drop("quote's signature is invalid");
    }
    if (a.connector?.signer !== undefined && !same(a.connector.signer, signer)) throw new Drop("quote isn't signed by the key the Connector named");

    // The order book on Hedera.
    const owed = BigInt(a.owedOnDefault);
    const [conn, validSigner, isCover, owedFor, free, chSrc, chDst, existing, hNow] = await Promise.all([
      this.read("connectors", [q.connector]) as Promise<readonly [Address, Address, bigint, bigint, number]>,
      this.read("isValidSigner", [q.connector, signer, q.issuedAt, q.expiry]) as Promise<boolean>,
      this.read("isCoverAsset", [q.coverAsset]) as Promise<boolean>,
      this.read("owedFor", [q.coverAmount]) as Promise<bigint>,
      this.read("freeCapacity", [q.connector, q.coverAsset]) as Promise<bigint>,
      this.read("channelOfLedger", [q.srcLedger]) as Promise<Hex>,
      this.read("channelOfLedger", [q.dstLedger]) as Promise<Hex>,
      this.readOrder(orderId),
      hederaNowP,
    ]);
    if (conn[3] === 0n) throw new Drop("isn't registered on Hedera");
    if (!validSigner) throw new Drop("quote isn't signed by the Connector's registered key");
    if (!isCover) throw new Drop("quote's cover asset isn't accepted by the order book");
    if (owedFor !== owed) throw new Drop("promised cover doesn't match the order book");
    if (free < owedFor) throw new Drop("doesn't have enough bond free to cover this order");
    if (existing.status !== "NONE") throw new Drop("quote was already used");
    if (same(chSrc, ZERO32)) throw new Drop("payments on the source network can't be proven to Hedera yet");
    if (same(chDst, ZERO32)) throw new Drop("deliveries on the destination network can't be proven to Hedera yet");
    const [srcSource, dstSource] = await Promise.all([
      this.read("sources", [chSrc]) as Promise<readonly [Hex, Hex, Hex, bigint]>,
      this.read("sources", [chDst]) as Promise<readonly [Hex, Hex, Hex, bigint]>,
    ]);
    if (!same(srcSource[0], q.srcLedger) || srcSource[3] === 0n || srcSource[3] > BigInt(hNow)) {
      throw new Drop("payments on the source network can't be proven to Hedera yet");
    }
    if (!same(dstSource[0], q.dstLedger) || dstSource[3] === 0n || dstSource[3] > BigInt(hNow) || same(dstSource[2], ZERO32)) {
      throw new Drop("deliveries on the destination network can't be proven to Hedera yet");
    }
    if (!same(srcSource[1], keccak256(ctx.depositApp))) throw new Drop("deposit contract isn't the one Hedera listens to");

    return this.toConnectorQuote(c, a, q, ctx, cover, owed, deliveryP90S, orderId);
  }

  private toConnectorQuote(
    c: ConnectorDirectoryEntry,
    a: ConnectorQuoteResponse,
    q: SettleQuote,
    ctx: QuoteContext,
    cover: CoverAssetConfig,
    owed: bigint,
    deliveryP90S: number,
    orderId: Hex,
  ): ConnectorQuote {
    const { req } = ctx;
    let feeAsset = req.from.asset;
    let feeAmount = 0n;
    if (a.fee && typeof a.fee.amount === "string" && /^\d+$/.test(a.fee.amount)) {
      if (same(a.fee.asset, ctx.assetIn)) feeAsset = req.from.asset;
      else if (same(a.fee.asset, ctx.assetOut)) feeAsset = req.to.asset;
      else throw new Drop("states its fee in an asset we can't show");
      feeAmount = BigInt(a.fee.amount);
    }
    const name = c.name || a.connector?.name;
    const deposit = show(q.amountIn, req.from.asset);
    const receive = show(q.amountOut, req.to.asset);
    const coverText = show(owed, cover.asset);
    const deadline = when(Number(q.deadline));
    const warnings: string[] = [];
    if (!same(ctx.refundTo, ctx.user)) {
      warnings.push(`If ${name} doesn't deliver, the cover is paid on Hedera to ${shortAddr(ctx.refundTo)}, not to the paying account.`);
    }
    const out: ConnectorQuote = {
      connectorId: getAddress(c.id),
      name,
      deposit: { asset: req.from.asset, amount: q.amountIn.toString() },
      fee: { asset: feeAsset, amount: feeAmount.toString() },
      bond: { asset: cover.asset, amount: owed.toString() },
      deliveryP90S,
      deadline: Number(q.deadline),
      expiresAt: Number(q.expiry),
      orderId,
      from: req.from.networkId,
      to: req.to.networkId,
      receive: { asset: req.to.asset, amount: q.amountOut.toString(), recipient: ctx.recipient },
      cover: { asset: cover.asset, amount: q.coverAmount.toString(), owedOnDefault: owed.toString() },
      title: say("bg.route.getFor", { receive, deposit }),
      display: {
        deposit,
        fee: show(feeAmount, feeAsset),
        receive,
        cover: coverText,
        time: formatDuration(deliveryP90S),
        deadline,
      },
      steps: [
        `Pay ${deposit} to ${name}`,
        `${name} sends ${receive}, usually in ${formatDuration(deliveryP90S)}`,
        `If it hasn't arrived by ${deadline}, you can claim ${coverText} from ${name}'s bond`,
      ],
      warnings,
      signed: { quote: quoteToJson(q), signature: a.signature },
    };
    this.verified.set(out, {
      quote: q,
      signature: a.signature as Hex,
      orderId,
      from: req.from.networkId,
      depositApp: ctx.depositApp,
      user: ctx.user,
    });
    return out;
  }

  // ── Orders ──────────────────────────────────────────────────────────────

  /**
   * The deposit request(s) for a quote this client verified: `approve` (ERC-20 only, exact amount) then
   * `SettleDeposit.deposit(quote, signature)`. Refuses quotes it didn't verify and quotes about to expire.
   */
  async createOrder(quote: ConnectorQuote, account: string): Promise<{ order: SettleOrder; requests: DappRequest[] }> {
    const v = this.verified.get(quote);
    if (!v) throw new ClipError("This offer hasn't been checked. Get a new quote and try again.", "stale-quote");
    if (!isAddress(account, { strict: false }) || !same(account, v.user)) {
      throw new ClipError("This offer was made for a different account. Get a new quote from this one.", "wrong-account");
    }
    const now = this.nowS();
    if (BigInt(now + (this.opts.depositMarginS ?? 30)) > v.quote.expiry) {
      throw new ClipError("This offer has expired. Get a new quote and try again.", "quote-expired");
    }
    const requests = buildDepositRequests({
      quote: v.quote,
      signature: v.signature,
      account,
      networkId: v.from,
      depositApp: v.depositApp,
    });
    const order: SettleOrder = {
      id: v.orderId,
      quote,
      account: getAddress(account),
      status: "awaiting-deposit",
      createdAt: now,
      refundTo: v.quote.refundTo,
      owedOnDefault: quote.bond.amount,
    };
    order.statusText = describeOrder(order);
    this.sessions.set(v.orderId.toLowerCase(), { order, verified: v });
    return { order, requests };
  }

  /** Record the deposit transaction once the wallet sent it (the order is "deposited" until Hedera sees it). */
  markDeposited(orderId: string, txHash: string): SettleOrder | undefined {
    const s = this.sessions.get(orderId.toLowerCase());
    if (!s) return undefined;
    s.order.depositTx = txHash;
    if (s.order.status === "awaiting-deposit") s.order.status = "deposited";
    s.order.statusText = describeOrder(s.order);
    return s.order;
  }

  private synthesizeQuote(o: OnChainOrder, srcNetwork?: NetworkId): ConnectorQuote {
    const cover = this.coverAsset(o.coverAsset);
    const coverAsset = cover?.asset ?? UNKNOWN_ASSET(this.hederaNetworkId);
    const unknown = UNKNOWN_ASSET(srcNetwork ?? "unknown");
    return {
      connectorId: o.connector,
      name: this.connectorEntry(o.connector)?.name,
      deposit: { asset: unknown, amount: "0" },
      fee: { asset: unknown, amount: "0" },
      bond: { asset: coverAsset, amount: o.owedOnDefault.toString() },
      deliveryP90S: 0,
      deadline: o.deadline,
      expiresAt: 0,
      from: srcNetwork,
    };
  }

  private async loadOrder(orderId: string, hint?: { srcNetwork?: NetworkId }): Promise<SettleOrder> {
    const key = orderId.toLowerCase();
    const [o, hNow, grace] = await Promise.all([this.readOrder(orderId), this.reader.now(), this.grace()]);
    const s = this.sessions.get(key);
    if (o.status === "NONE" && !s) {
      throw new ClipError("We can't find this order on Hedera yet. If you just paid, check again in a few minutes.", "order-not-found");
    }
    const quote = s?.order.quote ?? this.synthesizeQuote(o, hint?.srcNetwork);
    const base: SettleOrder = s
      ? { ...s.order }
      : {
          id: key,
          quote,
          account: o.refundTo,
          status: "deposited",
          createdAt: o.openedAt,
          onChainOnly: true,
        };
    let status: OrderStatus;
    switch (o.status) {
      case "NONE":
        status = s?.order.depositTx ? "deposited" : "awaiting-deposit";
        break;
      case "OPEN":
        status = hNow > o.deadline + grace ? "defaulted" : "deposited";
        break;
      case "DELIVERED":
        status = "settled";
        break;
      case "DEFAULTED":
      case "CANCELLED":
        status = "paid-from-bond";
        break;
      case "REJECTED":
        status = "rejected";
        break;
    }
    const order: SettleOrder = { ...base, status };
    if (o.status !== "NONE") {
      order.refundTo = o.refundTo;
      order.owedOnDefault = o.owedOnDefault.toString();
      order.reserved = o.status === "REJECTED" ? "0" : o.reserved.toString();
      if (o.status === "OPEN") order.claimableFrom = o.deadline + grace + 1;
      if (o.status === "DEFAULTED" || o.status === "CANCELLED") {
        const owed = (await this.read("owed", [o.refundTo, o.coverAsset])) as bigint;
        const cover = this.coverAsset(o.coverAsset);
        if (owed > 0n) order.owedToYou = { asset: cover?.asset ?? UNKNOWN_ASSET(this.hederaNetworkId), amount: owed.toString() };
      }
    }
    order.statusText = describeOrder(order);
    if (s) s.order = { ...s.order, status: order.status, statusText: order.statusText };
    return order;
  }

  /** The order's state on Hedera, in plain words. */
  getOrder(orderId: string): Promise<SettleOrder> {
    return this.loadOrder(orderId);
  }

  /**
   * Orders whose cover goes to `account` on Hedera: `OrderOpened` logs filtered by the indexed `refundTo`
   * (mirror node, last `logLookbackDays` in 7-day windows), plus orders created in this session for it.
   */
  async listOrders(account: string): Promise<SettleOrder[]> {
    if (!isAddress(account, { strict: false })) throw new ClipError("That account isn't valid.", "bad-address");
    const acct = getAddress(account);
    const found = new Map<string, { srcNetwork?: NetworkId }>();
    if (this.reader.logs) {
      const end = (await this.reader.now()) + 1;
      const days = this.opts.logLookbackDays ?? 28;
      const windows = Math.max(1, Math.ceil((days * 86400) / MIRROR_LOG_WINDOW_S));
      const topic2 = addressToBytes32(acct);
      const pages = await Promise.all(
        Array.from({ length: windows }, (_, i) =>
          this.reader.logs!({
            address: this.orderBook,
            topic0: ORDER_OPENED_TOPIC,
            topic2,
            from: end - (i + 1) * MIRROR_LOG_WINDOW_S,
            to: end - i * MIRROR_LOG_WINDOW_S,
          }),
        ),
      );
      for (const log of pages.flat()) {
        if (!same(log.address, this.orderBook)) continue;
        try {
          const ev = decodeEventLog({ abi: SETTLE_ORDER_BOOK_ABI, eventName: "OrderOpened", topics: log.topics as [Hex, ...Hex[]], data: log.data });
          if (!same(ev.args.refundTo, acct)) continue;
          found.set(ev.args.orderId.toLowerCase(), { srcNetwork: this.networkForLedger(ev.args.srcLedger) });
        } catch {
          // Not an OrderOpened log; ignore.
        }
      }
    }
    for (const [id, s] of this.sessions) {
      if (same(s.order.account, acct) || same(s.verified.quote.refundTo, acct)) if (!found.has(id)) found.set(id, {});
    }
    const orders = await Promise.all([...found].map(([id, hint]) => this.loadOrder(id, hint)));
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Bonds ───────────────────────────────────────────────────────────────

  /** Every configured cover asset's bond of a Connector. */
  async getBonds(connectorId: string): Promise<ConnectorBond[]> {
    if (!isAddress(connectorId, { strict: false })) throw new ClipError("That Connector id isn't valid.", "bad-connector");
    const id = getAddress(connectorId);
    const conn = (await this.read("connectors", [id])) as readonly [Address, Address, bigint, bigint, number];
    if (conn[3] === 0n) throw new ClipError("This Connector isn't registered on Hedera.", "connector-unknown");
    return Promise.all(
      this.opts.coverAssets.map(async (c) => {
        const b = (await this.read("bonds", [id, c.address])) as readonly [bigint, bigint, bigint, bigint];
        const free = b[0] - b[1] - b[2];
        return {
          connectorId: id,
          asset: c.asset,
          amount: b[0].toString(),
          locked: b[1].toString(),
          slashed: "0",
          pendingWithdrawal: b[2].toString(),
          withdrawReadyAt: Number(b[3]),
          free: (free < 0n ? 0n : free).toString(),
          shortfalls: Number(conn[4]),
        };
      }),
    );
  }

  /** A Connector's bond: the given cover asset, else the first configured cover asset it has posted. */
  async getBond(connectorId: string, asset?: string): Promise<ConnectorBond> {
    const bonds = await this.getBonds(connectorId);
    if (asset) {
      const i = this.opts.coverAssets.findIndex((c) => same(c.address, asset));
      if (i < 0) throw new ClipError("We don't accept that asset as cover.", "settle-unknown-cover");
      return bonds[i]!;
    }
    const posted = bonds.find((b) => BigInt(b.amount) > 0n);
    const first = posted ?? bonds[0];
    if (!first) throw new ClipError("No cover assets are set up for this wallet.", "settle-bad-config");
    return first;
  }

  // ── Claims ──────────────────────────────────────────────────────────────

  private hederaRequest(from: string, data: Hex): DappRequest {
    return {
      id: `settle-${globalThis.crypto.randomUUID()}`,
      origin: "clip-wallet://route",
      via: "injected",
      family: "evm",
      networkId: this.hederaNetworkId,
      method: "eth_sendTransaction",
      params: [{ from: getAddress(from), to: this.orderBook, data, value: "0x0" }],
    };
  }

  /**
   * After the deadline plus the order book's proof grace (Hedera's clock) with no proven delivery: the
   * `claimDefault(orderId)` request on Hedera. The payout always goes to the order's `refundTo`; `account` only
   * pays the network fee (default: `refundTo`).
   */
  async claimFromBond(orderId: string, account?: string): Promise<DappRequest[]> {
    const [o, hNow, grace] = await Promise.all([this.readOrder(orderId), this.reader.now(), this.grace()]);
    switch (o.status) {
      case "NONE":
        throw new ClipError("This order isn't open on Hedera yet, so there's nothing to claim.", "claim-not-open");
      case "DELIVERED":
        throw new ClipError("This order was delivered, so there's nothing to claim.", "claim-delivered");
      case "DEFAULTED":
      case "CANCELLED":
        throw new ClipError("This order has already been paid from the bond.", "claim-already-paid");
      case "REJECTED":
        throw new ClipError("Hedera refused this order, so no bond stands behind it.", "claim-rejected");
      case "OPEN":
        break;
    }
    const from = o.deadline + grace + 1;
    if (hNow < from) {
      throw new ClipError(`The Connector still has time to deliver. You can claim from ${when(from)}.`, "claim-too-early", from);
    }
    if (account !== undefined && !isAddress(account, { strict: false })) throw new ClipError("That account isn't valid.", "bad-address");
    const data = encodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, functionName: "claimDefault", args: [orderId as Hex] });
    return [this.hederaRequest(account ?? o.refundTo, data)];
  }

  /** Payouts the order book could not push to `account` (it credits them instead): the `withdrawOwed` requests. */
  async withdrawOwed(account: string): Promise<{ requests: DappRequest[]; amounts: { asset: AssetRef; amount: string }[] }> {
    if (!isAddress(account, { strict: false })) throw new ClipError("That account isn't valid.", "bad-address");
    const owed = await Promise.all(
      this.opts.coverAssets.map(async (c) => ({ c, amount: (await this.read("owed", [getAddress(account), c.address])) as bigint })),
    );
    const due = owed.filter((o) => o.amount > 0n);
    return {
      requests: due.map((o) =>
        this.hederaRequest(account, encodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, functionName: "withdrawOwed", args: [o.c.address] })),
      ),
      amounts: due.map((o) => ({ asset: o.c.asset, amount: o.amount.toString() })),
    };
  }
}

interface QuoteContext {
  req: ConnectorQuoteRequest;
  srcLedgerId: string;
  dstLedgerId: string;
  srcLedger: Hex;
  dstLedger: Hex;
  depositApp: Address;
  user: Address;
  refundTo: Address;
  assetIn: Address;
  assetOut: Address;
  recipient: Address;
  amountOut: bigint;
}
