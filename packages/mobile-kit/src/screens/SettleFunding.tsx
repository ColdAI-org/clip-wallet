/**
 * The approval sheet's "settle on Hedera" parts (same behaviour as packages/ui/src/screens/SettleFunding.tsx): the
 * payment's steps when a bonded Connector brings the money from another network, the order's progress after Approve,
 * and the one-tap claim when it's late. Every sentence comes from the "m.settle" catalog.
 */
import { View } from "react-native";
import { formatLocale, formatUnits, readyInMessage, type SettleAmountView, type SettleFundingView } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, Notice, T } from "../ui/kit";
import { useMobileT, type MobileMessageId } from "../i18n";

type T_ = ReturnType<typeof useMobileT>;

export const settleAmount = (a: SettleAmountView) => `${formatUnits(a.amount, a.decimals)} ${a.symbol}`;

function settleTime(unixS: number): string {
  return new Intl.DateTimeFormat(formatLocale(), { hour: "numeric", minute: "2-digit" }).format(new Date(unixS * 1000));
}

/** The funding steps for Details (they replace the plan's English funding step). */
export function settleSteps(f: SettleFundingView, t: T_): { title: string; detail?: string }[] {
  const r = readyInMessage(f.etaSeconds);
  const ready = t(`m.${r.id}` as MobileMessageId, "n" in r ? { n: r.n } : undefined);
  return [
    ...(f.approveFirst ? [{ title: t("m.settle.step.allow", { amount: settleAmount(f.pay) }) }] : []),
    { title: t("m.settle.step.pay", { amount: settleAmount(f.pay), provider: f.provider }) },
    { title: t("m.settle.step.deliver", { provider: f.provider, amount: settleAmount(f.receive) }), detail: `${t("m.approval.ready")}: ${ready}` },
    { title: t("m.settle.step.cover", { time: settleTime(f.deadline), amount: settleAmount(f.payback) }) },
  ];
}

/** Paid and waiting (or nothing left to approve): the normal Approve / Reject don't apply. */
export function settleBusy(f: SettleFundingView | undefined): boolean {
  return !!f && (f.arrived ? !!f.appGone : f.stage !== "offer");
}

const PROGRESS = ["paid", "opened", "arrived", "closed"] as const;

function reached(f: SettleFundingView): number {
  if (f.stage === "closed") return 4;
  if (f.arrived || f.stage === "delivered") return 3;
  if (f.stage === "opened" || f.stage === "late" || f.stage === "claiming") return 2;
  if (f.stage === "waiting") return 1;
  return 0;
}

/** Progress, notices and the right action for an order under way. `act` is the sheet's Approve. */
export function SettleProgress(props: { funding: SettleFundingView; app: string; busy: boolean; act: () => void }) {
  const t = useMobileT();
  const { theme } = useWallet();
  const f = props.funding;
  if (f.arrived) {
    return (
      <>
        <Notice level="info" testID="settle-arrived">
          {f.appGone ? t("m.settle.appGone", { amount: settleAmount(f.receive), app: props.app }) : t("m.settle.arrived", { amount: settleAmount(f.receive) })}
        </Notice>
        {f.appGone && (
          <Button variant="secondary" onPress={props.act} disabled={props.busy} testID="settle-close">
            {t("m.settle.close")}
          </Button>
        )}
      </>
    );
  }
  if (f.stage === "late" || f.stage === "claiming") {
    return (
      <>
        <Notice level="caution" testID="settle-late">
          {`${t("m.settle.late.title", { amount: settleAmount(f.payback) })}\n${t("m.settle.late.hint")}`}
        </Notice>
        <Button onPress={props.act} disabled={props.busy || f.stage === "claiming"} testID="settle-claim">
          {f.stage === "claiming" ? t("m.settle.claiming") : t("m.settle.late.claim", { amount: settleAmount(f.payback) })}
        </Button>
      </>
    );
  }
  if (f.stage === "rejected" || f.stage === "claimed") {
    return (
      <>
        <Notice level={f.stage === "rejected" ? "danger" : "info"}>
          {f.stage === "rejected" ? t("m.settle.rejected", { provider: f.provider }) : t("m.settle.late.title", { amount: settleAmount(f.payback) })}
        </Notice>
        <Button variant="secondary" onPress={props.act} disabled={props.busy}>
          {t("m.settle.close")}
        </Button>
      </>
    );
  }
  const n = reached(f);
  const line =
    f.stage === "paying" ? t("m.settle.paying") : f.stage === "opened" ? t("m.settle.opened", { provider: f.provider, amount: settleAmount(f.receive) }) : t("m.settle.waiting", { provider: f.provider });
  return (
    <View style={{ gap: 8 }} testID="settle-progress">
      <T>{line}</T>
      {PROGRESS.map((k, i) => (
        <View key={k} style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <T color={i < n ? theme.c.positive : theme.c.text3}>{i < n ? "✓" : `${i + 1}`}</T>
          <T color={i < n ? theme.c.text : theme.c.text3}>{t(`m.settle.progress.${k}`)}</T>
        </View>
      ))}
      <T v="hint">{t("m.settle.keepOpen")}</T>
      <Button disabled testID="settle-waiting">
        {t("m.settle.waitingButton")}
      </Button>
    </View>
  );
}
