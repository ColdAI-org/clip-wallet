/**
 * EIP-5792 `wallet_sendCalls`, host side. Shared by the extension's background (packages/extension-kit
 * WalletService) and, when wired, the mobile engine, so both run the same steps:
 *
 *   1. Split: the validated batch (1Mask normalized it) becomes one `eth_sendTransaction` request per call, each
 *      carrying `batch` (core DappRequest.batch) so the chain module previews it on top of the earlier calls.
 *   2. Decode: the host runs EVERY call through its normal decode pipeline (module decode, scam lists, look-alike
 *      checks, plugins, sanitising). `mergeBatchDecoded` folds them into the one approval the user sees: one step
 *      per call, summed balance changes and fees, every warning, blind if any call is blind.
 *   3. Plan: the host's route planner sees the merged request, so a batch that needs more than the balance on its
 *      network gets the same funding (settle on Hedera = ERC-7682 auxiliary funds) as a single payment, inside the
 *      same approval. `batchPlan` puts the calls back as separate steps.
 *   4. Run (`CallsBatchRun`): after Approve, call 1 is prepared, signed and sent; the app gets the batch id at once
 *      (EIP-5792: never wait for calls to be final). Each later call is prepared only once the one before it is
 *      mined (its gas and preview depend on that state), signed under its own approval id for exactly the call the
 *      user approved, and sent. A call that fails or reverts stops the batch; `wallet_getCallsStatus` reports it.
 *
 * EOA accounts: no atomicity (`atomic: false` in every status; 1Mask refuses `atomicRequired: true` with 5760).
 */
import type { AssetRef, BalanceChange, DappRequest, DecodedRequest, NetworkId } from "@clip-wallet/core";
import { ClipError, msg } from "@clip-wallet/core";
import type { ApprovalPlan, PlanStep } from "@clip-wallet/ui";
import { CallsErrorCode, MAX_CALLS, NATIVE_ASSET_ADDRESS, callsError, type CallsReceipt, type CallsStatus, type Hex, type SendCallsParams, type SendCallsResult } from "@clip-wallet/1mask";

export const SEND_CALLS = "wallet_sendCalls";

/* ------------------------------------------------------------------ split */

export function sendCallsParams(req: DappRequest): SendCallsParams {
  const p = (Array.isArray(req.params) ? req.params[0] : req.params) as SendCallsParams | undefined;
  if (!p || !Array.isArray(p.calls) || p.calls.length === 0 || p.calls.length > MAX_CALLS || typeof p.from !== "string") {
    throw new ClipError("This request can't be read, so Clip Wallet stopped it.", "bad-request");
  }
  return p;
}

/** One eth_sendTransaction request per call, in order, each knowing the calls before it. */
export function splitSendCalls(req: DappRequest): DappRequest[] {
  const p = sendCallsParams(req);
  const txs = p.calls.map((c) => ({ from: p.from, ...(c.to ? { to: c.to } : {}), data: c.data ?? "0x", value: c.value ?? "0x0" }));
  return txs.map((tx, index) => ({
    id: `${req.id}#${index}`,
    origin: req.origin,
    via: req.via,
    family: req.family,
    networkId: req.networkId,
    method: "eth_sendTransaction",
    params: [tx],
    batch: { index, count: txs.length, prior: txs.slice(0, index) },
  }));
}

/* ------------------------------------------------------------------ merge */

const assetKey = (a: AssetRef) => `${a.networkId}|${(a.address ?? "").toLowerCase()}`;

/** ERC-7682 requiredAssets the app named beyond what the calls show leaving the balance (erc20 the wallet knows). */
export function requiredAssetChanges(p: SendCallsParams, known: AssetRef[], changes: BalanceChange[], networkId: NetworkId): BalanceChange[] {
  const out: BalanceChange[] = [];
  for (const r of p.auxiliaryFunds?.requiredAssets ?? []) {
    if (r.standard !== "erc20") continue;
    const asset =
      r.address.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase()
        ? known.find((a) => a.networkId === networkId && !a.address)
        : known.find((a) => a.networkId === networkId && a.address?.toLowerCase() === r.address.toLowerCase());
    if (!asset) {
      if (p.auxiliaryFunds?.optional) continue;
      throw callsError(CallsErrorCode.AuxiliaryAssetNotSupported, "Clip Wallet can't bring in that asset.");
    }
    const want = BigInt(r.amount);
    const shown = changes.filter((c) => assetKey(c.asset) === assetKey(asset)).reduce((t, c) => t + BigInt(c.delta), 0n);
    const missing = want + shown; // shown is negative when it leaves the balance
    if (missing > 0n) out.push({ asset, delta: (-missing).toString() });
  }
  return out;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}

/** The one approval for the whole batch, from each call's fully refined DecodedRequest. */
export function mergeBatchDecoded(req: DappRequest, calls: DecodedRequest[], extra: BalanceChange[] = []): DecodedRequest {
  if (calls.length === 1 && extra.length === 0) return { ...calls[0]!, requestId: req.id };
  const host = hostOf(req.origin);
  const sums = new Map<string, { asset: AssetRef; delta: bigint }>();
  for (const c of [...calls.flatMap((d) => d.balanceChanges), ...extra]) {
    const k = assetKey(c.asset);
    const hit = sums.get(k);
    if (hit) hit.delta += BigInt(c.delta);
    else sums.set(k, { asset: c.asset, delta: BigInt(c.delta) });
  }
  const fees = calls.map((d) => d.fee);
  const feeAsset = fees.find(Boolean)?.asset;
  const sameFeeAsset = fees.every((f) => !f || (feeAsset && assetKey(f.asset) === assetKey(feeAsset)));
  const fee =
    feeAsset && sameFeeAsset && fees.every(Boolean)
      ? {
          asset: feeAsset,
          amount: fees.reduce((t, f) => t + BigInt(f!.amount), 0n).toString(),
          ...(fees.every((f) => f!.sponsored) ? { sponsored: true } : {}),
        }
      : undefined;
  const seen = new Set<string>();
  const warnings = calls.flatMap((d) => d.warnings).filter((w) => {
    const k = `${w.code}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const title = msg("bg.req.batchSteps", { count: calls.length, host });
  const lines: DecodedRequest["lines"] = calls.map((d, i) => {
    const label = msg("bg.label.stepN", { n: i + 1 });
    return { label: label.fallback, labelMsg: label, value: d.title, ...(d.titleMsg ? { valueMsg: d.titleMsg } : {}) };
  });
  if (extra.length) {
    const label = msg("bg.label.appSaysNeeds");
    lines.push({ label: label.fallback, labelMsg: label, value: extra.map((c) => `${c.delta.slice(1)} ${c.asset.symbol}`).join(", ") });
  }
  const by = msg("bg.label.requestedBy");
  lines.push({ label: by.fallback, labelMsg: by, value: host });
  return {
    requestId: req.id,
    title: title.fallback,
    titleMsg: title,
    lines,
    balanceChanges: [...sums.values()].filter((s) => s.delta !== 0n).map((s) => ({ asset: s.asset, delta: s.delta.toString() })),
    ...(fee ? { fee } : {}),
    simulated: calls.every((d) => d.simulated),
    blind: calls.some((d) => d.blind),
    warnings,
    networkId: req.networkId,
  };
}

/** The plan with one action step per call (funding and fee steps as the planner made them). */
export function batchPlan(plan: ApprovalPlan, calls: DecodedRequest[]): ApprovalPlan {
  if (calls.length < 2) return plan;
  const actions: PlanStep[] = calls.map((d) => ({ kind: "action", title: d.title, ...(d.titleMsg ? { titleMsg: d.titleMsg } : {}), balanceChanges: d.balanceChanges }));
  return { ...plan, steps: [...plan.steps.filter((s) => s.kind !== "action"), ...actions] };
}

/* ------------------------------------------------------------------ status store */

export interface BatchCallRecord {
  state: "queued" | "sent" | "failed";
  hash?: string;
  /** Final receipt, once mined (EIP-5792 subset of eth_getTransactionReceipt). */
  receipt?: CallsReceipt;
}

export interface BatchRecord {
  id: string;
  /** The app's own id, if it sent one (EIP-5792: unique per sender per app). */
  appId?: string;
  origin: string;
  from: string;
  version: string;
  chainId: Hex;
  networkId: NetworkId;
  createdAt: number;
  calls: BatchCallRecord[];
  /** Why the batch stopped before every call was sent. */
  stopped?: "failed" | "reverted" | "interrupted";
}

export interface BatchStoreKV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const KEY = "clip/calls-batches";
/** EIP-5792: status SHOULD be available for 24 hours. */
const KEEP_MS = 24 * 60 * 60_000;
const MAX_RECORDS = 200;

function randomBatchId(): string {
  // EIP-5792: identifiers MUST be unpredictable. 32 random bytes.
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/** Receipt → the EIP-5792 subset. */
export function callsReceipt(r: Record<string, unknown>): CallsReceipt {
  const logs = Array.isArray(r.logs) ? (r.logs as Record<string, unknown>[]) : [];
  return {
    logs: logs.map((l) => ({ address: l.address as Hex, data: l.data as Hex, topics: (l.topics as Hex[]) ?? [] })),
    status: r.status as Hex,
    blockHash: r.blockHash as Hex,
    blockNumber: r.blockNumber as Hex,
    gasUsed: r.gasUsed as Hex,
    transactionHash: r.transactionHash as Hex,
  };
}

export class CallsBatchStore {
  /** Batches whose run is alive in this process (a record without one after a restart was interrupted). */
  private readonly running = new Set<string>();
  constructor(
    private readonly kv: BatchStoreKV,
    private readonly now: () => number = Date.now,
  ) {}

  private async all(): Promise<BatchRecord[]> {
    const list = (await this.kv.get<BatchRecord[]>(KEY)) ?? [];
    const cutoff = this.now() - KEEP_MS;
    return list.filter((r) => r.createdAt >= cutoff);
  }

  private async save(list: BatchRecord[]) {
    await this.kv.set(KEY, list.slice(-MAX_RECORDS));
  }

  /** 5720 when this app already used `appId` (checked before the approval is shown). */
  async assertNewId(origin: string, appId: string | undefined): Promise<void> {
    if (appId === undefined) return;
    if ((await this.all()).some((r) => r.origin === origin && (r.appId === appId || r.id === appId))) {
      throw callsError(CallsErrorCode.DuplicateId, "This app already sent a batch with that id.");
    }
  }

  async create(origin: string, p: SendCallsParams, networkId: NetworkId): Promise<BatchRecord> {
    await this.assertNewId(origin, p.id);
    const rec: BatchRecord = {
      id: p.id ?? randomBatchId(),
      ...(p.id !== undefined ? { appId: p.id } : {}),
      origin,
      from: p.from,
      version: p.version,
      chainId: p.chainId,
      networkId,
      createdAt: this.now(),
      calls: p.calls.map(() => ({ state: "queued" as const })),
    };
    const list = await this.all();
    list.push(rec);
    await this.save(list);
    this.running.add(rec.id);
    return rec;
  }

  async update(id: string, f: (r: BatchRecord) => void): Promise<BatchRecord | undefined> {
    const list = await this.all();
    const r = list.find((x) => x.id === id);
    if (!r) return undefined;
    f(r);
    await this.save(list);
    return r;
  }

  finished(id: string) {
    this.running.delete(id);
  }

  async get(origin: string, id: string): Promise<BatchRecord | undefined> {
    return (await this.all()).find((r) => r.id === id && r.origin === origin);
  }

  /**
   * EIP-5792 status. Receipts are fetched for sent calls not yet known final (`receipt` asks the chain). Calls never
   * sent because the batch stopped (or the wallet restarted mid-batch) make it 400 when nothing landed, else 600.
   */
  async status(origin: string, id: string, receipt: (networkId: NetworkId, hash: string) => Promise<CallsReceipt | null>): Promise<CallsStatus | undefined> {
    const r = await this.get(origin, id);
    if (!r) return undefined;
    let changed = false;
    for (const c of r.calls) {
      if (c.state === "sent" && c.hash && !c.receipt) {
        const got = await receipt(r.networkId, c.hash).catch(() => null);
        if (got) {
          c.receipt = got;
          changed = true;
        }
      }
    }
    if (!this.running.has(r.id) && !r.stopped && r.calls.some((c) => c.state === "queued")) {
      r.stopped = "interrupted";
      changed = true;
    }
    if (changed) await this.update(r.id, (x) => Object.assign(x, { calls: r.calls, stopped: r.stopped }));
    const receipts = r.calls.flatMap((c) => (c.receipt ? [c.receipt] : []));
    const included = receipts.length;
    const reverted = receipts.filter((x) => x.status !== "0x1").length;
    const sentPending = r.calls.some((c) => c.state === "sent" && !c.receipt);
    let status: CallsStatus["status"];
    if (sentPending) status = 100;
    else if (r.stopped || r.calls.some((c) => c.state !== "sent")) {
      if (r.calls.some((c) => c.state === "queued") && !r.stopped) status = 100;
      else status = included === 0 ? 400 : reverted === included ? 500 : 600;
    } else status = reverted === 0 ? 200 : reverted === included ? 500 : 600;
    return { version: r.version, id: r.id, chainId: r.chainId, status, atomic: false, ...(receipts.length ? { receipts } : {}) };
  }
}

/* ------------------------------------------------------------------ run */

export interface BatchRunHost {
  /** Prepare, sign (vault, under `approvalId`) and send one call; resolves with its transaction hash. */
  send(call: DappRequest, approvalId: string): Promise<string>;
  /** The call's receipt once mined, polling as needed (null if it never shows up in time). */
  waitReceipt(networkId: NetworkId, hash: string): Promise<CallsReceipt | null>;
  /** The batch finished or stopped (activity entry, refresh). `sent` has one entry per call. */
  done(record: BatchRecord): void | Promise<void>;
}

/**
 * Runs an approved batch: the first call before answering the app (so a broken first call fails the approval in
 * front of the user, nothing sent), the rest in order in the background.
 */
export class CallsBatchRun {
  constructor(
    private readonly store: CallsBatchStore,
    private readonly host: BatchRunHost,
  ) {}

  async start(req: DappRequest, approvalId: string, opts: { walletConnect?: boolean; done?: BatchRunHost["done"] } = {}): Promise<SendCallsResult> {
    const p = sendCallsParams(req);
    const calls = splitSendCalls(req);
    await this.store.assertNewId(req.origin, p.id);
    // Nothing is recorded until the first call is out: a failed first call leaves the approval to retry or reject.
    const first = await this.host.send(calls[0]!, `${approvalId}#0`);
    const rec = await this.store.create(req.origin, p, req.networkId);
    await this.store.update(rec.id, (r) => Object.assign(r.calls[0]!, { state: "sent", hash: first }));
    void this.rest(rec.id, req, calls, approvalId, first, opts.done ?? ((r) => this.host.done(r)));
    // WalletConnect's Universal Provider resolves the transaction from this (docs.walletconnect.com wallets/web/eip5792).
    return { id: rec.id, ...(opts.walletConnect ? { capabilities: { caip345: { caip2: req.networkId, transactionHashes: [first] } } } : {}) };
  }

  private async rest(id: string, req: DappRequest, calls: DappRequest[], approvalId: string, firstHash: string, done: BatchRunHost["done"]) {
    let prev = firstHash;
    try {
      for (let i = 1; i < calls.length; i++) {
        const mined = await this.host.waitReceipt(req.networkId, prev);
        await this.store.update(id, (r) => mined && (r.calls[i - 1]!.receipt = mined));
        if (!mined || mined.status !== "0x1") {
          await this.store.update(id, (r) => (r.stopped = mined ? "reverted" : "failed"));
          return;
        }
        try {
          prev = await this.host.send(calls[i]!, `${approvalId}#${i}`);
        } catch {
          await this.store.update(id, (r) => ((r.calls[i]!.state = "failed"), (r.stopped = "failed")));
          return;
        }
        await this.store.update(id, (r) => Object.assign(r.calls[i]!, { state: "sent", hash: prev }));
      }
      const last = await this.host.waitReceipt(req.networkId, prev);
      if (last) await this.store.update(id, (r) => (r.calls[calls.length - 1]!.receipt = last));
    } finally {
      this.store.finished(id);
      const rec = await this.store.get(req.origin, id);
      if (rec) await Promise.resolve(done(rec)).catch(() => undefined);
    }
  }
}
