/**
 * Swap in assets ("100 USDC for ETH"): the extension's Swap (packages/ui/src/features/Swap.tsx) in React Native.
 * The wallet finds where; a network only shows in Advanced mode.
 */
import { useMemo, useState } from "react";
import { formatUnits, mergeBalances, userMessageOf, type SwapQuoteView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, Notice, Pills, Row, Screen, Spinner, Steps, T, Warnings } from "../ui/kit";

const SLIPPAGE = [
  { value: 50, label: "0.5%" },
  { value: 100, label: "1%" },
  { value: 300, label: "3%" },
];

export function Swap(props: { sell?: string; buy?: string }) {
  const { client, wallet, state, showApproval } = useWallet();
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
    if (!/^\d+(\.\d+)?$/.test(amount.trim())) return setErr("Enter an amount like 25 or 0.5.");
    setBusy(true);
    try {
      setQuote(await wallet.features.swapQuote({ sell: sellKey, buy: buyKey, amount: amount.trim(), slippageBps }));
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
        return setErr("This price expired. Get a new one.");
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
      <Screen back title="Swap">
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title="Swap"
      footer={
        quote?.executable ? (
          <Button block disabled={busy} onPress={() => void swap()} testID="swap-execute">
            {quote.steps.length > 1 ? "Review and swap" : "Swap"}
          </Button>
        ) : (
          <Button block disabled={busy || !sellKey || !buyKey} onPress={() => void getPrice()} testID="swap-quote">
            {busy ? "Getting the best price…" : "Get price"}
          </Button>
        )
      }
    >
      <Pills label="You pay with" testID="swap-sell" value={sellKey} onChange={(v) => (setSell(v), reset())} options={held.map((h) => ({ value: h.key, label: h.symbol }))} />
      <Field
        label="Amount"
        keyboardType="decimal-pad"
        placeholder="0"
        testID="swap-amount"
        value={amount}
        onChangeText={(t) => (setAmount(t), reset())}
        hint={sellAsset ? `You have ${formatUnits(sellAsset.amount, sellAsset.decimals, 4)} ${sellAsset.symbol}` : undefined}
      />
      <Pills label="You get" testID="swap-buy" value={buyKey} onChange={(v) => (setBuy(v), reset())} options={buyable.filter((b) => b.key !== sellKey).map((b) => ({ value: b.key, label: b.symbol }))} />
      <Pills label="Price can move by" testID="swap-slippage" value={slippageBps} onChange={(v) => (setSlippage(v), reset())} options={SLIPPAGE} />
      <T v="hint">If the price moves more than this before the swap runs, it stops and nothing is swapped.</T>

      {quote && (
        <Card>
          <T v="h1" style={{ fontSize: 20 }} testID="swap-you-get">
            {quote.youGet}
          </T>
          <T v="hint">{quote.atLeast}</T>
          <Row label="You pay" value={quote.sell.display} />
          <Row label="Route" value={quote.route} />
          {quote.priceImpactPct !== undefined && <Row label="Price impact" value={`${quote.priceImpactPct.toFixed(2)}%`} />}
          {state?.prefs.advanced && <Row label="Network" value={quote.networkId} />}
          {quote.steps.length > 1 && <Steps label="What you'll approve" items={quote.steps} />}
          <Warnings warnings={quote.warnings} />
          {quote.note ? <Notice level="info">{quote.note}</Notice> : null}
        </Card>
      )}
      <ErrorNote message={err} />
    </Screen>
  );
}
