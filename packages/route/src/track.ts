import { ClipError } from "@clip-wallet/core";

/**
 * Client for the CLPRouter route status API (clprouter services/, `GET /routes/{routeId}`, schema RouteStatus in
 * services/openapi.json). The SDK has no status client, so this is a small typed fetch wrapper.
 */
export type HopStatus = "waiting" | "sent" | "forward-pending" | "forwarded" | "rejected" | "delivered" | "stopped";
export type OutcomeStatus = "PENDING" | "DELIVERED" | "FAILED" | "EXPIRED" | "QUARANTINED";

export interface RouteStatusResponse {
  routeId: string;
  found: boolean;
  origin?: Record<string, unknown> | null;
  plannedHops?: unknown[] | null;
  hops: { index: number; ledger: string; status: HopStatus; events: unknown[] }[];
  receipts: unknown[];
  outcome: { status: OutcomeStatus; settled: boolean };
  quarantine?: unknown[];
  notices?: { contact?: string }[];
  inputs: unknown;
}

const ROUTE_ID = /^(0x[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export class RouteStatusClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { baseUrl: string; fetch?: typeof fetch }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getRoute(routeId: string): Promise<RouteStatusResponse> {
    if (!ROUTE_ID.test(routeId)) throw new ClipError("That route id isn't valid.", "bad-route-id");
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/routes/${routeId}`, { headers: { accept: "application/json" } });
    } catch (e) {
      throw new ClipError("We couldn't reach the route tracker. We'll keep trying.", "status-unreachable", e);
    }
    if (res.status === 429) throw new ClipError("The route tracker is busy. We'll try again shortly.", "status-rate-limited");
    if (res.status !== 200 && res.status !== 404) {
      throw new ClipError("The route tracker had a problem. We'll try again shortly.", "status-error", res.status);
    }
    const body = (await res.json()) as RouteStatusResponse;
    if (typeof body !== "object" || body === null || !body.outcome || !Array.isArray(body.hops)) {
      throw new ClipError("The route tracker sent an answer we don't understand.", "status-bad-response");
    }
    return body;
  }
}

export type RouteStage = "not-seen" | "in-transit" | "delivered" | "settled" | "failed" | "expired" | "held";

export interface RouteProgress {
  routeId: string;
  stage: RouteStage;
  /** Plain words for the activity screen. */
  text: string;
  /** No further updates will come. */
  done: boolean;
  /** Hops delivered so far / total known hops. */
  hopsDone: number;
  hopsTotal: number;
  raw?: RouteStatusResponse;
}

export function describeRoute(s: RouteStatusResponse): RouteProgress {
  const hopsTotal = Math.max(s.hops.length, s.plannedHops?.length ?? 0);
  const hopsDone = s.hops.filter((h) => h.status === "forwarded" || h.status === "delivered").length;
  const base = { routeId: s.routeId, hopsDone, hopsTotal, raw: s };
  if (!s.found) {
    return { ...base, stage: "not-seen", text: "Waiting for the network to pick up your payment.", done: false };
  }
  switch (s.outcome.status) {
    case "DELIVERED":
      return s.outcome.settled
        ? { ...base, stage: "settled", text: "Paid. Delivery is proven and the payment is settled.", done: true }
        : { ...base, stage: "delivered", text: "Delivered. Waiting for the proof to come back and settle the payment.", done: false };
    case "FAILED":
      return {
        ...base,
        stage: "failed",
        text: s.outcome.settled
          ? "This payment didn't go through. Your money has been returned."
          : "This payment didn't go through. Your money comes back once the failure is confirmed.",
        done: s.outcome.settled,
      };
    case "EXPIRED":
      return {
        ...base,
        stage: "expired",
        text: s.outcome.settled
          ? "This payment took too long and was refunded."
          : "This payment took too long. You can take your money back now.",
        done: s.outcome.settled,
      };
    case "QUARANTINED": {
      const contact = s.notices?.find((n) => n.contact)?.contact;
      return {
        ...base,
        stage: "held",
        text: `This payment is on hold for review.${contact ? ` Contact: ${contact}.` : ""}`,
        done: true,
      };
    }
    default:
      return {
        ...base,
        stage: "in-transit",
        text: hopsTotal > 0 ? `On its way (${hopsDone} of ${hopsTotal} steps done).` : "On its way.",
        done: false,
      };
  }
}

export interface TrackOptions {
  client: RouteStatusClient;
  /** Poll interval, ms. Default 5000. */
  intervalMs?: number;
  /** Give up after this long, ms. Default 2 hours. */
  timeoutMs?: number;
  /** Consecutive tracker errors tolerated before giving up. Default 5. */
  maxErrors?: number;
  signal?: AbortSignal;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll the status API and yield each change in plain language until the route settles, is held, or times out.
 */
export async function* trackRoute(routeId: string, opts: TrackOptions): AsyncGenerator<RouteProgress> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const interval = opts.intervalMs ?? 5000;
  const end = now() + (opts.timeoutMs ?? 2 * 60 * 60 * 1000);
  const maxErrors = opts.maxErrors ?? 5;
  let errors = 0;
  let last = "";
  for (;;) {
    if (opts.signal?.aborted) return;
    try {
      const p = describeRoute(await opts.client.getRoute(routeId));
      errors = 0;
      const key = `${p.stage}|${p.hopsDone}|${p.text}`;
      if (key !== last) {
        last = key;
        yield p;
      }
      if (p.done) return;
    } catch (e) {
      if (e instanceof ClipError && e.code === "bad-route-id") throw e;
      if (++errors >= maxErrors) {
        throw new ClipError("We lost track of this payment. Check the activity tab again later.", "status-gave-up", e);
      }
    }
    if (now() >= end) {
      throw new ClipError("This payment is taking longer than expected. Check the activity tab again later.", "status-timeout");
    }
    await sleep(interval);
  }
}
