import { type AssetRef, type ChainContext, ClipError, type DappRequest, type DecodedRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import {
  type SwapLeg,
  buildAssociate,
  buildAtomicSwap,
  buildScheduleSign,
  hbarAsset,
  mirrorFor,
  parseTransaction,
  resolvePayer,
  transactionIdString,
} from "@clip-wallet/chains-hedera";
import type { FeatureHost } from "../host.js";
import { type Step, queueSteps } from "../steps.js";
import { b64ToBytes, formatUnits, parseUnits } from "../util.js";
import type { QueuedApprovals, TradeLegView, TradeOfferView, TradeReviewView, TradeStatus } from "../views.js";
import { type LegSpec, type OfferPayload, decodeOffer, encodeOffer, legText } from "./offer.js";

/**
 * Secure Trade (Hedera P2P, HashPack parity) on top of chains-hedera `buildAtomicSwap`: one TransferTransaction
 * carries both legs, so both happen or neither does.
 *  - direct: the maker signs (`clip_hedera_signTransactionBytes`), shares a link with the signed bytes; the taker
 *    adds their signature and submits within the transaction's 180 s window. Good when both are online.
 *  - scheduled: the maker submits a ScheduleCreate; the taker approves with ScheduleSign whenever they like
 *    until the schedule expires. Status comes from the mirror node schedule state.
 * Token association is handled plainly: if you can't receive the token, "Add SAUCE to your account" is queued
 * first; if the other side can't, the offer says so.
 */
export type LegInput = { assetKey: string; amount: string } | { nft: { tokenId: string; serial: string } };

interface TradeRecord {
  id: string;
  role: "maker" | "taker";
  payload: OfferPayload;
  status: TradeStatus;
  createdAt: number;
  transactionId?: string;
  notes: string[];
  link?: string;
}

const KEY = "clip/features/trades";
const DIRECT_VALID_MS = 180_000;
const DEFAULT_SCHEDULE_HOURS = 24;

/** SDK "0.0.1@1700000000.000000001" → mirror "0.0.1-1700000000-000000001". */
export function mirrorTxId(sdkId: string): string {
  const m = /^(0\.0\.\d+)@(\d+)\.(\d+)$/.exec(sdkId.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]!.padStart(9, "0")}` : sdkId;
}

function legView(l: LegSpec): TradeLegView {
  const display = legText(l, (a, d) => formatUnits(a, d));
  if (l.kind === "nft") return { kind: "nft", tokenId: l.tokenId, serial: l.serial, display };
  const v: TradeLegView = { kind: "asset", assetKey: l.assetKey, symbol: l.symbol, amount: l.amount, display };
  if (l.tokenId) v.tokenId = l.tokenId;
  return v;
}

function toSwapLeg(l: LegSpec, networkId: string): SwapLeg {
  if (l.kind === "nft") return { nft: { tokenId: l.tokenId, serial: l.serial } };
  const asset: AssetRef = l.tokenId
    ? { key: l.assetKey, symbol: l.symbol, name: l.symbol, decimals: l.decimals, networkId, address: l.tokenId }
    : hbarAsset(networkId);
  return { asset, amount: l.amount };
}

function tokenOf(l: LegSpec): string | undefined {
  return l.kind === "nft" ? l.tokenId : l.tokenId;
}

export class SecureTradeService {
  constructor(
    private readonly host: FeatureHost,
    private readonly opts: { linkBase?: string } = {},
  ) {}

  private now(): number {
    return this.host.now?.() ?? Date.now();
  }

  private network() {
    const n = this.host.networks().find((x) => x.family === "hedera");
    if (!n) throw new ClipError("Secure Trade needs a Hedera account, which this wallet doesn't have switched on.", "trade/unavailable");
    return n;
  }

  private async records(): Promise<TradeRecord[]> {
    return (await this.host.kv.get<TradeRecord[]>(KEY)) ?? [];
  }

  private async save(r: TradeRecord): Promise<void> {
    const all = (await this.records()).filter((x) => x.id !== r.id);
    await this.host.kv.set(KEY, [r, ...all].slice(0, 100));
  }

  /** Resolve what the user typed into a leg: an asset this wallet knows, an HTS token id ("0.0.x"), or an NFT. */
  async resolveLeg(input: LegInput, ctx: ChainContext): Promise<LegSpec> {
    if ("nft" in input) {
      if (!/^0\.0\.\d+$/.test(input.nft.tokenId) || !/^\d+$/.test(input.nft.serial)) throw new ClipError("Enter the collection as 0.0.1234 and the item number.", "trade/bad-nft");
      const t = await mirrorFor(ctx).token(input.nft.tokenId);
      if (!t || t.type !== "NON_FUNGIBLE_UNIQUE") throw new ClipError("That collection couldn't be found.", "trade/unknown-nft");
      return { kind: "nft", tokenId: input.nft.tokenId, serial: input.nft.serial, name: t.name };
    }
    const known = this.host.assets().find((a) => a.key === input.assetKey && a.networkId === ctx.network.id);
    if (known) {
      const amount = parseUnits(input.amount, known.decimals);
      if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "trade/bad-amount");
      const l: LegSpec = { kind: "asset", assetKey: known.key, symbol: known.symbol, decimals: known.decimals, amount: amount.toString() };
      if (known.address) l.tokenId = known.address;
      return l;
    }
    const tokenId = input.assetKey.replace(/^hts:/, "");
    if (!/^0\.0\.\d+$/.test(tokenId)) throw new ClipError("Pick a token, or enter its id like 0.0.1234.", "trade/unknown-asset");
    const t = await mirrorFor(ctx).token(tokenId);
    if (!t || t.type !== "FUNGIBLE_COMMON") throw new ClipError("That token couldn't be found.", "trade/unknown-asset");
    const decimals = Number(t.decimals);
    const amount = parseUnits(input.amount, decimals);
    if (amount <= 0n) throw new ClipError("Enter an amount above zero.", "trade/bad-amount");
    return { kind: "asset", assetKey: `hts:${tokenId}`, symbol: t.symbol, decimals, amount: amount.toString(), tokenId };
  }

  /** Can `account` receive `tokenId` right now (associated, or a free auto-association slot)? */
  async canReceive(ctx: ChainContext, account: string, tokenId: string): Promise<boolean> {
    const mirror = mirrorFor(ctx);
    const acct = await mirror.account(account);
    if (!acct) return false;
    if (await mirror.tokenRelationship(acct.account, tokenId)) return true;
    const max = acct.max_automatic_token_associations;
    if (max === -1) return true;
    const used = (await mirror.tokenRelationships(acct.account)).filter((r) => r.automatic_association).length;
    return used < max;
  }

  async createOffer(p: { give: LegInput; get: LegInput; counterparty: string; mode: "direct" | "scheduled"; expiresInHours?: number }): Promise<{ offerId: string; queued: QueuedApprovals }> {
    const network = this.network();
    const ctx = await this.host.ctx(network.id);
    const mirror = mirrorFor(ctx);
    const me = await resolvePayer(ctx, mirror);
    const other = await mirror.account(p.counterparty.trim().toLowerCase().replace(/-[a-z]{5}$/, ""));
    if (!other) throw new ClipError("That account doesn't exist yet. Ask them for their account id (0.0.…).", "trade/unknown-counterparty");
    if (other.account === me) throw new ClipError("You can't trade with yourself.", "trade/self");
    const give = await this.resolveLeg(p.give, ctx);
    const get = await this.resolveLeg(p.get, ctx);

    const notes: string[] = [];
    const giveToken = tokenOf(give);
    if (giveToken && !(await this.canReceive(ctx, other.account, giveToken))) {
      notes.push(`${other.account} must add ${give.kind === "nft" ? (give.name ?? giveToken) : give.symbol} to their account before they can accept.`);
    }
    const steps: Step[] = [];
    const getToken = tokenOf(get);
    if (getToken && !(await this.canReceive(ctx, me, getToken))) {
      const label = get.kind === "nft" ? (get.name ?? getToken) : get.symbol;
      steps.push({ title: `Add ${label} to your account`, request: () => buildAssociate(getToken, ctx) });
    }

    const id = crypto.randomUUID();
    const expiresAt = p.mode === "direct" ? undefined : this.now() + Math.min(Math.max(p.expiresInHours ?? DEFAULT_SCHEDULE_HOURS, 1), 24 * 60) * 3_600_000;
    const payload: OfferPayload = { v: 1, n: network.id, mode: p.mode, maker: me, taker: other.account, give, get };
    const record: TradeRecord = { id, role: "maker", payload, status: "draft", createdAt: this.now(), notes };
    await this.save(record);
    const title = `Trade ${legText(give, formatUnits)} for ${legText(get, formatUnits)} with ${other.account}`;
    const base = this.opts.linkBase ?? "https://clipwallet.example/trade";

    steps.push({
      title,
      lines: [
        { label: "Both sides", value: "Happen together, or not at all" },
        { label: p.mode === "direct" ? "They have" : "They can accept until", value: p.mode === "direct" ? "3 minutes to accept after you sign" : new Date(expiresAt!).toUTCString() },
      ],
      request: () =>
        buildAtomicSwap(
          {
            give: toSwapLeg(give, network.id),
            get: toSwapLeg(get, network.id),
            counterparty: other.account,
            schedule: p.mode === "scheduled" ? { expiresAt: new Date(expiresAt!), memo: "Clip Wallet Secure Trade" } : undefined,
          },
          ctx,
        ),
      finish: async (result) => {
        if (p.mode === "direct") {
          const list = (result as { transactionList?: string } | undefined)?.transactionList;
          if (!list) throw new ClipError("The trade wasn't signed. Nothing happened.", "trade/not-signed");
          payload.tx = list;
          const id = parseTransaction(b64ToBytes(list)).body.transactionId;
          const inner = id ? transactionIdString(id) : null;
          if (inner) record.transactionId = mirrorTxId(inner);
          payload.expiresAt = this.now() + DIRECT_VALID_MS;
        } else {
          const txId = (result as { transactionId?: string } | undefined)?.transactionId;
          if (!txId) throw new ClipError("The trade wasn't created. Nothing happened.", "trade/not-created");
          record.transactionId = mirrorTxId(txId);
          payload.schedule = await this.scheduleIdOf(ctx, record.transactionId);
          payload.expiresAt = expiresAt;
        }
        record.status = "waiting";
        record.link = encodeOffer(base, payload);
        await this.save(record);
        return { offerId: id, link: record.link };
      },
    });
    const queued = await queueSteps(this.host, steps, "Secure Trade", undefined, async () => {
      record.status = "cancelled";
      await this.save(record).catch(() => undefined);
    });
    return { offerId: id, queued };
  }

  /** The schedule id a ScheduleCreate produced (mirror lags consensus by a few seconds). */
  async scheduleIdOf(ctx: ChainContext, mirrorTransactionId: string, tries = 8, delayMs = 1500): Promise<string> {
    const mirror = mirrorFor(ctx);
    for (let i = 0; i < tries; i++) {
      const r = await mirror.get<{ transactions: { entity_id: string | null; result: string; name: string }[] }>(`/api/v1/transactions/${mirrorTransactionId}`).catch(() => null);
      const t = r?.transactions.find((x) => x.name === "SCHEDULECREATE") ?? r?.transactions[0];
      if (t && t.result !== "SUCCESS") throw new ClipError("The trade couldn't be created. Nothing moved.", `trade/${t.result.toLowerCase()}`);
      if (t?.entity_id) return t.entity_id;
      if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    }
    throw new ClipError("The trade was sent but isn't visible yet. Check Secure Trade again in a minute.", "trade/schedule-pending");
  }

  private view(r: TradeRecord): TradeOfferView {
    const p = r.payload;
    const counterparty = r.role === "maker" ? p.taker : p.maker;
    const [mine, theirs] = r.role === "maker" ? [p.give, p.get] : [p.get, p.give];
    const title = `Trade ${legText(mine, formatUnits)} for ${legText(theirs, formatUnits)} with ${counterparty}`;
    const statusText: Record<TradeStatus, string> = {
      draft: "Waiting for your approval",
      waiting: r.role === "maker" ? `Waiting for ${counterparty} to accept` : "Waiting to go through",
      done: "Done. Both sides moved",
      expired: "Expired. Nothing moved",
      cancelled: "Cancelled. Nothing moved",
      failed: "Didn't go through. Nothing moved",
    };
    const v: TradeOfferView = {
      id: r.id,
      role: r.role,
      mode: p.mode,
      title,
      give: legView(mine),
      get: legView(theirs),
      counterparty,
      status: r.status,
      statusText: statusText[r.status],
      createdAt: r.createdAt,
      notes: r.notes,
    };
    if (r.link) v.link = r.link;
    if (p.expiresAt) v.expiresAt = p.expiresAt;
    return v;
  }

  /** Every trade this wallet made or accepted, with status refreshed from the mirror node. */
  async list(): Promise<TradeOfferView[]> {
    const all = await this.records();
    const out: TradeOfferView[] = [];
    for (const r of all) {
      if (r.status === "waiting") {
        const s = await this.statusOf(r).catch(() => r.status);
        if (s !== r.status) {
          r.status = s;
          await this.save(r);
        }
      }
      out.push(this.view(r));
    }
    return out;
  }

  async statusOf(r: TradeRecord): Promise<TradeStatus> {
    const ctx = await this.host.ctx(r.payload.n);
    const mirror = mirrorFor(ctx);
    if (r.payload.mode === "scheduled" && r.payload.schedule) {
      const s = await mirror.schedule(r.payload.schedule);
      if (!s) return r.status;
      if (s.executed_timestamp) return "done";
      if (s.deleted) return "cancelled";
      const exp = s.expiration_time ? Number(s.expiration_time.split(".")[0]) * 1000 : r.payload.expiresAt;
      if (exp && this.now() > exp) return "expired";
      return "waiting";
    }
    // Direct: the taker submits the maker's transaction; its id is in the signed bytes' transaction id.
    if (r.transactionId) {
      const t = await mirror.get<{ transactions: { result: string }[] }>(`/api/v1/transactions/${r.transactionId}`).catch(() => null);
      const result = t?.transactions[0]?.result;
      if (result === "SUCCESS") return "done";
      if (result) return "failed";
    }
    if (r.payload.expiresAt && this.now() > r.payload.expiresAt + 30_000) return "expired";
    return "waiting";
  }

  /** The request the taker approves: add the signature and submit (direct), or ScheduleSign (scheduled). */
  private async takerRequest(p: OfferPayload, ctx: ChainContext, me: string): Promise<DappRequest> {
    if (p.mode === "scheduled") return buildScheduleSign(p.schedule!, ctx);
    return {
      id: crypto.randomUUID(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "hedera",
      networkId: p.n,
      method: "hedera_signAndExecuteTransaction",
      params: { signerAccountId: `${p.n}:${me}`, transactionList: p.tx! },
    };
  }

  /**
   * Taker side: decode the actual transaction with the Hedera module and check it moves exactly what the link
   * claims (you receive `give`, you pay `get`, nothing else leaves your account).
   */
  checkAgainstClaims(p: OfferPayload, decoded: DecodedRequest): string | undefined {
    if (decoded.blind) return "Clip Wallet can't read this trade, so it can't be accepted.";
    const changes = decoded.balanceChanges;
    const match = (l: LegSpec, sign: 1n | -1n) =>
      changes.some((c) => {
        const tokenOk = l.kind === "nft" ? c.asset.address === l.tokenId : l.tokenId ? c.asset.address === l.tokenId : !c.asset.address;
        const amount = l.kind === "nft" ? 1n : BigInt(l.amount);
        return tokenOk && BigInt(c.delta) === sign * amount;
      });
    if (!match(p.give, 1n) || !match(p.get, -1n)) return "This link doesn't match the trade inside it. Don't accept it; ask the other person for a new link.";
    const claimed = (c: (typeof changes)[number]) => [p.give, p.get].some((l) => (l.kind === "nft" || l.tokenId ? c.asset.address === tokenOf(l) : !c.asset.address));
    if (changes.some((c) => BigInt(c.delta) < 0n && !claimed(c))) return "This trade takes more from your account than the link says. Don't accept it.";
    return undefined;
  }

  async review(link: string): Promise<TradeReviewView> {
    const p = decodeOffer(link);
    const network = this.host.networks().find((n) => n.id === p.n);
    const offerView = (problem?: string): TradeOfferView => {
      const r: TradeRecord = { id: `review:${p.maker}:${p.schedule ?? p.tx?.slice(-16)}`, role: "taker", payload: p, status: "waiting", createdAt: this.now(), notes: [] };
      const v = this.view(r);
      if (problem) v.statusText = problem;
      return v;
    };
    if (!network) {
      const problem = "This offer is for a Hedera network this wallet isn't using, so it can't be accepted here.";
      return { offer: offerView(problem), title: "Secure Trade offer", lines: [], balanceChanges: [], warnings: [{ level: "danger", code: "network-matters", message: problem }], steps: [], problem };
    }
    const ctx = await this.host.ctx(network.id);
    const mirror = mirrorFor(ctx);
    const me = await resolvePayer(ctx, mirror);
    const fail = (problem: string): TradeReviewView => ({ offer: offerView(problem), title: "Secure Trade offer", lines: [], balanceChanges: [], warnings: [], steps: [], problem });
    if (p.taker !== me && p.taker.toLowerCase() !== ctx.account.address.toLowerCase()) return fail(`This offer is for ${p.taker}, not for you.`);
    if (p.maker === me) return fail("This is your own offer. Share it with the other person.");
    if (p.mode === "direct" && p.expiresAt && this.now() > p.expiresAt) return fail("This offer expired. Nothing moved. Ask for a new one.");
    if (p.mode === "scheduled") {
      const s = await mirror.schedule(p.schedule!);
      if (!s) return fail("This offer couldn't be found. Ask for a new link.");
      if (s.executed_timestamp) return fail("This trade already happened.");
      if (s.deleted) return fail("This offer was cancelled.");
      if (s.expiration_time && this.now() > Number(s.expiration_time.split(".")[0]) * 1000) return fail("This offer expired. Nothing moved.");
    }
    const request = await this.takerRequest(p, ctx, me);
    const decoded = await this.host.decode(request);
    const problem = this.checkAgainstClaims(p, decoded);
    const steps: string[] = [];
    const recv = tokenOf(p.give);
    if (recv && !(await this.canReceive(ctx, me, recv))) steps.push(`Add ${p.give.kind === "nft" ? (p.give.name ?? recv) : p.give.symbol} to your account`);
    steps.push("Accept the trade");
    const view: TradeReviewView = {
      offer: offerView(),
      title: decoded.title,
      lines: decoded.lines,
      balanceChanges: decoded.balanceChanges,
      warnings: decoded.warnings,
      steps,
    };
    if (problem) view.problem = problem;
    return view;
  }

  async accept(link: string): Promise<QueuedApprovals> {
    const review = await this.review(link);
    if (review.problem) throw new ClipError(review.problem, "trade/cannot-accept");
    const p = decodeOffer(link);
    const ctx = await this.host.ctx(p.n);
    const me = await resolvePayer(ctx);
    const steps: Step[] = [];
    const recv = tokenOf(p.give);
    if (recv && !(await this.canReceive(ctx, me, recv))) {
      steps.push({ title: `Add ${p.give.kind === "nft" ? (p.give.name ?? recv) : p.give.symbol} to your account`, request: () => buildAssociate(recv, ctx) });
    }
    const record: TradeRecord = { id: crypto.randomUUID(), role: "taker", payload: p, status: "draft", createdAt: this.now(), notes: [] };
    steps.push({
      title: review.offer.title,
      request: () => this.takerRequest(p, ctx, me),
      finish: async (result) => {
        const txId = (result as { transactionId?: string } | undefined)?.transactionId;
        if (txId) record.transactionId = mirrorTxId(txId);
        record.status = "waiting";
        await this.save(record);
        return result;
      },
    });
    return queueSteps(this.host, steps, "Secure Trade");
  }
}
