import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { AssetIcon, Button, Card, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import { canonicalAmount } from "../lib/format";
import { useUiT } from "../i18n";
import type { OnRampView } from "./client";
import { useFeatures } from "./context";

/** Buy crypto: asks only what and how much. The wallet picks where it lands. */
export function Buy(props: { assetKey?: string }) {
  const t = useUiT();
  const features = useFeatures();
  const { state } = useUi();
  const currency = state?.prefs.displayCurrency ?? "USD";
  const assets = useAsync(() => features.buyAssets(), [features]);
  const [assetKey, setAssetKey] = useState(props.assetKey ?? "");
  const [amount, setAmount] = useState("");
  const [view, setView] = useState<OnRampView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (assets.error) return <Screen back title={t("buy.title")}><ErrorNote message={userMessageOf(assets.error)} /></Screen>;
  if (!assets.data) return <Screen back title={t("buy.title")}><Spinner /></Screen>;
  if (!assets.data.length) {
    return (
      <Screen back title={t("buy.title")}>
        <Empty title={t("buy.off.title")}>{t("buy.off.body")}</Empty>
      </Screen>
    );
  }

  const picked = assets.data.find((a) => a.assetKey === assetKey);
  if (!picked) {
    return (
      <Screen back title={t("buy.title")}>
        <p className="clip-lede">{t("buy.what")}</p>
        <ul className="clip-list" aria-label={t("buy.whatLabel")}>
          {assets.data.map((a) => (
            <li key={a.assetKey}>
              <button type="button" className="clip-asset-row" onClick={() => setAssetKey(a.assetKey)}>
                <AssetIcon symbol={a.symbol} />
                <span className="clip-asset-row__main">
                  <span className="clip-asset-row__symbol">{a.symbol}</span>
                  <span className="clip-asset-row__name">{a.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Screen>
    );
  }

  async function seeOptions() {
    setErr(null);
    setView(null);
    const canonical = canonicalAmount(amount);
    const n = canonical === null ? NaN : Number(canonical);
    if (!Number.isFinite(n) || n <= 0) return setErr(t("buy.amountBad", { currency }));
    setBusy(true);
    try {
      setView(await features.buyOptions({ assetKey: picked!.assetKey, fiatAmount: n, fiatCurrency: currency }));
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back={() => { setAssetKey(""); setView(null); }} title={t("buy.titleAsset", { symbol: picked.symbol })}>
      <Field label={t("buy.howMuch", { currency })} inputMode="decimal" placeholder="50" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); setView(null); }} />
      <ErrorNote message={err} />
      {!view && (
        <Button block disabled={busy} onClick={() => void seeOptions()}>
          {t("buy.seeWays")}
        </Button>
      )}
      {view && (
        <>
          <p className="clip-hint">{view.explainer}</p>
          {view.options.map((o) => (
            <Card key={o.provider}>
              <div className="clip-row">
                <span className="clip-row__label">
                  <strong>{o.name}</strong>
                  {o.methods && <span className="clip-row__hint">{o.methods}</span>}
                </span>
                <span className="clip-row__value">
                  {o.url ? (
                    <Button variant="secondary" onClick={() => void features.openExternal(o.url!)}>
                      {t("buy.continueWith", { provider: o.name })}
                    </Button>
                  ) : (
                    <span className="clip-hint">{o.unavailable?.message}</span>
                  )}
                </span>
              </div>
            </Card>
          ))}
          <p className="clip-hint">{t("buy.finishOnProvider")}</p>
        </>
      )}
    </Screen>
  );
}
