/**
 * The approval screen's "settle on Hedera" parts: the payment's steps when a bonded Connector brings the money from
 * another network, the order's progress after Approve, and the one-tap claim when it's late. Every sentence comes
 * from the "settle" catalog; the background only sends numbers and names (SettleFundingView).
 */
import type { SettleAmountView, SettleFundingView } from "../client";
import { Button } from "../components";
import { IconAlert } from "../components/icons";
import { formatLocale, formatUnits, readyInMessage } from "../lib/format";
import { useUiT } from "../i18n";

type T = ReturnType<typeof useUiT>;

export const settleAmount = (a: SettleAmountView) => `${formatUnits(a.amount, a.decimals)} ${a.symbol}`;

export function settleTime(unixS: number): string {
  return new Intl.DateTimeFormat(formatLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(unixS * 1000));
}

/** The funding steps for Details, in order (they replace the plan's English funding step). */
export function settleSteps(f: SettleFundingView, t: T): { title: string; detail?: string }[] {
  const ready = readyInMessage(f.etaSeconds);
  return [
    ...(f.approveFirst ? [{ title: t("settle.step.allow", { amount: settleAmount(f.pay) }) }] : []),
    { title: t("settle.step.pay", { amount: settleAmount(f.pay), provider: f.provider }) },
    { title: t("settle.step.deliver", { provider: f.provider, amount: settleAmount(f.receive) }), detail: `${t("approval.ready")}: ${t(ready.id, ready)}` },
    { title: t("settle.step.cover", { time: settleTime(f.deadline), amount: settleAmount(f.payback) }) },
  ];
}

/** Waiting for the money, or nothing more to do: Approve and Reject don't apply. */
export function settleBusy(f: SettleFundingView | undefined): boolean {
  return !!f && !f.arrived && f.stage !== "offer";
}

const PROGRESS = ["paid", "opened", "arrived", "closed"] as const;

function reached(f: SettleFundingView): number {
  if (f.stage === "closed") return 4;
  if (f.arrived || f.stage === "delivered") return 3;
  if (f.stage === "opened" || f.stage === "late" || f.stage === "claiming") return 2;
  if (f.stage === "waiting") return 1;
  return 0;
}

/** Progress and the right action for an order under way (stage past "offer"). `act` is the host's Approve. */
export function SettleProgress(props: { funding: SettleFundingView; app: string; busy: boolean; act: () => void }) {
  const t = useUiT();
  const f = props.funding;
  const n = reached(f);
  if (f.arrived) {
    return (
      <div className="clip-notice clip-notice--info" role="status" data-testid="settle-arrived">
        <span>{f.appGone ? t("settle.appGone", { amount: settleAmount(f.receive), app: props.app }) : t("settle.arrived", { amount: settleAmount(f.receive) })}</span>
      </div>
    );
  }
  if (f.stage === "late" || f.stage === "claiming") {
    return (
      <div className="clip-settle" data-testid="settle-late">
        <div className="clip-notice clip-notice--caution" role="alert">
          <IconAlert />
          <span>
            <strong>{t("settle.late.title", { amount: settleAmount(f.payback) })}</strong>
            <br />
            {t("settle.late.hint")}
          </span>
        </div>
          <Button block onClick={props.act} disabled={props.busy || f.stage === "claiming"}>
            {f.stage === "claiming" ? t("settle.claiming") : t("settle.late.claim", { amount: settleAmount(f.payback) })}
          </Button>
      </div>
    );
  }
  if (f.stage === "rejected" || f.stage === "claimed") {
    return (
      <div className="clip-settle">
        <div className={`clip-notice clip-notice--${f.stage === "rejected" ? "danger" : "info"}`} role="alert">
          <IconAlert />
          <span>{f.stage === "rejected" ? t("settle.rejected", { provider: f.provider }) : t("settle.late.title", { amount: settleAmount(f.payback) })}</span>
        </div>
          <Button block variant="secondary" onClick={props.act} disabled={props.busy}>
            {t("settle.close")}
          </Button>
      </div>
    );
  }
  const line =
    f.stage === "paying" ? t("settle.paying") : f.stage === "opened" ? t("settle.opened", { provider: f.provider, amount: settleAmount(f.receive) }) : t("settle.waiting", { provider: f.provider });
  return (
    <div className="clip-settle" data-testid="settle-progress">
      <p className="clip-approval__settlement" role="status">
        {line}
      </p>
      <ol className="clip-steps">
        {PROGRESS.map((k, i) => (
          <li key={k} className={`clip-step ${i < n ? "is-done" : ""}`} aria-current={i === n ? "step" : undefined}>
            <span className="clip-step__n" aria-hidden>
              {i < n ? "✓" : i + 1}
            </span>
            <div className="clip-step__body">
              <div className="clip-step__title">{t(`settle.progress.${k}`)}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="clip-approval__settlement">{t("settle.keepOpen")}</p>
        <Button block disabled aria-disabled>
          {t("settle.waitingButton")}
        </Button>
    </div>
  );
}
