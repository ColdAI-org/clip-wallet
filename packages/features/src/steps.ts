import type { DappRequest, DecodedRequest, Warning } from "@clip-wallet/core";
import type { FeatureHost } from "./host.js";
import type { QueuedApprovals } from "./views.js";

/**
 * One approval in a feature flow ("Add SAUCE to your account", "Allow 0x to use exactly 100 USDC", "Swap").
 * `request` may be lazy so a step is built only once the previous one went through (fresh blockhash,
 * fresh 180 s Hedera validity window).
 */
export interface Step {
  title: string;
  lines?: { label: string; value: string }[];
  request: DappRequest | (() => Promise<DappRequest>);
  /**
   * Wallet-built transactions that touch a program/contract the chain module can't describe (Jupiter, 0x
   * AllowanceHolder) come back blind. `verify` re-checks the actual bytes (allowed programs / target contract);
   * only then, and only with a successful simulation, does `refine` replace "unreadable" with the plain title.
   */
  verify?(request: DappRequest): boolean;
  /** Runs after approval with the chain module's finalize() result (e.g. Jupiter /execute). */
  finish?(result: unknown): Promise<unknown>;
}

export interface Intent {
  title: string;
  lines: { label: string; value: string }[];
  verify?(request: DappRequest): boolean;
}

/** Wallet-built requests and what they mean. Keyed by object identity, so a dapp can't claim one. */
const intents = new WeakMap<DappRequest, Intent>();

export function registerIntent(request: DappRequest, intent: Intent): void {
  intents.set(request, intent);
}

/**
 * Called by the background right after the chain module's decode() for every queued request. Leaves dapp
 * requests untouched. For wallet-built ones it leads with the plain title; a blind decode is lifted only if
 * `verify` passes AND the module simulated it without failure (so balance changes are real, not claimed).
 */
export function refineDecoded(request: DappRequest, decoded: DecodedRequest): DecodedRequest {
  const intent = intents.get(request);
  if (!intent) return decoded;
  // Audit FEAT-02: the plain title comes from what the wallet asked a provider for; keep what the chain module read
  // from the transaction itself in view whenever it says something different.
  const read = !decoded.blind && decoded.title && decoded.title !== intent.title ? [{ label: "What the transaction does", value: decoded.title }] : [];
  const out: DecodedRequest = { ...decoded, title: intent.title, lines: [...intent.lines, ...read, ...decoded.lines] };
  if (decoded.blind) {
    const simulatedOk = decoded.simulated && !decoded.warnings.some((w) => w.code === "simulation-failed");
    if (intent.verify?.(request) && simulatedOk) {
      out.blind = false;
      out.warnings = decoded.warnings.filter((w) => w.code !== "blind-signing");
      const note: Warning = { level: "info", code: "blind-signing", message: "Clip Wallet built this and checked it with a dry run: the amounts shown are what the network says will move." };
      out.warnings.push(note);
    } else {
      out.title = decoded.title;
      out.lines = decoded.lines;
    }
  }
  return out;
}

/**
 * Queue steps on the normal approval path, one at a time: step N+1 is built and queued only after step N
 * was approved and went through. Returns the first approval id; the rest appear in the approval queue.
 */
export async function queueSteps(host: FeatureHost, steps: Step[], appName: string, onDone?: (results: unknown[]) => void, onFail?: (e: unknown) => void): Promise<QueuedApprovals> {
  if (!steps.length) throw new Error("no steps");
  const results: unknown[] = [];
  const enqueue = async (i: number): Promise<string> => {
    const s = steps[i]!;
    const request = typeof s.request === "function" ? await s.request() : s.request;
    registerIntent(request, { title: s.title, lines: s.lines ?? [], verify: s.verify });
    const { id, result } = await host.enqueue(request, { appName });
    result
      .then(async (r) => {
        results.push(s.finish ? await s.finish(r) : r);
        if (i + 1 < steps.length) await enqueue(i + 1);
        else onDone?.(results);
      })
      .catch((e) => onFail?.(e));
    return id;
  };
  const approvalId = await enqueue(0);
  return { approvalId, steps: steps.map((s) => s.title) };
}
