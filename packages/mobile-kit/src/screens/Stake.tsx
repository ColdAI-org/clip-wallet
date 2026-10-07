/**
 * Stake: the extension's StakeHome / StakeAsset (packages/ui/src/features/Stake.tsx) in React Native. Every
 * provider the engine's StakingService exposes shows up. No network names: the wallet picks where.
 * Like the extension: Cardano asks how the stake counts in community votes before rewards can be collected,
 * a partial unstake takes an amount, and Tezos can delegate without staking an amount.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { canonicalAmount, parseUnits, userMessageOf, type StakeAssetView, type StakePositionView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, Choices, Empty, ErrorNote, Field, Row, Screen, Spinner, T } from "../ui/kit";
import { useMobileT, type MobileMessageId } from "../i18n";

type Action = StakePositionView["actions"][number];

const ACTION_LABEL: Record<Action, MobileMessageId> = {
  unstake: "m.stake.action.unstake",
  withdraw: "m.stake.action.withdraw",
  claim: "m.stake.action.claim",
  change: "m.stake.action.change",
};

/** Cardano's vote choices arrive in English from the features package; the known ones are translated by id. */
function choiceText(c: { id: string; title: string; detail: string }, t: ReturnType<typeof useMobileT>): { title: string; detail: string } {
  if (c.id === "abstain") return { title: t("m.stake.choice.abstain"), detail: t("m.stake.choice.abstainDetail") };
  if (c.id === "no-confidence") return { title: t("m.stake.choice.noConfidence"), detail: t("m.stake.choice.noConfidenceDetail") };
  return c;
}

export function Stake(props: { assetKey?: string }) {
  return props.assetKey ? <StakeAsset assetKey={props.assetKey} /> : <StakeHome />;
}

export function StakeHome() {
  const { wallet, navigate, showApproval } = useWallet();
  const t = useMobileT();
  const { data, error, reload } = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** A claim waiting for the vote choice, or an unstake waiting for an amount. */
  const [pending, setPending] = useState<{ positionId: string; action: "claim" | "unstake" } | null>(null);
  const [choice, setChoice] = useState<string>();
  const [unstakeAmount, setUnstakeAmount] = useState("");

  async function act(a: StakeAssetView, p: StakePositionView, action: Action, extra: { amount?: string; choice?: string } = {}) {
    if (action === "change") return navigate({ name: "stake", assetKey: a.assetKey });
    if (action === "claim" && p.claimChoices && !extra.choice) return setPending({ positionId: p.id, action });
    if (action === "unstake" && p.partialUnstake && extra.amount === undefined) return setPending({ positionId: p.id, action });
    setBusy(p.id + action);
    setErr(null);
    try {
      const q = await wallet.features.stakeAction({
        assetKey: a.assetKey,
        positionId: p.id,
        action,
        ...(extra.amount ? { amount: extra.amount } : {}),
        ...(extra.choice ? { choice: extra.choice } : {}),
      });
      setPending(null);
      setUnstakeAmount("");
      showApproval(q.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <Screen back title={t("m.stake.title")}>
      <T v="lede">{t("m.stake.lede")}</T>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title={t("m.stake.empty")}>{t("m.stake.emptyHint")}</Empty>}
      {data?.map((a) => (
        <Card key={a.assetKey}>
          <View testID={`stake-asset-${a.assetKey}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T style={{ fontWeight: "600" }}>{a.symbol}</T>
            {a.rewardRate ? <Chip tone="accent">{a.rewardRate}</Chip> : null}
            <View style={{ flex: 1 }} />
            {!a.unavailable && (
              <Button variant="secondary" style={{ flex: 0 }} testID={`stake-open-${a.assetKey}`} onPress={() => navigate({ name: "stake", assetKey: a.assetKey })}>
                {a.positions.length > 0 && a.wholeBalance ? t("m.stake.action.change") : t("m.stake.stakeSymbol", { symbol: a.symbol })}
              </Button>
            )}
          </View>
          {a.unavailable ? <T v="hint">{a.unavailable.message}</T> : null}
          {a.positions.map((p) => (
            <View key={p.id} testID="stake-position" style={{ gap: 2 }}>
              <Row label={p.amountDisplay} value={p.statusText} />
              <Row label={t("m.stake.with")} value={p.with} />
              {p.pendingReward ? <Row label={t("m.stake.rewardsOnTheWay")} value={p.pendingReward.display} /> : null}
              {pending?.positionId === p.id && pending.action === "claim" && p.claimChoices && (
                <View style={{ gap: 8 }} testID="stake-claim-choice">
                  <T v="hint">{t("m.stake.choice.lede")}</T>
                  <Choices
                    label={t("m.stake.choice.label")}
                    value={choice}
                    onChange={setChoice}
                    options={p.claimChoices.map((c) => ({ value: c.id, ...choiceText(c, t), hint: choiceText(c, t).detail }))}
                  />
                  <Button disabled={busy !== null || !choice} testID="stake-claim-confirm" onPress={() => void act(a, p, "claim", { choice })}>
                    {t("m.stake.action.claim")}
                  </Button>
                </View>
              )}
              {pending?.positionId === p.id && pending.action === "unstake" && (
                <View style={{ gap: 8 }}>
                  <Field
                    label={t("m.stake.partial.label")}
                    keyboardType="decimal-pad"
                    placeholder={t("m.stake.partial.placeholder")}
                    value={unstakeAmount}
                    onChangeText={setUnstakeAmount}
                    testID="stake-unstake-amount"
                  />
                  <Button variant="ghost" disabled={busy !== null} testID="stake-unstake-confirm" onPress={() => void act(a, p, "unstake", { amount: canonicalAmount(unstakeAmount) ?? "" })}>
                    {unstakeAmount.trim() ? t("m.stake.partial.some", { amount: unstakeAmount.trim(), symbol: a.symbol }) : t("m.stake.partial.all", { symbol: a.symbol })}
                  </Button>
                </View>
              )}
              {p.actions.length > 0 && (
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {p.actions.map((action) => (
                    <Button key={action} variant={action === "unstake" ? "ghost" : "secondary"} disabled={busy !== null} testID={`stake-${action}`} onPress={() => void act(a, p, action)}>
                      {t(ACTION_LABEL[action])}
                    </Button>
                  ))}
                </View>
              )}
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

/** "Stake SOL": how it works, where (picked for you), how much. */
export function StakeAsset(props: { assetKey: string }) {
  const { wallet, showApproval } = useWallet();
  const t = useMobileT();
  const overview = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  const options = useAsync(() => wallet.features.stakingOptions({ assetKey: props.assetKey }), [wallet, props.assetKey]);
  const asset = overview.data?.find((a) => a.assetKey === props.assetKey);
  const [optionId, setOptionId] = useState<string>();
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!optionId && options.data?.length) setOptionId(options.data.find((o) => o.recommended)?.id ?? options.data[0]!.id);
  }, [options.data, optionId]);

  if (overview.error || options.error) {
    return (
      <Screen back title={t("m.stake.title")}>
        <ErrorNote message={userMessageOf(overview.error ?? options.error)} />
      </Screen>
    );
  }
  if (!asset || !options.data) {
    return (
      <Screen back title={t("m.stake.title")}>
        <Spinner />
      </Screen>
    );
  }
  const typed = amount.trim();
  const canonical = typed ? canonicalAmount(typed) : null;
  const amountBad = !asset.wholeBalance && typed !== "" && (canonical === null || canonical === undefined || parseUnits(canonical, 18) === null);
  // Tezos: an empty amount only delegates (the whole balance counts, nothing is locked).
  const delegateOnly = !!asset.amountOptional && typed === "";

  async function submit() {
    setErr(null);
    if (!asset!.wholeBalance && ((!typed && !asset!.amountOptional) || amountBad)) return setErr(t("m.stake.amountMissing"));
    setBusy(true);
    try {
      const q = await wallet.features.stake({ assetKey: props.assetKey, optionId, amount: asset!.wholeBalance || !typed ? undefined : canonical! });
      showApproval(q.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      back
      title={t("m.stake.stakeSymbol", { symbol: asset.symbol })}
      footer={
        <Button block disabled={busy} onPress={() => void submit()} testID="stake-submit">
          {asset.wholeBalance || delegateOnly
            ? t("m.stake.stakeAll", { symbol: asset.symbol })
            : typed
              ? t("m.stake.stakeAmount", { amount: typed, symbol: asset.symbol })
              : t("m.stake.stakeSymbol", { symbol: asset.symbol })}
        </Button>
      }
    >
      <T v="lede">{asset.howItWorks}</T>
      {!asset.wholeBalance && (
        <Field
          label={asset.amountOptional ? t("m.stake.amountOptional") : t("m.stake.amount")}
          keyboardType="decimal-pad"
          placeholder="0"
          value={amount}
          onChangeText={setAmount}
          testID="stake-amount"
          error={amountBad ? t("m.stake.amountBad") : null}
          hint={asset.amountOptional ? t("m.stake.amountOptionalHint", { symbol: asset.symbol }) : undefined}
        />
      )}
      <T v="h2">{t("m.stake.where")}</T>
      <Choices
        label={t("m.stake.whereLabel")}
        testID="stake-option"
        value={optionId}
        onChange={setOptionId}
        options={options.data.map((o) => ({ value: o.id, title: o.title, hint: o.detail, badge: o.recommended ? t("m.stake.pickedForYou") : undefined }))}
      />
      <ErrorNote message={err} />
    </Screen>
  );
}
