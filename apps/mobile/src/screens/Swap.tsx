/**
 * Swap in assets ("100 USDC for ETH"): the extension's Swap (packages/ui/src/features/Swap.tsx) in React Native.
 * The wallet finds where; a network only shows in Advanced mode.
 */
import { useMemo, useState } from "react";
import { canonicalAmount, formatUnits, mergeBalances, userMessageOf, type SwapQuoteView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, Notice, Pills, Row, Screen, Spinner, Steps, T, Warnings } from "../ui/kit";
import { useFormat, useMobileT } from "../i18n";

/** Basis points; shown as locale percentages ("0,5 %" in German). */
const SLIPPAGE = [50, 100, 300];

export function Swap(props: { sell?: string; buy?: string }) {
  const { client, wallet, state, showApproval } = useWallet();
  const t = useMobileT();
  const f = useFormat();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const held = useMemo(() => mergeBalances(data?.balances ?? []).assets.filter((a) => !a.spam), [data]);
  const buyable = useMemo(() => {
    const seen = new Map<string, { key: string; symbol: string }>();
    for (const a of data?.assets ?? []) if (!a.spam && !seen.has(a.key)) seen.set(a.key, { key: a.key, symbol: a.symbol });
    for (const h of held) if (!seen.has(h.key)) seen.set(h.key, { key: h.key, symbol: h.symbol });
    return [...seen.values()];
  }, [data, held]);

  const [sell, setSell] = useState(props.sell ?? "");
  const [buy, setBuy] = useState(props.buy ?? "");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippage] = useState(50);
  const [quote, setQuote] = useState<SwapQuoteView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sellKey = sell || held[0]?.key || "";
  const buyKey = (buy && buy !== sellKey ? buy : "") || buyable.find((b) => b.key !== sellKey)?.key || "";
  const sellAsset = held.find((h) => h.key === sellKey);
  const reset = () => setQuote(null);

  async function getPrice() {
    setErr(null);
    setQuote(null);
    // "0,5" and "0.5" are both half (the amount rule shared with Send); the background gets "0.5".
    const value = canonicalAmount(amount);
    if (!value || !/^\d+(\.\d+)?$/.test(value)) return setErr(t("m.swap.amountBad"));
    setBusy(true);
    try {
      setQuote(await wallet.features.swapQuote({ sell: sellKey, buy: buyKey, amount: value, slippageBps }));
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function swap() {
    if (!quote) return;
    setBusy(true);
    setErr(null);
    try {
      if (Date.now() > quote.expiresAt + 30_000) {
        setQuote(null);
        return setErr(t("m.swap.expired"));
      }
      const q = await wallet.features.swapExecute({ quoteId: quote.id });
      showApproval(q.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <Screen back title={t("m.swap.title")}>
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t("m.swap.title")}
      footer={
        quote?.executable ? (
          <Button block disabled={busy} onPress={() => void swap()} testID="swap-execute">
            {quote.steps.length > 1 ? t("m.swap.reviewAndSwap") : t("m.swap.swap")}
          </Button>
        ) : (
          <Button block disabled={busy || !sellKey || !buyKey} onPress={() => void getPrice()} testID="swap-quote">
            {busy ? t("m.swap.gettingPrice") : t("m.swap.getPrice")}
          </Button>
        )
      }
    >
      <Pills label={t("m.swap.payWith")} testID="swap-sell" value={sellKey} onChange={(v) => (setSell(v), reset())} options={held.map((h) => ({ value: h.key, label: h.symbol }))} />
      <Field
        label={t("m.swap.amount")}
        keyboardType="decimal-pad"
        placeholder="0"
        testID="swap-amount"
        value={amount}
        onChangeText={(v) => (setAmount(v), reset())}
        hint={sellAsset ? t("m.swap.youHave", { amount: formatUnits(sellAsset.amount, sellAsset.decimals, 4), symbol: sellAsset.symbol }) : undefined}
      />
      <Pills label={t("m.swap.youGet")} testID="swap-buy" value={buyKey} onChange={(v) => (setBuy(v), reset())} options={buyable.filter((b) => b.key !== sellKey).map((b) => ({ value: b.key, label: b.symbol }))} />
      <Pills label={t("m.swap.slippage")} testID="swap-slippage" value={slippageBps} onChange={(v) => (setSlippage(v), reset())} options={SLIPPAGE.map((bps) => ({ value: bps, label: f.percent(bps / 100, { maxFraction: 1 }) }))} />
      <T v="hint">{t("m.swap.slippageHint")}</T>

      {quote && (
        <Card>
          <T v="h1" style={{ fontSize: 20 }} testID="swap-you-get">
            {quote.youGet}
          </T>
          <T v="hint">{quote.atLeast}</T>
          <Row label={t("m.swap.youPay")} value={quote.sell.display} />
          <Row label={t("m.swap.route")} value={quote.route} />
          {quote.priceImpactPct !== undefined && <Row label={t("m.swap.priceImpact")} value={f.percent(quote.priceImpactPct, { maxFraction: 2 })} />}
          {state?.prefs.advanced && <Row label={t("m.swap.network")} value={quote.networkId} />}
          {quote.steps.length > 1 && <Steps label={t("m.swap.whatYouApprove")} items={quote.steps} />}
          <Warnings warnings={quote.warnings} />
          {quote.note ? <Notice level="info">{quote.note}</Notice> : null}
        </Card>
      )}
      <ErrorNote message={err} />
    </Screen>
  );
}
