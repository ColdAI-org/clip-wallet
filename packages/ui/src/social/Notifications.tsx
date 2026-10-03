import { useMemo, useState } from "react";
import { useAsync, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Screen, Spinner, Toggle } from "../components";
import { canonicalAmount, formatFiat, relativeTime } from "../lib/format";
import { mergeBalances } from "../lib/portfolio";
import { useUiT, type UiMessageId } from "../i18n";
import type { NotificationKind, NotificationSettings, PriceAlert } from "./client";
import { useSocial } from "./context";
import { socialErrorText } from "./errors";

const KINDS: { kind: NotificationKind; id: UiMessageId }[] = [
  { kind: "incoming", id: "social.notify.kind.incoming" },
  { kind: "nft", id: "social.notify.kind.nft" },
  { kind: "confirmed", id: "social.notify.kind.confirmed" },
  { kind: "failed", id: "social.notify.kind.failed" },
  { kind: "approval", id: "social.notify.kind.approval" },
  { kind: "price", id: "social.notify.kind.price" },
];

/** Notification settings: one switch to turn them on (asks the browser/OS), one per kind, and price alerts. */
export function NotificationSettingsScreen() {
  const t = useUiT();
  const social = useSocial();
  const { data, error } = useAsync(() => social.notificationSettings(), [social]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const s = settings ?? data;

  const apply = async (p: Parameters<typeof social.setNotifications>[0]) => {
    setErr(null);
    try {
      setSettings(await social.setNotifications(p));
    } catch (e) {
      setErr(socialErrorText(e, t));
    }
  };

  const enable = async (on: boolean) => {
    if (on && social.requestNotificationPermission) {
      const ok = await social.requestNotificationPermission().catch(() => false);
      if (!ok) return setErr(t("social.notify.denied"));
    }
    await apply({ enabled: on });
  };

  if (!s) {
    return (
      <Screen back title={t("social.notify.title")}>
        {error ? <ErrorNote message={socialErrorText(error, t)} /> : <Spinner />}
      </Screen>
    );
  }

  return (
    <Screen back title={t("social.notify.title")}>
      <Card>
        <Toggle label={t("social.notify.enable")} description={t("social.notify.enableHint")} checked={s.enabled} onChange={(on) => void enable(on)} />
      </Card>
      <ErrorNote message={err} />
      {s.enabled && (
        <>
          <section aria-labelledby="notify-kinds">
            <h2 id="notify-kinds" className="clip-h2">
              {t("social.notify.kinds")}
            </h2>
            <Card>
              {KINDS.map((k) => (
                <Toggle key={k.kind} label={t(k.id)} checked={s.kinds[k.kind]} onChange={(on) => void apply({ kinds: { [k.kind]: on } })} />
              ))}
            </Card>
          </section>
          <Button
            variant="secondary"
            onClick={async () => {
              await social.testNotification().catch((e) => setErr(socialErrorText(e, t)));
              setMsg(t("social.notify.testSent"));
            }}
          >
            {t("social.notify.test")}
          </Button>
          {msg && <p className="clip-hint">{msg}</p>}
        </>
      )}
      <PriceAlerts alerts={s.alerts} onChanged={async () => setSettings(await social.notificationSettings())} />
    </Screen>
  );
}

function alertText(t: ReturnType<typeof useUiT>, a: PriceAlert): string {
  return t(a.direction === "above" ? "social.notify.alert.above" : "social.notify.alert.below", { symbol: a.symbol, price: formatFiat(a.price, a.currency) });
}

function PriceAlerts(props: { alerts: PriceAlert[]; onChanged: () => Promise<void> }) {
  const t = useUiT();
  const social = useSocial();
  const { client, state } = useUi();
  const currency = state?.prefs.displayCurrency ?? "USD";
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  // Assets with a known price (only those can trigger an alert).
  const assets = useMemo(() => {
    const priced = mergeBalances(data?.balances ?? []).assets.filter((a) => a.fiatValue !== undefined && BigInt(a.amount) > 0n && !a.spam);
    const seen = new Map<string, { key: string; symbol: string; price?: number }>();
    for (const a of priced) if (!seen.has(a.key)) seen.set(a.key, { key: a.key, symbol: a.symbol, price: a.fiatValue! / (Number(BigInt(a.amount)) / 10 ** a.decimals) });
    for (const a of data?.assets ?? []) if (!a.spam && !seen.has(a.key)) seen.set(a.key, { key: a.key, symbol: a.symbol });
    return [...seen.values()];
  }, [data]);
  const [assetKey, setAssetKey] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const key = assetKey || assets[0]?.key || "";
  const now = assets.find((a) => a.key === key)?.price;
  const parsed = canonicalAmount(price);
  const priceErr = price && (parsed === null || Number(parsed) <= 0) ? t("social.notify.alert.badPrice") : null;

  return (
    <section aria-labelledby="price-alerts">
      <h2 id="price-alerts" className="clip-h2">
        {t("social.notify.alerts")}
      </h2>
      <Card>
        {props.alerts.length === 0 && <p className="clip-hint">{t("social.notify.alertsEmpty")}</p>}
        <ul className="clip-sessions">
          {props.alerts.map((a) => (
            <li key={a.id} className="clip-session">
              <div>
                <div className="clip-session__name">{alertText(t, a)}</div>
                {!a.armed && a.firedAt && <div className="clip-session__meta">{t("social.notify.alert.fired", { when: relativeTime(a.firedAt) })}</div>}
              </div>
              <Toggle label={t("social.notify.alert.on")} checked={a.armed} onChange={async (on) => (await social.armPriceAlert(a.id, on), await props.onChanged())} />
              <Button variant="ghost" aria-label={t("social.notify.alert.remove", { what: alertText(t, a) })} onClick={async () => (await social.removePriceAlert(a.id), await props.onChanged())}>
                ✕
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="clip-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            if (!parsed || priceErr) return setErr(t("social.notify.alert.badPrice"));
            try {
              await social.addPriceAlert({ assetKey: key, direction, price: Number(parsed), currency });
              setPrice("");
              await props.onChanged();
            } catch (x) {
              setErr(socialErrorText(x, t));
            }
          }}
        >
          <label className="clip-select-row">
            <span>{t("social.notify.alert.asset")}</span>
            <select className="clip-select" value={key} onChange={(e) => setAssetKey(e.target.value)}>
              {assets.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="clip-select-row">
            <span>{t("social.notify.alert.when")}</span>
            <select className="clip-select" value={direction} onChange={(e) => setDirection(e.target.value as "above" | "below")}>
              <option value="above">{t("social.notify.alert.dirAbove")}</option>
              <option value="below">{t("social.notify.alert.dirBelow")}</option>
            </select>
          </label>
          <Field
            label={t("social.notify.alert.price", { currency })}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={priceErr}
            hint={now !== undefined ? t("social.notify.alert.now", { price: formatFiat(now, currency) }) : undefined}
          />
          <ErrorNote message={err} />
          <Button type="submit" variant="secondary" disabled={!key || !price || !!priceErr}>
            {t("social.notify.alert.add")}
          </Button>
        </form>
      </Card>
    </section>
  );
}
