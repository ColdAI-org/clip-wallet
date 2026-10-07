import type { AssetRef, DappRequest, NetworkId } from "@clip-wallet/core";
import { ClipError, say } from "@clip-wallet/core";
import { encodeAbiParameters, encodeFunctionData, getAddress, isAddress, numberToHex, parseEventLogs } from "viem";
import type { Hex, Log } from "viem";
import { CLPR_ROUTER_ABI } from "./abi.js";
import type { FilterLabel, Ledger, PlanRequest, RouteGraphData, RouteQuote } from "./clprouter.js";
import { normalizeLedgerId, plan } from "./clprouter.js";
import { kgToUg } from "./vendor/clprouter-sdk/filters.js";
import type { RouterDeployment } from "./deployments.js";
import {
  HEDERA_TESTNET_NETWORK_ID,
  SEPOLIA_NETWORK_ID,
  TESTNET_DEPLOYMENTS,
  findDeployment,
  isHederaNetwork,
  networkIdForRouterLedger,
  routerLedgerId,
} from "./deployments.js";
import { TRUST_TEXT, formatCarbon, formatDuration, formatUnits, usdToUnits } from "./format.js";
import { testnetGraph } from "./graph.js";
import { isTestVerifier, testVerifierEdges } from "./safety.js";
import { RouteStatusClient, trackRoute, type RouteProgress, type TrackOptions } from "./track.js";
import type {
  PayOnHederaInput,
  PayOnHederaPlan,
  Quote,
  QuoteRequest,
  RouteClientOptions,
  RouteFilters,
} from "./types.js";

const ZERO32 = `0x${"00".repeat(32)}` as const;
const UINT64_MAX = (1n << 64n) - 1n;
const MODE_NUM = { balanced: 0, cheapest: 1, fastest: 2, reliable: 3, greenest: 4 } as const;
const FILTER_BIT: Record<FilterLabel, number> = { ISO20022: 1, MICA: 2, ENERGY: 4 };
const PAYLOAD_ASSET = 2;

export const DEFAULT_NATIVE_ASSETS: Record<NetworkId, AssetRef> = {
  [SEPOLIA_NETWORK_ID]: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: SEPOLIA_NETWORK_ID },
  [HEDERA_TESTNET_NETWORK_ID]: { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: HEDERA_TESTNET_NETWORK_ID },
};

/** Internal: what planPayOnHedera needs from a quote beyond the public fields. */
interface QuoteInternals {
  pays: { asset: AssetRef; amount: string };
  filters: FilterLabel[];
  energyCapKgPerTx?: number;
  /** Per hop, in base units of the source coin. */
  hopFees: string[];
}
const internals = new WeakMap<Quote, QuoteInternals>();

function shortName(l: Ledger | undefined, fallback: string): string {
  if (!l) return fallback;
  // "Name (detail)" -> "Name": the first "(" when the name ends in ")" (a scan, not a regex: linear on any input).
  const t = l.name.trimEnd();
  const open = t.endsWith(")") ? t.indexOf("(") : -1;
  return open >= 0 ? t.slice(0, open).trimEnd() : l.name;
}

/** 0.0.N (shard 0, realm 0) -> long-zero EVM address; EVM addresses pass through checksummed. */
export function hederaRecipientToEvm(recipient: string): `0x${string}` {
  if (isAddress(recipient, { strict: false })) return getAddress(recipient);
  const m = /^0\.0\.(\d+)$/.exec(recipient.trim());
  if (!m) {
    throw new ClipError(
      "That doesn't look like a Hedera account. Use an account id like 0.0.12345 or a 0x address.",
      "bad-recipient",
    );
  }
  const num = BigInt(m[1]!);
  if (num >= 1n << 64n) throw new ClipError("That Hedera account number is too large.", "bad-recipient");
  return getAddress(`0x${num.toString(16).padStart(40, "0")}`);
}

function filtersForPlanner(f: RouteFilters | undefined): PlanRequest["filters"] {
  if (!f) return undefined;
  return { iso20022: f.iso20022, mica: f.mica, energy: f.energy };
}

export class RouteClient {
  readonly network: "testnet" | "mainnet";
  readonly deployments: readonly RouterDeployment[];
  private readonly opts: RouteClientOptions;
  private graphCache?: RouteGraphData;

  constructor(opts: RouteClientOptions = {}) {
    this.opts = opts;
    this.network = opts.network ?? "testnet";
    this.deployments = opts.deployments ?? TESTNET_DEPLOYMENTS;
    if (this.network === "mainnet" && this.deployments.some((d) => d.testnet)) {
      throw new ClipError("Mainnet routing can't use test network deployments.", "mainnet-with-testnet-deployments");
    }
  }

  async graph(): Promise<RouteGraphData> {
    if (this.graphCache) return this.graphCache;
    const g = this.opts.graph;
    this.graphCache = typeof g === "function" ? await g() : (g ?? testnetGraph());
    return this.graphCache;
  }

  private nativeAsset(networkId: NetworkId): AssetRef {
    const a = this.opts.nativeAssets?.[networkId] ?? DEFAULT_NATIVE_ASSETS[networkId];
    if (!a) throw new ClipError("We don't know this network's coin yet, so we can't price a route from it.", "unknown-native-asset");
    return a;
  }

  private priceUsd(asset: AssetRef, graph: RouteGraphData): number | undefined {
    const p = this.opts.prices?.[asset.key];
    if (p !== undefined) return p;
    if (asset.address) return undefined;
    const ledger = graph.ledgers.find((l) => normalizeLedgerId(l.id) === routerLedgerId(asset.networkId));
    return ledger?.nativeUsd;
  }

  /**
   * Plain-language quotes for getting `amount` of `asset` to `to`. Phase 1 supports paying on Hedera only, from the
   * source network's own coin. Sorted with the mode's pick first.
   */
  async quote(req: QuoteRequest): Promise<Quote[]> {
    if (!isHederaNetwork(req.to)) {
      throw new ClipError("Paying on this network from another one isn't available yet. Today we can pay on Hedera.", "phase1-hedera-only");
    }
    const graph = await this.graph();
    const dest = routerLedgerId(req.to);
    const destLedger = graph.ledgers.find((l) => normalizeLedgerId(l.id) === dest);
    if (!destLedger) throw new ClipError("We can't route to this network yet.", "no-route-destination");

    const amount = BigInt(req.amount);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "bad-amount");
    const assetUsd = this.priceUsd(req.asset, graph);
    if (assetUsd === undefined) {
      throw new ClipError(`We can't price ${req.asset.symbol} yet, so we can't work out what to send.`, "no-price");
    }
    const amountUsd = (Number(amount) / 10 ** req.asset.decimals) * assetUsd;
    const mode = req.mode ?? "balanced";

    // On mainnet, edges with test or stub verifiers are not even considered.
    const planningGraph: RouteGraphData =
      this.network === "mainnet"
        ? { ...graph, edges: graph.edges.map((e) => (isTestVerifier(e) ? { ...e, disabled: true } : e)) }
        : graph;

    let sources = req.from ?? this.deployments.map((d) => d.networkId).filter((n) => n !== req.to);
    if (req.portfolio) {
      sources = sources.filter((s) =>
        req.portfolio!.some((b) => b.asset.networkId === s && !b.asset.address && BigInt(b.amount) > 0n),
      );
    }

    const reasons: string[] = [];
    const quotes: Quote[] = [];
    for (const source of sources) {
      if (!source.startsWith("eip155:")) {
        reasons.push(`${source}: paying from this kind of network isn't available yet`);
        continue;
      }
      const origin = routerLedgerId(source);
      const originLedger = graph.ledgers.find((l) => normalizeLedgerId(l.id) === origin);
      if (!originLedger) {
        reasons.push(`${source}: no route data`);
        continue;
      }
      const r = plan(planningGraph, {
        origin,
        destination: dest,
        mode,
        filters: filtersForPlanner(req.filters),
        constraints: {
          maxHops: req.filters?.maxHops,
          deadlineS: req.filters?.deadlineS,
          trustFloor: req.filters?.trustFloor,
          excludedJurisdictions: req.filters?.excludedJurisdictions,
          allowProjected: this.opts.allowNotYetOpen ?? false,
        },
        now: req.now,
      });
      if (!r.ok) {
        reasons.push(...r.details.map((d) => `${source}: ${d}`));
        if (r.details.length === 0) reasons.push(`${source}: ${r.reason}`);
        continue;
      }
      const native = this.nativeAsset(source);
      const nativeUsd = this.priceUsd(native, graph) ?? originLedger.nativeUsd;
      const routes = [r.route, ...r.pareto.filter((p) => p.key !== r.route.key)];
      for (const route of routes) {
        const testEdges = testVerifierEdges(route, graph);
        if (this.network === "mainnet" && testEdges.length > 0) {
          reasons.push(`${source}: route relies on a test verifier (${testEdges.join(", ")})`);
          continue;
        }
        quotes.push(
          this.toQuote({
            route,
            graph,
            source,
            to: req.to,
            mode,
            native,
            nativeUsd,
            amountUsd,
            pays: { asset: req.asset, amount: amount.toString() },
            filters: r.filters,
            energyCapKgPerTx: r.energyCapKgPerTx,
            usesTestVerifier: testEdges.length > 0,
            planWarnings: r.warnings,
          }),
        );
      }
    }
    if (quotes.length === 0) {
      throw new ClipError(
        `We couldn't find a way to pay ${req.asset.symbol} on ${shortName(destLedger, req.to)} from your other balances right now.`,
        "no-route",
        reasons,
      );
    }
    // Per source: the mode's pick first, then its Pareto alternatives.
    return quotes;
  }

  private toQuote(p: {
    route: RouteQuote;
    graph: RouteGraphData;
    source: NetworkId;
    to: NetworkId;
    mode: Quote["mode"];
    native: AssetRef;
    nativeUsd: number;
    amountUsd: number;
    pays: { asset: AssetRef; amount: string };
    filters: FilterLabel[];
    energyCapKgPerTx?: number;
    usesTestVerifier: boolean;
    planWarnings: string[];
  }): Quote {
    const { route, native, graph } = p;
    const ledgerOf = (id: string) => graph.ledgers.find((l) => normalizeLedgerId(l.id) === id);
    const hopFees = route.hops.map((h) => usdToUnits(h.cost.totalUsd, p.nativeUsd, native.decimals));
    const fee = hopFees.reduce((a, b) => a + b, 0n);
    const escrow = usdToUnits(p.amountUsd, p.nativeUsd, native.decimals);
    const youPay = escrow + fee;
    const show = (v: bigint) => `${formatUnits(v, native.decimals)} ${native.symbol}`;
    const srcName = shortName(ledgerOf(route.ledgers[0]!), p.source);
    const dstName = shortName(ledgerOf(route.ledgers[route.ledgers.length - 1]!), p.to);
    const paysDisplay = `${formatUnits(p.pays.amount, p.pays.asset.decimals)} ${p.pays.asset.symbol}`;

    const steps = [
      { text: `Send ${show(youPay)} from ${srcName} (includes a ${show(fee)} route fee)`, networkId: p.source },
      ...route.hops.map((h) => ({
        text: `Wait ${formatDuration(h.timeP90S)} while ${shortName(ledgerOf(h.from), h.from)} finalises it and ${shortName(ledgerOf(h.to), h.to)} checks the proof`,
        networkId: networkIdForRouterLedger(h.to),
      })),
      {
        text: `The app on ${dstName} is told you paid ${paysDisplay}; ${show(escrow)} is released to the seller once that is proven`,
        networkId: p.to,
      },
    ];

    const warnings: string[] = [];
    if (p.usesTestVerifier) {
      warnings.push(
        "Test network only: part of this route uses a test verifier, so the payment can't be confirmed back to you and settles only by refund after the deadline.",
      );
    }
    const notOpen = route.hops.filter((h) => graph.edges.some((e) => e.channelId === h.channelId && e.from === h.from && e.to === h.to && e.status === "projected"));
    if (notOpen.length > 0) {
      warnings.push("This route isn't open yet. A payment sent now waits, then can be refunded after the deadline.");
    }
    if (route.synthetic.length > 0) warnings.push("Fees and times are estimates, not measurements yet.");
    if (route.totals.successProbability < 0.9) warnings.push("This route has failed before. Your money comes back if it fails.");
    warnings.push(...p.planWarnings);

    const q: Quote = {
      id: route.key,
      from: p.source,
      to: p.to,
      mode: p.mode,
      title: say("bg.route.payOnWith", { amount: paysDisplay, network: dstName, symbol: native.symbol, source: srcName }),
      youPay: { asset: native, amount: youPay.toString(), display: show(youPay) },
      escrow: { asset: native, amount: escrow.toString(), display: show(escrow) },
      fee: { asset: native, amount: fee.toString(), display: show(fee), usd: route.totals.costUsd },
      time: { p90Seconds: route.totals.timeP90S, display: formatDuration(route.totals.timeP90S) },
      carbon: { kgCO2e: route.totals.kgCO2e, display: formatCarbon(route.totals.kgCO2e) },
      trust: { tier: route.effectiveTrustTier, display: TRUST_TEXT[route.effectiveTrustTier] },
      successProbability: route.totals.successProbability,
      steps,
      warnings,
      usesTestVerifier: p.usesTestVerifier,
      estimated: route.synthetic.length > 0,
      route,
    };
    internals.set(q, {
      pays: p.pays,
      filters: p.filters,
      energyCapKgPerTx: p.energyCapKgPerTx,
      hopFees: hopFees.map(String),
    });
    return q;
  }

  /**
   * The transaction the wallet must approve to pay on Hedera from an EVM network: `Router.send` on the source
   * network, with msg.value = escrow + route fees. It goes through the normal decode/approve path like any dapp
   * request; nothing is signed here.
   */
  planPayOnHedera(input: PayOnHederaInput): PayOnHederaPlan {
    const q = input.quote;
    const inner = internals.get(q);
    if (!inner) throw new ClipError("This quote has expired. Get a new quote and try again.", "stale-quote");
    if (!isHederaNetwork(q.to)) throw new ClipError("This plan can only pay on Hedera.", "phase1-hedera-only");
    if (this.network === "mainnet" && q.usesTestVerifier) {
      throw new ClipError("This route relies on a test verifier and can't be used on mainnet.", "test-verifier");
    }
    if (!q.from.startsWith("eip155:")) {
      throw new ClipError("Paying from this kind of network isn't available yet.", "phase1-evm-only");
    }
    for (const [label, v] of [["your account", input.from.address], ["the seller's address", input.payee], ["the Hedera app", input.destinationApp]] as const) {
      if (!isAddress(v, { strict: false })) throw new ClipError(`The address for ${label} isn't valid.`, "bad-address");
    }
    if (BigInt(input.payee) === 0n) throw new ClipError("The seller's address can't be empty.", "bad-address");

    const ledgers = q.route.ledgers.map((l) => normalizeLedgerId(l));
    const deps = ledgers.map((l) => {
      const d = findDeployment(this.deployments, l);
      if (!d) throw new ClipError("Part of this route has no CLPRouter yet.", "no-router", l);
      if (this.network === "mainnet" && d.testnet) throw new ClipError("This route uses a test network.", "testnet-router");
      return d;
    });
    const hopFees = inner.hopFees.map((f) => BigInt(f));
    const feeBudget = hopFees.reduce((a, b) => a + b, 0n);
    if (feeBudget > UINT64_MAX) throw new ClipError("The route fee is too large for this route.", "fee-too-large");
    const escrow = BigInt(q.escrow.amount);
    const value = escrow + feeBudget;

    const hops = ledgers.map((ledgerId, i) => {
      const hop = q.route.hops[i];
      return {
        ledgerId,
        router: deps[i]!.router as Hex,
        channelId: (hop?.channelId ?? ZERO32) as Hex,
        connectorId: (hop?.connectorId ?? ZERO32) as Hex,
        fee: hop ? hopFees[i]! : 0n,
        feePayee: "0x" as Hex,
      };
    });
    const destLedger = ledgers[ledgers.length - 1]!;
    const recipient = `${destLedger}:${hederaRecipientToEvm(input.recipient)}`;
    const payload =
      input.payload ??
      encodeAbiParameters(
        [{ type: "string" }, { type: "string" }, { type: "uint256" }],
        [recipient, inner.pays.asset.key, BigInt(inner.pays.amount)],
      );
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
    const deadline = now + (input.deadlineS ?? Math.max(600, Math.ceil(q.time.p90Seconds * 2)));
    const filterBits = inner.filters.reduce((b, f) => b | FILTER_BIT[f], 0);

    const sendRequest = {
      destination: { ledgerId: destLedger, application: getAddress(input.destinationApp) as Hex },
      recipient,
      hops,
      mode: MODE_NUM[q.mode],
      constraints: {
        filters: filterBits,
        deadline: BigInt(deadline),
        maxFee: feeBudget,
        remainingFeeBudget: 0n,
        trustFloor: 0,
        maxHops: Math.max(3, q.route.hops.length),
        loose: false,
        energyCap: inner.energyCapKgPerTx !== undefined ? kgToUg(inner.energyCapKgPerTx, "up") : 0n,
      },
      payloadType: PAYLOAD_ASSET,
      payload,
      receiptPath: [],
      originSignature: "0x" as Hex,
      isoUetr: `0x${"00".repeat(16)}` as Hex,
      escrow,
      payee: getAddress(input.payee),
    };
    const data = encodeFunctionData({ abi: CLPR_ROUTER_ABI, functionName: "send", args: [sendRequest] });
    const router = deps[0]!.router;
    const request: DappRequest = {
      id: `route-${globalThis.crypto.randomUUID()}`,
      origin: "clip-wallet://route",
      via: "injected",
      family: "evm",
      networkId: q.from,
      method: "eth_sendTransaction",
      params: [{ from: getAddress(input.from.address), to: router, data, value: numberToHex(value) }],
    };
    return {
      requests: [request],
      summary: q.title,
      router,
      value: value.toString(),
      escrow: escrow.toString(),
      feeBudget: feeBudget.toString(),
      deadline,
    };
  }

  /** Route ids from a mined `Router.send` transaction's logs. */
  routeIdsFromLogs(logs: Log[], router?: string): Hex[] {
    const parsed = parseEventLogs({ abi: CLPR_ROUTER_ABI, logs, eventName: "RouteSent" });
    return parsed
      .filter((l) => !router || l.address.toLowerCase() === router.toLowerCase())
      .map((l) => l.args.routeId);
  }

  /** Follow a route until it settles, yielding plain-language progress. */
  trackRoute(routeId: string, opts: Omit<TrackOptions, "client"> & { client?: RouteStatusClient } = {}): AsyncGenerator<RouteProgress> {
    const client =
      opts.client ??
      (this.opts.statusApiUrl
        ? new RouteStatusClient({ baseUrl: this.opts.statusApiUrl, fetch: this.opts.fetch })
        : undefined);
    if (!client) throw new ClipError("Route tracking isn't set up for this wallet yet.", "no-status-api");
    return trackRoute(routeId, { ...opts, client });
  }
}

export function createRouteClient(opts: RouteClientOptions = {}): RouteClient {
  return new RouteClient(opts);
}
