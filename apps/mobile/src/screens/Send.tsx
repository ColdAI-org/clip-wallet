/**
 * Send: who + how much. The network is inferred from the address; only when several networks fit and nothing
 * tells them apart do we ask (the "network-matters" prompt), once, in plain words, and remember the answer.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { formatFiat, formatUnits, mergeBalances, parseUnits, shortAddress, userMessageOf, type RecipientResolution } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, ErrorNote, Field, LinkButton, Notice, Screen, Spinner, T } from "../ui/kit";

type Phase = { p: "form" } | { p: "ask"; res: Extract<RecipientResolution, { kind: "ask" }> } | { p: "sending" };

export function Send(props: { assetKey?: string; initialTo?: string }) {
  const { client, state, theme, showApproval, back } = useWallet();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const assets = useMemo(() => mergeBalances(data?.balances ?? [], { pinned: state?.prefs.pinned }).assets, [data, state?.prefs.pinned]);
  const [assetId, setAssetId] = useState("");
  const [to, setTo] = useState(props.initialTo ?? "");
  const [amount, setAmount] = useState("");
  const [phase, setPhase] = useState<Phase>({ p: "form" });
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState("");
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    if (!assetId && assets.length) setAssetId(assets.find((a) => a.key === props.assetKey && !a.bridged)?.id ?? assets[0]!.id);
  }, [assets, assetId, props.assetKey]);

  const asset = assets.find((a) => a.id === assetId);
  const currency = data?.currency ?? "USD";
  const parsed = asset ? parseUnits(amount, asset.decimals) : null;
  const tooMuch = asset && parsed !== null ? parsed > BigInt(asset.amount) : false;
  const amountErr = amount && parsed === null ? "Enter an amount like 25 or 0.5." : tooMuch ? `You have ${formatUnits(asset!.amount, asset!.decimals)} ${asset!.symbol}.` : null;
  const fiatPreview = asset && parsed !== null && asset.fiatValue !== undefined && BigInt(asset.amount) > 0n ? (Number(parsed) / Number(BigInt(asset.amount))) * asset.fiatValue : undefined;

  const submit = async (networkId: string, address: string) => {
    if (!asset) return;
    setPhase({ p: "sending" });
    try {
      const id = await client.send({ assetKey: asset.key, networkId, to: address, amount });
      back();
      showApproval(id);
    } catch (e) {
      setErr(userMessageOf(e));
      setPhase({ p: "form" });
    }
  };

  const onContinue = async () => {
    if (!asset) return;
    setErr(null);
    try {
      const res = await client.resolveRecipient({ input: to.trim(), assetKey: asset.key });
      if (res.kind === "invalid") setErr(res.message);
      else if (res.kind === "resolved") await submit(res.networkId, res.address);
      else {
        setChoice("");
        setPhase({ p: "ask", res });
      }
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  if (!data) return <Screen back title="Send"><Spinner /></Screen>;
  if (!assets.length) {
    return (
      <Screen back title="Send">
        <T v="lede">There's nothing to send yet. Receive some test coins first.</T>
      </Screen>
    );
  }

  if (phase.p === "ask" && asset) {
    const res = phase.res;
    return (
      <Screen
        back={() => setPhase({ p: "form" })}
        title="Send"
        footer={
          <Button
            block
            testID="ask-continue"
            disabled={!choice}
            onPress={async () => {
              await client.rememberRecipientNetwork({ address: res.address, assetKey: asset.key, networkId: choice });
              await submit(choice, res.address);
            }}
          >
            Continue
          </Button>
        }
      >
        <T v="h1">{`Where should the ${asset.symbol} arrive?`}</T>
        <T v="lede">
          {`${res.displayName ?? shortAddress(res.address, 6)} can receive ${asset.symbol} in more than one place. If it's an exchange or someone else's wallet, ask them which network to use — sending to the wrong one can lose the money.`}
        </T>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {res.candidates.map((c) => {
            const on = choice === c.network.id;
            return (
              <Pressable
                key={c.network.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                testID={`network-${c.network.id}`}
                onPress={() => setChoice(c.network.id)}
                style={{ borderWidth: on ? 2 : 1, borderColor: on ? theme.c.accent : theme.c.border, borderRadius: theme.r.md, padding: 14, gap: 4, backgroundColor: theme.c.surface }}
              >
                <T style={{ fontWeight: "600" }}>{c.network.name}</T>
                <T v="hint">{BigInt(c.balance) > 0n ? `You have ${formatUnits(c.balance, asset.decimals, 4)} ${asset.symbol} there` : `We'll move your ${asset.symbol} there for you`}</T>
              </Pressable>
            );
          })}
        </View>
        <T v="hint">{`We'll remember this for ${res.displayName ?? "this address"} so you won't be asked again.`}</T>
        <ErrorNote message={err} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title="Send"
      footer={
        <Button block testID="review" onPress={onContinue} disabled={!asset || !to.trim() || parsed === null || parsed === 0n || tooMuch || phase.p === "sending"}>
          {phase.p === "sending" ? "Preparing…" : "Review"}
        </Button>
      }
    >
      <View style={{ gap: 6 }}>
        <T v="label">What</T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Asset to send"
          testID="asset-picker"
          onPress={() => setPicking((p) => !p)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.c.surface, borderRadius: theme.r.md, borderWidth: 1, borderColor: theme.c.border, padding: 12 }}
        >
          {asset && <AssetIcon symbol={asset.symbol} size={28} />}
          <T style={{ flex: 1, fontWeight: "600" }}>{asset ? `${asset.symbol}${asset.bridged ? " (bridged)" : ""}` : "Choose"}</T>
          <T v="hint">{asset ? formatFiat(asset.fiatValue, currency) : ""}</T>
        </Pressable>
        {picking &&
          assets.map((a) => (
            <Pressable key={a.id} onPress={() => (setAssetId(a.id), setPicking(false))} style={{ flexDirection: "row", gap: 10, padding: 10, alignItems: "center" }}>
              <AssetIcon symbol={a.symbol} size={24} />
              <T style={{ flex: 1 }}>{`${a.symbol}${a.bridged ? " (bridged)" : ""}`}</T>
              <T v="hint">{formatFiat(a.fiatValue, currency)}</T>
            </Pressable>
          ))}
      </View>
      <Field label="To" placeholder="Name or address" autoCapitalize="none" autoComplete="off" spellCheck={false} value={to} testID="to" onChangeText={(t) => (setTo(t), setErr(null))} />
      <Field
        label="Amount"
        keyboardType="decimal-pad"
        placeholder="0"
        value={amount}
        testID="amount"
        onChangeText={setAmount}
        error={amountErr}
        hint={fiatPreview !== undefined ? `≈ ${formatFiat(fiatPreview, currency)}` : asset ? `You have ${formatUnits(asset.amount, asset.decimals, 4)} ${asset.symbol}` : undefined}
        trailing={asset && <LinkButton onPress={() => setAmount(formatUnits(asset.amount, asset.decimals, asset.decimals).replace(/,/g, ""))}>Max</LinkButton>}
      />
      <ErrorNote message={err} />
      {phase.p === "sending" && <Notice level="info">Preparing your request…</Notice>}
    </Screen>
  );
}
