import { useEffect, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import { parseUnits } from "../lib/format";
import type { StakeAssetView, StakePositionView } from "./client";
import { useFeatures } from "./context";

const ACTION_LABEL: Record<StakePositionView["actions"][number], string> = {
  unstake: "Unstake",
  withdraw: "Move to balance",
  claim: "Collect rewards",
  change: "Change",
};

/** Staking overview: one card per coin you can stake. No network names; the wallet picks. */
export function StakeHome() {
  const features = useFeatures();
  const { navigate } = useRouter();
  const { data, error, reload } = useAsync(() => features.stakingOverview(), [features]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(a: StakeAssetView, p: StakePositionView, action: StakePositionView["actions"][number]) {
    if (action === "change") return navigate(`/stake?asset=${encodeURIComponent(a.assetKey)}`);
    setBusy(p.id + action);
    setErr(null);
    try {
      const q = await features.stakeAction({ assetKey: a.assetKey, positionId: p.id, action });
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <Screen back title="Stake">
      <p className="clip-lede">Earn rewards on coins you hold. You stay in control the whole time.</p>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title="Nothing to stake yet">Coins you can stake show up here.</Empty>}
      {data?.map((a) => (
        <Card key={a.assetKey}>
          <div className="clip-row">
            <span className="clip-row__label">
              <strong>{a.symbol}</strong> {a.rewardRate && <Chip tone="accent">{a.rewardRate}</Chip>}
            </span>
            <span className="clip-row__value">
              {!a.unavailable && (
                <Button variant="secondary" onClick={() => navigate(`/stake?asset=${encodeURIComponent(a.assetKey)}`)}>
                  {a.positions.length > 0 && a.wholeBalance ? "Change" : `Stake ${a.symbol}`}
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
                <span className="clip-row__label">With</span>
                <span className="clip-row__value">{p.with}</span>
              </div>
              {p.pendingReward && (
                <div className="clip-row">
                  <span className="clip-row__label">Rewards on the way</span>
                  <span className="clip-row__value">{p.pendingReward.display}</span>
                </div>
              )}
              {p.actions.length > 0 && (
                <div className="clip-actions">
                  {p.actions.map((action) => (
                    <Button key={action} variant={action === "unstake" ? "ghost" : "secondary"} disabled={busy !== null} onClick={() => void act(a, p, action)}>
                      {ACTION_LABEL[action]}
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
      <Screen back title="Stake">
        <ErrorNote message={userMessageOf(overview.error ?? options.error)} />
      </Screen>
    );
  }
  if (!asset || !options.data) {
    return (
      <Screen back title="Stake">
        <Spinner />
      </Screen>
    );
  }
  const amountBad = !asset.wholeBalance && amount !== "" && parseUnits(amount, 18) === null;

  async function submit() {
    setErr(null);
    if (!asset!.wholeBalance && (!amount || amountBad)) return setErr("Enter how much to stake.");
    setBusy(true);
    try {
      const q = await features.stake({ assetKey: props.assetKey, optionId, amount: asset!.wholeBalance ? undefined : amount });
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title={`Stake ${asset.symbol}`}>
      <p className="clip-lede">{asset.howItWorks}</p>
      {!asset.wholeBalance && (
        <Field label="Amount" inputMode="decimal" placeholder="0" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountBad ? "Enter an amount like 2 or 0.5." : null} />
      )}
      <h2 className="clip-h2">Where</h2>
      <ul className="clip-list" aria-label="Where to stake">
        {options.data.map((o) => (
          <li key={o.id}>
            <label className="clip-select-row">
              <input type="radio" name="stake-option" checked={optionId === o.id} onChange={() => setOptionId(o.id)} />
              <span className="clip-asset-row__main">
                <span className="clip-asset-row__symbol">
                  {o.title} {o.recommended && <Chip tone="accent">Picked for you</Chip>}
                </span>
                <span className="clip-asset-row__name">{o.detail}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorNote message={err} />
      <Button block disabled={busy} onClick={() => void submit()}>
        {asset.wholeBalance ? `Stake my ${asset.symbol}` : `Stake ${amount || ""} ${asset.symbol}`.replace(/\s+/g, " ")}
      </Button>
    </Screen>
  );
}
