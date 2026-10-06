/**
 * Paying through a bonded Connector ("settle on Hedera"), host side. Shared by the mobile engine (./engine.ts) and the
 * extension's background (packages/extension-kit/src/background/service.ts) so both run the same steps:
 *
 *   1. Approve on a payment whose plan has `funding` (stage "offer"): build the exact-amount approve + deposit
 *      requests (@clip-wallet/route SettleFunding.order) and sign/send each through the host's normal path, in that
 *      one approval; the approve must be mined before the deposit is checked and signed.
 *   2. Follow the order: Hedera's mirror node (opened → closed, or late) and the balance on the payment's network
 *      (delivered). When the money is there, the plan is recomputed and the original request waits for Approve again.
 *   3. Late: Approve becomes the one-tap claim of cover + penalty on Hedera.
 *
 * The run edits the approval's `plan.funding` in place and calls `changed()` so screens re-render.
 *
 * @module
 */
import type { AssetRef, DappRequest } from "@clip-wallet/core";
import { ClipError } from "@clip-wallet/core";
import type { ApprovalPlan, ApprovalView, SettleFundingView } from "@clip-wallet/ui";
import { SETTLE_FINAL_STAGES, type SettleFunding, type SettleFundingPlan } from "@clip-wallet/route";

export interface SettleRunHost {
  /** Decode (must be readable), sign and send a wallet-built request as the account of the app's request. */
  send(request: DappRequest, approvalId: string): Promise<string>;
  /** Resolve once a transaction is mined successfully (throws if it failed). */
  waitMined(networkId: string, txHash: string): Promise<void>;
  /** The account's balance of `asset` right now. */
  balance(asset: AssetRef): Promise<bigint>;
  /** The original request's plan, recomputed with fresh balances. */
  replan(): Promise<ApprovalPlan | undefined>;
  changed(): void;
  /** Mirror-node poll interval, ms. */
  pollMs: number;
}

/** What the host does after Approve on a funded request. */
export type SettleApproveResult =
  /** The run handled it (paid the Connector); keep the approval open. */
  | "handled"
  /** The money arrived: sign the original request the normal way. */
  | "sign"
  /** The cover was claimed on Hedera: close the approval, the app's request can't be paid. */
  | "claimed"
  /** The app stopped waiting and the money arrived: just close the approval. */
  | "dismiss";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function txHashOf(result: unknown): string {
  const h = result && typeof result === "object" && "txHash" in result ? String((result as { txHash: unknown }).txHash) : typeof result === "string" ? result : "";
  if (!TX_HASH.test(h)) throw new ClipError("That didn't go through. Nothing left your balance.", "settle/no-tx");
  return h;
}

export class SettleFundingRun {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private need?: SettleFundingPlan["need"];
  /** True once the Connector has been paid (the money is in flight until it arrives or is claimed). */
  paid = false;

  constructor(
    private readonly funding: SettleFunding,
    private readonly view: ApprovalView,
    private readonly account: string,
    private readonly host: SettleRunHost,
  ) {}

  get info(): SettleFundingView {
    const f = this.view.plan?.funding;
    if (!f) throw new ClipError("This request isn't paid through a Connector.", "settle/none");
    return f;
  }

  /** Paid and still waiting for the money or a claim: the approval must stay. */
  get inFlight(): boolean {
    const f = this.view.plan?.funding;
    return this.paid && !!f && !f.arrived && !SETTLE_FINAL_STAGES.has(f.stage);
  }

  private set(patch: Partial<SettleFundingView>) {
    Object.assign(this.info, patch);
    this.host.changed();
  }

  async approve(): Promise<SettleApproveResult> {
    const f = this.info;
    if (f.arrived) return f.appGone ? "dismiss" : "sign";
    if (f.stage === "offer") {
      await this.pay();
      return "handled";
    }
    if (f.stage === "late") {
      await this.claim();
      return "claimed";
    }
    if (f.stage === "rejected" || f.stage === "claimed") return "dismiss";
    throw new ClipError("Your money is still on its way. You can approve once it arrives.", "settle/in-flight");
  }

  private async pay() {
    const orderId = this.info.orderId;
    this.set({ stage: "paying" });
    let sent = 0;
    try {
      const { requests, need } = await this.funding.order(orderId, this.account);
      this.need = need;
      let last = "";
      for (const [i, r] of requests.entries()) {
        last = await this.host.send(r, `${this.view.id}:settle:${i}`);
        sent++;
        // The deposit is checked (simulated) and its gas estimated against the allowance: wait for the approve.
        if (i < requests.length - 1) await this.host.waitMined(r.networkId, last);
      }
      this.funding.markDeposited(orderId, last);
      this.paid = true;
      this.set({ stage: "waiting", depositTx: last });
    } catch (e) {
      if (e instanceof ClipError && e.code === "settle/offer-changed") {
        const plan = await this.host.replan().catch(() => undefined);
        if (plan) this.view.plan = plan;
        else this.set({ stage: "offer" });
        this.host.changed();
        throw e;
      }
      // Nothing was paid (at most an allowance was set): the offer stands, Approve can be tried again.
      this.set({ stage: "offer" });
      if (sent > 0 && e instanceof ClipError) throw new ClipError("Your payment couldn't be sent. Nothing left your balance.", "settle/deposit-failed", e);
      throw e;
    }
    this.schedule();
  }

  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), this.host.pollMs);
  }

  /** One look at the balance and at Hedera. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const f = this.view.plan?.funding;
    if (!f) return;
    try {
      let arrived = !!f.arrived;
      if (!arrived && this.need) arrived = (await this.host.balance(this.need.asset)) >= BigInt(this.need.amount);
      const { stage, order } = await this.funding.stage(f.orderId, arrived);
      const patch: Partial<SettleFundingView> = { stage };
      if (order.claimableFrom !== undefined) patch.claimableFrom = order.claimableFrom;
      if (arrived && !f.arrived) {
        // Re-plan the original request now that the money is there; keep following the order beside it.
        const plan = await this.host.replan().catch(() => undefined);
        const next = { ...f, ...patch, arrived: true };
        if (plan) this.view.plan = { ...plan, funding: next };
        else Object.assign(f, next);
        this.host.changed();
      } else {
        this.set(patch);
      }
      // Late, claimed, rejected or closed: nothing more to wait for.
      if (SETTLE_FINAL_STAGES.has(stage) || stage === "late") return this.stop();
    } catch {
      /* Hedera or the network didn't answer: try again next time. */
    }
    this.schedule();
  }

  private async claim() {
    this.set({ stage: "claiming" });
    try {
      const requests = await this.funding.claim(this.info.orderId, this.account);
      let last = "";
      for (const [i, r] of requests.entries()) last = await this.host.send(r, `${this.view.id}:claim:${i}`);
      this.set({ stage: "claimed", claimTx: last });
      this.stop();
    } catch (e) {
      this.set({ stage: "late" });
      throw e;
    }
  }

  /** The app gave up on its request: keep following the order so the user can still claim or see the money arrive. */
  appGone() {
    this.set({ appGone: true });
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

/** Activity title for a claimed cover ("Paid back 4.7 HBAR on Hedera"). */
export function claimedTitle(f: SettleFundingView, format: (amount: string, decimals: number) => string): string {
  return `Paid back ${format(f.payback.amount, f.payback.decimals)} ${f.payback.symbol} on Hedera`;
}
