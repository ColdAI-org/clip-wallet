/**
 * Stake: the extension's StakeHome / StakeAsset (packages/ui/src/features/Stake.tsx) in React Native. Every
 * provider the engine's StakingService exposes shows up (live ones: HBAR node staking, SOL native staking;
 * the rest say "coming soon" in plain words). No network names: the wallet picks where.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import { parseUnits, userMessageOf, type StakeAssetView, type StakePositionView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, Choices, Empty, ErrorNote, Field, Row, Screen, Spinner, T } from "../ui/kit";

const ACTION_LABEL: Record<StakePositionView["actions"][number], string> = {
  unstake: "Unstake",
  withdraw: "Move to balance",
  claim: "Collect rewards",
  change: "Change",
};

export function Stake(props: { assetKey?: string }) {
  return props.assetKey ? <StakeAsset assetKey={props.assetKey} /> : <StakeHome />;
}

export function StakeHome() {
  const { wallet, navigate, showApproval } = useWallet();
  const { data, error, reload } = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(a: StakeAssetView, p: StakePositionView, action: StakePositionView["actions"][number]) {
    if (action === "change") return navigate({ name: "stake", assetKey: a.assetKey });
    setBusy(p.id + action);
    setErr(null);
    try {
      const q = await wallet.features.stakeAction({ assetKey: a.assetKey, positionId: p.id, action });
      showApproval(q.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(null);
      reload();
    }
  }

  return (
    <Screen back title="Stake">
      <T v="lede">Earn rewards on coins you hold. You stay in control the whole time.</T>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title="Nothing to stake yet">Coins you can stake show up here.</Empty>}
      {data?.map((a) => (
        <Card key={a.assetKey}>
          <View testID={`stake-asset-${a.assetKey}`} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T style={{ fontWeight: "600" }}>{a.symbol}</T>
            {a.rewardRate ? <Chip tone="accent">{a.rewardRate}</Chip> : null}
            <View style={{ flex: 1 }} />
            {!a.unavailable && (
              <Button variant="secondary" style={{ flex: 0 }} testID={`stake-open-${a.assetKey}`} onPress={() => navigate({ name: "stake", assetKey: a.assetKey })}>
                {a.positions.length > 0 && a.wholeBalance ? "Change" : `Stake ${a.symbol}`}
              </Button>
            )}
          </View>
          {a.unavailable ? <T v="hint">{a.unavailable.message}</T> : null}
          {a.positions.map((p) => (
            <View key={p.id} testID="stake-position" style={{ gap: 2 }}>
              <Row label={p.amountDisplay} value={p.statusText} />
              <Row label="With" value={p.with} />
              {p.pendingReward ? <Row label="Rewards on the way" value={p.pendingReward.display} /> : null}
              {p.actions.length > 0 && (
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  {p.actions.map((action) => (
                    <Button key={action} variant={action === "unstake" ? "ghost" : "secondary"} disabled={busy !== null} testID={`stake-${action}`} onPress={() => void act(a, p, action)}>
                      {ACTION_LABEL[action]}
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
      const q = await wallet.features.stake({ assetKey: props.assetKey, optionId, amount: asset!.wholeBalance ? undefined : amount.trim() });
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
      title={`Stake ${asset.symbol}`}
      footer={
        <Button block disabled={busy} onPress={() => void submit()} testID="stake-submit">
          {asset.wholeBalance ? `Stake my ${asset.symbol}` : `Stake ${amount || ""} ${asset.symbol}`.replace(/\s+/g, " ")}
        </Button>
      }
    >
      <T v="lede">{asset.howItWorks}</T>
      {!asset.wholeBalance && (
        <Field label="Amount" keyboardType="decimal-pad" placeholder="0" value={amount} onChangeText={setAmount} testID="stake-amount" error={amountBad ? "Enter an amount like 2 or 0.5." : null} />
      )}
      <T v="h2">Where</T>
      <Choices
        label="Where to stake"
        testID="stake-option"
        value={optionId}
        onChange={setOptionId}
        options={options.data.map((o) => ({ value: o.id, title: o.title, hint: o.detail, badge: o.recommended ? "Picked for you" : undefined }))}
      />
      <ErrorNote message={err} />
    </Screen>
  );
}
