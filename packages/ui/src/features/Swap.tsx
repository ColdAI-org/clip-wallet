import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Row, Screen, Spinner, Warnings } from "../components";
import { formatUnits } from "../lib/format";
import { mergeBalances } from "../lib/portfolio";
import type { SwapQuoteView } from "./client";
import { useFeatures } from "./context";

const SLIPPAGE = [
  { bps: 50, label: "0.5%" },
  { bps: 100, label: "1%" },
  { bps: 300, label: "3%" },
];

/** Swap in assets: "100 USDC for ETH". The wallet finds where; a network only shows in Advanced mode. */
export function Swap(props: { sell?: string; buy?: string }) {
  const { client, state } = useUi();
  const features = useFeatures();
  const { navigate } = useRouter();
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
  const buyKey = buy || buyable.find((b) => b.key !== sellKey)?.key || "";
  const sellAsset = held.find((h) => h.key === sellKey);

  async function getPrice() {
    setErr(null);
    setQuote(null);
    if (!/^\d+(\.\d+)?$/.test(amount.trim())) return setErr("Enter an amount like 25 or 0.5.");
    setBusy(true);
    try {
      setQuote(await features.swapQuote({ sell: sellKey, buy: buyKey, amount: amount.trim(), slippageBps }));
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
      const q = await features.swapExecute({ quoteId: quote.id });
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
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
    <Screen back title="Swap">
      <div className="clip-stack">
        <label className="clip-field">
          <span className="clip-field__label">You pay with</span>
          <select className="clip-select" aria-label="Asset to swap" value={sellKey} onChange={(e) => { setSell(e.target.value); setQuote(null); }}>
            {held.map((h) => (
              <option key={h.key} value={h.key}>
                {h.symbol}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Amount"
          inputMode="decimal"
          placeholder="0"
          autoComplete="off"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          hint={sellAsset ? `You have ${formatUnits(sellAsset.amount, sellAsset.decimals, 4)} ${sellAsset.symbol}` : undefined}
        />
        <label className="clip-field">
          <span className="clip-field__label">You get</span>
          <select className="clip-select" aria-label="Asset to get" value={buyKey} onChange={(e) => { setBuy(e.target.value); setQuote(null); }}>
            {buyable.filter((b) => b.key !== sellKey).map((b) => (
              <option key={b.key} value={b.key}>
                {b.symbol}
              </option>
            ))}
          </select>
        </label>
        <div className="clip-segmented" role="radiogroup" aria-label="Price can move by">
          {SLIPPAGE.map((s) => (
            <button key={s.bps} type="button" role="radio" aria-checked={slippageBps === s.bps} className={slippageBps === s.bps ? "is-active" : ""} onClick={() => { setSlippage(s.bps); setQuote(null); }}>
              {s.label}
            </button>
          ))}
        </div>
        <p className="clip-hint">If the price moves more than this before the swap runs, it stops and nothing is swapped.</p>
      </div>

      {quote && (
        <Card>
          <p className="clip-h2" data-testid="swap-you-get">{quote.youGet}</p>
          <p className="clip-hint">{quote.atLeast}</p>
          <div className="clip-rows">
            <Row label="You pay" value={quote.sell.display} />
            <Row label="Route" value={quote.route} />
            {quote.priceImpactPct !== undefined && <Row label="Price impact" value={`${quote.priceImpactPct.toFixed(2)}%`} />}
            {state?.prefs.advanced && <Row label="Network" value={quote.networkId} />}
          </div>
          {quote.steps.length > 1 && (
            <ol className="clip-steps" aria-label="What you'll approve">
              {quote.steps.map((s, i) => (
                <li key={s + i}>{s}</li>
              ))}
            </ol>
          )}
          <Warnings warnings={quote.warnings} />
          {quote.note && <p className="clip-notice clip-notice--info">{quote.note}</p>}
        </Card>
      )}
      <ErrorNote message={err} />
      {quote?.executable ? (
        <Button block disabled={busy} onClick={() => void swap()}>
          {quote.steps.length > 1 ? "Review and swap" : "Swap"}
        </Button>
      ) : (
        <Button block disabled={busy || !sellKey || !buyKey} onClick={() => void getPrice()}>
          {busy ? "Getting the best price…" : "Get price"}
        </Button>
      )}
    </Screen>
  );
}
