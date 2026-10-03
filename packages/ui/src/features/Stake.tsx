import { useEffect, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import { canonicalAmount, parseUnits } from "../lib/format";
import { useUiT, type UiMessageId } from "../i18n";
import type { StakeAssetView, StakePositionView } from "./client";
import { useFeatures } from "./context";

const ACTION_LABEL: Record<StakePositionView["actions"][number], UiMessageId> = {
  unstake: "stake.action.unstake",
  withdraw: "stake.action.withdraw",
  claim: "stake.action.claim",
  change: "stake.action.change",
};

/** Staking overview: one card per coin you can stake. No network names; the wallet picks. */
export function StakeHome() {
  const t = useUiT();
  const features = useFeatures();
  const { navigate } = useRouter();
  const { data, error, reload } = useAsync(() => features.stakingOverview(), [features]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** A position waiting for a claim choice (Cardano vote delegation) or a partial unstake amount. */
  const [pending, setPending] = useState<{ positionId: string; action: "claim" | "unstake" } | null>(null);
  const [choice, setChoice] = useState<string>();
  const [unstakeAmount, setUnstakeAmount] = useState("");

  async function act(a: StakeAssetView, p: StakePositionView, action: StakePositionView["actions"][number], extra: { choice?: string; amount?: string } = {}) {
    if (action === "change") return navigate(`/stake?asset=${encodeURIComponent(a.assetKey)}`);
    const needsChoice = action === "claim" && !!p.claimChoices?.length && !extra.choice;
    const offersAmount = action === "unstake" && p.partialUnstake && extra.amount === undefined;
    if (needsChoice || offersAmount) {
      setPending({ positionId: p.id, action });
      setChoice(p.claimChoices?.[0]?.id);
      setUnstakeAmount("");
      return;
    }
    setBusy(p.id + action);
    setErr(null);
    try {
      const params: { assetKey: string; positionId: string; action: typeof action; amount?: string; choice?: string } = { assetKey: a.assetKey, positionId: p.id, action };
      if (extra.choice) params.choice = extra.choice;
      if (extra.amount) params.amount = extra.amount;
      const q = await features.stakeAction(params);
      setPending(null);
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <Screen back title={t("stake.title")}>
      <p className="clip-lede">{t("stake.lede")}</p>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title={t("stake.empty.title")}>{t("stake.empty.body")}</Empty>}
      {data?.map((a) => (
        <Card key={a.assetKey}>
          <div className="clip-row">
            <span className="clip-row__label">
              <strong>{a.symbol}</strong> {a.rewardRate && <Chip tone="accent">{a.rewardRate}</Chip>}
            </span>
            <span className="clip-row__value">
              {!a.unavailable && (
                <Button variant="secondary" onClick={() => navigate(`/stake?asset=${encodeURIComponent(a.assetKey)}`)}>
                  {a.positions.length > 0 && a.wholeBalance ? t("stake.change") : t("stake.stakeSymbol", { symbol: a.symbol })}
                </Button>
              )}
            </span>
          </div>
          {a.unavailable && <p className="clip-hint">{a.unavailable.message}</p>}
          {a.positions.map((p) => (
            <div key={p.id} className="clip-rows" data-testid="stake-position">
              <div className="clip-row">
                <span className="clip-row__label">{p.amountDisplay}</span>
                <span className="clip-row__value">{p.statusText}</span>
              </div>
              <div className="clip-row">
                <span className="clip-row__label">{t("stake.with")}</span>
                <span className="clip-row__value">{p.with}</span>
              </div>
              {p.pendingReward && (
                <div className="clip-row">
                  <span className="clip-row__label">{t("stake.rewardsOnTheWay")}</span>
                  <span className="clip-row__value">{p.pendingReward.display}</span>
                </div>
              )}
              {pending?.positionId === p.id && pending.action === "claim" && p.claimChoices && (
                <fieldset className="clip-rows">
                  <legend className="clip-hint">To collect rewards, choose how your stake counts in community votes first.</legend>
                  <ul className="clip-list">
                    {p.claimChoices.map((c) => (
                      <li key={c.id}>
                        <label className="clip-select-row">
                          <input type="radio" name={`claim-${p.id}`} checked={choice === c.id} onChange={() => setChoice(c.id)} />
                          <span className="clip-asset-row__main">
                            <span className="clip-asset-row__symbol">{c.title}</span>
                            <span className="clip-asset-row__name">{c.detail}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <Button disabled={busy !== null || !choice} onClick={() => void act(a, p, "claim", { choice })}>
                    Collect rewards
                  </Button>
                </fieldset>
              )}
              {pending?.positionId === p.id && pending.action === "unstake" && (
                <div className="clip-rows">
                  <Field label="How much to unstake (leave empty for all)" inputMode="decimal" placeholder="All" autoComplete="off" value={unstakeAmount} onChange={(e) => setUnstakeAmount(e.target.value)} />
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void act(a, p, "unstake", { amount: unstakeAmount.trim() })}>
                    {unstakeAmount.trim() ? `Unstake ${unstakeAmount.trim()} ${a.symbol}` : `Unstake all ${a.symbol}`}
                  </Button>
                </div>
              )}
              {p.actions.length > 0 && (
                <div className="clip-actions">
                  {p.actions.map((action) => (
                    <Button key={action} variant={action === "unstake" ? "ghost" : "secondary"} disabled={busy !== null} onClick={() => void act(a, p, action)}>
                      {t(ACTION_LABEL[action])}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

/** "Stake SOL": how it works, where (picked for you), how much. */
export function StakeAsset(props: { assetKey: string }) {
  const t = useUiT();
  const features = useFeatures();
  const { navigate } = useRouter();
  const overview = useAsync(() => features.stakingOverview(), [features]);
  const options = useAsync(() => features.stakingOptions({ assetKey: props.assetKey }), [features, props.assetKey]);
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
      <Screen back title={t("stake.title")}>
        <ErrorNote message={userMessageOf(overview.error ?? options.error)} />
      </Screen>
    );
  }
  if (!asset || !options.data) {
    return (
      <Screen back title={t("stake.title")}>
        <Spinner />
      </Screen>
    );
  }
  const amountBad = !asset.wholeBalance && amount !== "" && parseUnits(amount, 18) === null;

  async function submit() {
    setErr(null);
    if (!asset!.wholeBalance && ((!amount.trim() && !asset!.amountOptional) || amountBad)) return setErr(t("stake.amountMissing"));
    setBusy(true);
    try {
      const q = await features.stake({ assetKey: props.assetKey, optionId, amount: asset!.wholeBalance || !amount.trim() ? undefined : canonicalAmount(amount)! });
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={t("stake.stakeSymbol", { symbol: asset.symbol })}>
      <p className="clip-lede">{asset.howItWorks}</p>
      {!asset.wholeBalance && (
        <Field label={asset.amountOptional ? t("stake.amountOptional") : t("stake.amount")} inputMode="decimal" placeholder="0" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountBad ? t("stake.amountBad") : null} />
      )}
      <h2 className="clip-h2">{t("stake.where")}</h2>
      <ul className="clip-list" aria-label={t("stake.whereLabel")}>
        {options.data.map((o) => (
          <li key={o.id}>
            <label className="clip-select-row">
              <input type="radio" name="stake-option" checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
              <span className="clip-asset-row__main">
                <span className="clip-asset-row__symbol">
                  {o.title} {o.recommended && <Chip tone="accent">{t("stake.pickedForYou")}</Chip>}
                </span>
                <span className="clip-asset-row__name">{o.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote message={err} />
      <Button block disabled={busy} onClick={() => void submit()}>
        {asset.wholeBalance || (asset.amountOptional && !amount.trim())
          ? t("stake.stakeAll", { symbol: asset.symbol })
          : amount.trim()
            ? t("stake.stakeAmount", { amount: amount.trim(), symbol: asset.symbol })
            : t("stake.stakeSymbol", { symbol: asset.symbol })}
      </Button>
    </Screen>
  );
}
