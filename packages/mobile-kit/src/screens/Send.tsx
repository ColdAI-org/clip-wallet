/**
 * Send: who + how much. The network is inferred from the address; only when several networks fit and nothing
 * tells them apart do we ask (the "network-matters" prompt), once, in plain words, and remember the answer.
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { Family } from "@clip-wallet/core";
import { amountInput, canonicalAmount, formatFiat, formatUnits, mergeBalances, parseUnits, shortAddress, userMessageOf, type RecipientResolution } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, ErrorNote, Field, LinkButton, Notice, Screen, Spinner, T } from "../ui/kit";
import { useMobileT } from "../i18n";
import { ContactSuggestions } from "./Contacts";

type Phase = { p: "form" } | { p: "ask"; res: Extract<RecipientResolution, { kind: "ask" }> } | { p: "sending" };

export function Send(props: { assetKey?: string; initialTo?: string }) {
  const { client, state, theme, showApproval, back } = useWallet();
  const t = useMobileT();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const assets = useMemo(() => mergeBalances(data?.balances ?? [], { pinned: state?.prefs.pinned }).assets, [data, state?.prefs.pinned]);
  const [assetId, setAssetId] = useState("");
  const [to, setTo] = useState(props.initialTo ?? "");
  const [contactName, setContactName] = useState<string | null>(null);
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
  // The asset's family, when all its networks share one (USDC on EVM and Solana: no filter).
  const family = useMemo<Family | undefined>(() => {
    if (!asset || !data) return undefined;
    const fams = new Set(data.balances.filter((b) => b.asset.key === asset.key).map((b) => data.networks.find((n) => n.id === b.asset.networkId)?.family));
    return fams.size === 1 ? ([...fams][0] as Family | undefined) : undefined;
  }, [asset, data]);
  const parsed = asset ? parseUnits(amount, asset.decimals) : null;
  const tooMuch = asset && parsed !== null ? parsed > BigInt(asset.amount) : false;
  const amountErr = amount && parsed === null ? t("m.send.amountBad") : tooMuch ? t("m.send.youHaveOnly", { amount: formatUnits(asset!.amount, asset!.decimals), symbol: asset!.symbol }) : null;
  const fiatPreview = asset && parsed !== null && asset.fiatValue !== undefined && BigInt(asset.amount) > 0n ? (Number(parsed) / Number(BigInt(asset.amount))) * asset.fiatValue : undefined;

  const submit = async (networkId: string, address: string) => {
    if (!asset) return;
    const canonical = canonicalAmount(amount);
    if (!canonical) return setErr(t("m.send.amountBad"));
    setPhase({ p: "sending" });
    try {
      const id = await client.send({ assetKey: asset.key, networkId, to: address, amount: canonical });
      back();
      showApproval(id);
    } catch (e) {
      setErr(userMessageOf(e));
      setPhase({ p: "form" });
    }
  };

  const typed = to.trim();

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

  if (!data) return <Screen back title={t("m.send.title")}><Spinner /></Screen>;
  if (!assets.length) {
    return (
      <Screen back title={t("m.send.title")}>
        <T v="lede">{t("m.send.nothing")}</T>
      </Screen>
    );
  }

  if (phase.p === "ask" && asset) {
    const res = phase.res;
    const who = contactName ?? res.displayName;
    return (
      <Screen
        back={() => setPhase({ p: "form" })}
        title={t("m.send.title")}
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
            {t("m.common.continue")}
          </Button>
        }
      >
        <T v="h1">{t("m.send.ask.title", { symbol: asset.symbol })}</T>
        <T v="lede">{t("m.send.ask.lede", { who: who ?? shortAddress(res.address, 6), symbol: asset.symbol })}</T>
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
                <T v="hint">{BigInt(c.balance) > 0n ? t("m.send.ask.haveThere", { amount: formatUnits(c.balance, asset.decimals, 4), symbol: asset.symbol }) : t("m.send.ask.moveThere", { symbol: asset.symbol })}</T>
              </Pressable>
            );
          })}
        </View>
        <T v="hint">{who ? t("m.send.ask.rememberName", { name: who }) : t("m.send.ask.rememberAddress")}</T>
        <ErrorNote message={err} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t("m.send.title")}
      footer={
        <Button block testID="review" onPress={onContinue} disabled={!asset || !to.trim() || parsed === null || parsed === 0n || tooMuch || phase.p === "sending"}>
          {phase.p === "sending" ? t("m.send.preparing") : t("m.send.review")}
        </Button>
      }
    >
      <View style={{ gap: 6 }}>
        <T v="label">{t("m.send.what")}</T>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("m.send.assetLabel")}
          testID="asset-picker"
          onPress={() => setPicking((p) => !p)}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.c.surface, borderRadius: theme.r.md, borderWidth: 1, borderColor: theme.c.border, padding: 12 }}
        >
          {asset && <AssetIcon symbol={asset.symbol} size={28} />}
          <T style={{ flex: 1, fontWeight: "600" }}>{asset ? (asset.bridged ? t("m.send.assetBridged", { symbol: asset.symbol }) : asset.symbol) : t("m.send.choose")}</T>
          <T v="hint">{asset ? formatFiat(asset.fiatValue, currency) : ""}</T>
        </Pressable>
        {picking &&
          assets.map((a) => (
            <Pressable key={a.id} onPress={() => (setAssetId(a.id), setPicking(false))} style={{ flexDirection: "row", gap: 10, padding: 10, alignItems: "center" }}>
              <AssetIcon symbol={a.symbol} size={24} />
              <T style={{ flex: 1 }}>{a.bridged ? t("m.send.assetBridged", { symbol: a.symbol }) : a.symbol}</T>
              <T v="hint">{formatFiat(a.fiatValue, currency)}</T>
            </Pressable>
          ))}
      </View>
      <Field
        label={t("m.send.to")}
        placeholder={t("m.send.toPlaceholder")}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        value={to}
        testID="to"
        onChangeText={(v) => (setTo(v), setContactName(null), setErr(null))}
        hint={contactName ? t("m.send.toContact", { name: contactName }) : undefined}
      />
      {!contactName && typed.length > 0 && typed.length < 60 && (
        <ContactSuggestions
          query={typed}
          {...(family ? { family } : {})}
          onPick={(address, name) => {
            setTo(address);
            setContactName(name);
            setErr(null);
          }}
        />
      )}
      <Field
        label={t("m.send.amount")}
        keyboardType="decimal-pad"
        placeholder="0"
        value={amount}
        testID="amount"
        onChangeText={setAmount}
        error={amountErr}
        hint={fiatPreview !== undefined ? t("m.send.approx", { value: formatFiat(fiatPreview, currency) }) : asset ? t("m.send.youHave", { amount: formatUnits(asset.amount, asset.decimals, 4), symbol: asset.symbol }) : undefined}
        trailing={asset && <LinkButton onPress={() => setAmount(amountInput(asset.amount, asset.decimals))}>{t("m.common.max")}</LinkButton>}
      />
      <ErrorNote message={err} />
      {phase.p === "sending" && <Notice level="info">{t("m.send.preparingRequest")}</Notice>}
    </Screen>
  );
}
