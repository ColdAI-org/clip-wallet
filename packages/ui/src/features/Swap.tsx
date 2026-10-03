import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Row, Screen, Spinner, Warnings } from "../components";
import { canonicalAmount, formatUnits } from "../lib/format";
import { useFormat, useUiT } from "../i18n";
import { mergeBalances } from "../lib/portfolio";
import type { SwapQuoteView } from "./client";
import { useFeatures } from "./context";

const SLIPPAGE = [50, 100, 300];

/** Swap in assets: "100 USDC for ETH". The wallet finds where; a network only shows in Advanced mode. */
export function Swap(props: { sell?: string; buy?: string; /** Discover: symbol for a token the wallet doesn't list yet ("token:<chain>:<address>"). */ buySymbol?: string }) {
  const t = useUiT();
  const f = useFormat();
  const { client, state } = useUi();
  const features = useFeatures();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const held = useMemo(() => mergeBalances(data?.balances ?? []).assets.filter((a) => !a.spam), [data]);
  const buyable = useMemo(() => {
    const seen = new Map<string, { key: string; symbol: string }>();
    for (const a of data?.assets ?? []) if (!a.spam && !seen.has(a.key)) seen.set(a.key, { key: a.key, symbol: a.symbol });
    for (const h of held) if (!seen.has(h.key)) seen.set(h.key, { key: h.key, symbol: h.symbol });
    // A token picked in Discover that the wallet doesn't list: offer it so the quote can say plainly if it can't be swapped.
    if (props.buy && props.buySymbol && !seen.has(props.buy)) seen.set(props.buy, { key: props.buy, symbol: props.buySymbol });
    return [...seen.values()];
  }, [data, held, props.buy, props.buySymbol]);

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
    const canonical = canonicalAmount(amount);
    if (!canonical) return setErr(t("swap.amountBad"));
    setBusy(true);
    try {
      setQuote(await features.swapQuote({ sell: sellKey, buy: buyKey, amount: canonical, slippageBps }));
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
        return setErr(t("swap.expired"));
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
      <Screen back title={t("swap.title")}>
        <Spinner />
      </Screen>
    );
  }

  return (
    <Screen back title={t("swap.title")}>
      <div className="clip-stack">
        <label className="clip-field">
          <span className="clip-field__label">{t("swap.youPayWith")}</span>
          <select className="clip-select" aria-label={t("swap.sellAsset")} value={sellKey} onChange={(e) => { setSell(e.target.value); setQuote(null); }}>
            {held.map((h) => (
              <option key={h.key} value={h.key}>
                {h.symbol}
              </option>
            ))}
          </select>
        </label>
        <Field
          label={t("swap.amount")}
          inputMode="decimal"
          placeholder="0"
          autoComplete="off"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
          hint={sellAsset ? t("swap.youHave", { amount: formatUnits(sellAsset.amount, sellAsset.decimals, 4), symbol: sellAsset.symbol }) : undefined}
        />
        <label className="clip-field">
          <span className="clip-field__label">{t("swap.youGet")}</span>
          <select className="clip-select" aria-label={t("swap.buyAsset")} value={buyKey} onChange={(e) => { setBuy(e.target.value); setQuote(null); }}>
            {buyable.filter((b) => b.key !== sellKey).map((b) => (
              <option key={b.key} value={b.key}>
                {b.symbol}
              </option>
            ))}
          </select>
        </label>
        <div className="clip-segmented" role="radiogroup" aria-label={t("swap.slippage")}>
          {SLIPPAGE.map((bps) => (
            <button key={bps} type="button" role="radio" aria-checked={slippageBps === bps} className={slippageBps === bps ? "is-active" : ""} onClick={() => { setSlippage(bps); setQuote(null); }}>
              {f.percent(bps / 100)}
            </button>
          ))}
        </div>
        <p className="clip-hint">{t("swap.slippageHint")}</p>
      </div>

      {quote && (
        <Card>
          <p className="clip-h2" data-testid="swap-you-get">{quote.youGet}</p>
          <p className="clip-hint">{quote.atLeast}</p>
          <div className="clip-rows">
            <Row label={t("swap.youPay")} value={quote.sell.display} />
            <Row label={t("swap.route")} value={quote.route} />
            {quote.priceImpactPct !== undefined && <Row label={t("swap.priceImpact")} value={f.number(quote.priceImpactPct / 100, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 })} />}
            {state?.prefs.advanced && <Row label={t("swap.network")} value={quote.networkId} />}
          </div>
          {quote.steps.length > 1 && (
            <ol className="clip-steps" aria-label={t("swap.steps")}>
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
          {quote.steps.length > 1 ? t("swap.reviewAndSwap") : t("swap.swap")}
        </Button>
      ) : (
        <Button block disabled={busy || !sellKey || !buyKey} onClick={() => void getPrice()}>
          {busy ? t("swap.gettingPrice") : t("swap.getPrice")}
        </Button>
      )}
    </Screen>
  );
}
