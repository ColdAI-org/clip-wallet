import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { AssetIcon, Button, Card, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import type { OnRampView } from "./client";
import { useFeatures } from "./context";

/** Buy crypto: asks only what and how much. The wallet picks where it lands. */
export function Buy(props: { assetKey?: string }) {
  const features = useFeatures();
  const { state } = useUi();
  const currency = state?.prefs.displayCurrency ?? "USD";
  const assets = useAsync(() => features.buyAssets(), [features]);
  const [assetKey, setAssetKey] = useState(props.assetKey ?? "");
  const [amount, setAmount] = useState("");
  const [view, setView] = useState<OnRampView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (assets.error) return <Screen back title="Buy"><ErrorNote message={userMessageOf(assets.error)} /></Screen>;
  if (!assets.data) return <Screen back title="Buy"><Spinner /></Screen>;
  if (!assets.data.length) {
    return (
      <Screen back title="Buy">
        <Empty title="Buying isn't switched on in this build">You can still receive crypto from someone else.</Empty>
      </Screen>
    );
  }

  const picked = assets.data.find((a) => a.assetKey === assetKey);
  if (!picked) {
    return (
      <Screen back title="Buy">
        <p className="clip-lede">What would you like to buy?</p>
        <ul className="clip-list" aria-label="What you can buy">
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
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setErr(`Enter how much you want to spend in ${currency}.`);
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
    <Screen back={() => { setAssetKey(""); setView(null); }} title={`Buy ${picked.symbol}`}>
      <Field label={`How much (${currency})`} inputMode="decimal" placeholder="50" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); setView(null); }} />
      <ErrorNote message={err} />
      {!view && (
        <Button block disabled={busy} onClick={() => void seeOptions()}>
          See ways to pay
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
                      Continue with {o.name}
                    </Button>
                  ) : (
                    <span className="clip-hint">{o.unavailable?.message}</span>
                  )}
                </span>
              </div>
            </Card>
          ))}
          <p className="clip-hint">You finish the purchase on the provider's site. They may ask to verify who you are.</p>
        </>
      )}
    </Screen>
  );
}
