/**
 * Notification settings (same behaviour as packages/ui/src/social/Notifications.tsx): one switch to turn them on
 * (asks iOS/Android first), one per kind, a test notice, and price alerts. Background checks on a phone run when
 * the OS allows (expo-background-task), so the screen says alerts can arrive late.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { canonicalAmount, formatFiat, mergeBalances, relativeTime, type NotificationKind, type NotificationSettings, type PriceAlert } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, Notice, Screen, Spinner, T, Toggle } from "../ui/kit";
import { useMobileT, type MobileMessageId } from "../i18n";
import { socialErrorText } from "../lib/social-errors";

const KINDS: { kind: NotificationKind; id: MobileMessageId }[] = [
  { kind: "incoming", id: "m.social.notify.kind.incoming" },
  { kind: "nft", id: "m.social.notify.kind.nft" },
  { kind: "confirmed", id: "m.social.notify.kind.confirmed" },
  { kind: "failed", id: "m.social.notify.kind.failed" },
  { kind: "approval", id: "m.social.notify.kind.approval" },
  { kind: "price", id: "m.social.notify.kind.price" },
];

export function Notifications() {
  const { wallet } = useWallet();
  const social = wallet.social;
  const t = useMobileT();
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
      if (!ok) return setErr(t("m.social.notify.denied"));
    }
    await apply({ enabled: on });
  };

  if (!s) {
    return (
      <Screen back title={t("m.social.notify.title")}>
        {error ? <ErrorNote message={socialErrorText(error, t)} /> : <Spinner />}
      </Screen>
    );
  }

  return (
    <Screen back title={t("m.social.notify.title")}>
      <Card>
        <Toggle testID="notify-enable" label={t("m.social.notify.enable")} description={t("m.social.notify.enableHint")} checked={s.enabled} onChange={(on) => void enable(on)} />
        <T v="hint">{t("m.social.notify.iosLimits")}</T>
      </Card>
      <ErrorNote message={err} />
      {s.enabled && (
        <>
          <View style={{ gap: 8 }}>
            <T v="h2">{t("m.social.notify.kinds")}</T>
            <Card>
              {KINDS.map((k) => (
                <Toggle key={k.kind} testID={`notify-kind-${k.kind}`} label={t(k.id)} checked={s.kinds[k.kind]} onChange={(on) => void apply({ kinds: { [k.kind]: on } })} />
              ))}
            </Card>
          </View>
          <Button
            variant="secondary"
            block
            testID="notify-test"
            onPress={async () => {
              await social.testNotification().catch((e) => setErr(socialErrorText(e, t)));
              setMsg(t("m.social.notify.testSent"));
            }}
          >
            {t("m.social.notify.test")}
          </Button>
          {msg && <T v="hint">{msg}</T>}
        </>
      )}
      <PriceAlerts alerts={s.alerts} onChanged={async () => setSettings(await social.notificationSettings())} />
    </Screen>
  );
}

function alertText(t: ReturnType<typeof useMobileT>, a: PriceAlert): string {
  return t(a.direction === "above" ? "m.social.notify.alert.above" : "m.social.notify.alert.below", { symbol: a.symbol, price: formatFiat(a.price, a.currency) });
}

function Choice(props: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const { theme } = useWallet();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: props.on }}
      testID={props.testID}
      onPress={props.onPress}
      style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: theme.r.sm, borderWidth: props.on ? 2 : 1, borderColor: props.on ? theme.c.accent : theme.c.border }}
    >
      <T style={{ fontSize: 14, fontWeight: props.on ? "600" : "400" }}>{props.label}</T>
    </Pressable>
  );
}

function PriceAlerts(props: { alerts: PriceAlert[]; onChanged: () => Promise<void> }) {
  const { wallet, client, state } = useWallet();
  const social = wallet.social;
  const t = useMobileT();
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
  const priceErr = price && (parsed === null || Number(parsed) <= 0) ? t("m.social.notify.alert.badPrice") : null;

  const add = async () => {
    setErr(null);
    if (!parsed || priceErr) return setErr(t("m.social.notify.alert.badPrice"));
    try {
      await social.addPriceAlert({ assetKey: key, direction, price: Number(parsed), currency });
      setPrice("");
      await props.onChanged();
    } catch (x) {
      setErr(socialErrorText(x, t));
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <T v="h2">{t("m.social.notify.alerts")}</T>
      <Card>
        {props.alerts.length === 0 && <T v="hint">{t("m.social.notify.alertsEmpty")}</T>}
        {props.alerts.map((a) => (
          <View key={a.id} style={{ gap: 4 }} testID={`alert-${a.id}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Toggle label={alertText(t, a)} checked={a.armed} onChange={async (on) => (await social.armPriceAlert(a.id, on), await props.onChanged())} />
              </View>
              <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 10 }} accessibilityLabel={t("m.social.notify.alert.remove", { what: alertText(t, a) })} onPress={async () => (await social.removePriceAlert(a.id), await props.onChanged())}>
                ✕
              </Button>
            </View>
            {!a.armed && a.firedAt && <T v="hint">{t("m.social.notify.alert.fired", { when: relativeTime(a.firedAt) })}</T>}
          </View>
        ))}

        <View style={{ gap: 6 }}>
          <T v="label">{t("m.social.notify.alert.asset")}</T>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("m.social.notify.alert.asset")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {assets.map((a) => (
              <Choice key={a.key} label={a.symbol} on={a.key === key} onPress={() => setAssetKey(a.key)} testID={`alert-asset-${a.key}`} />
            ))}
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <T v="label">{t("m.social.notify.alert.when")}</T>
          <View accessibilityRole="radiogroup" accessibilityLabel={t("m.social.notify.alert.when")} style={{ flexDirection: "row", gap: 6 }}>
            <Choice label={t("m.social.notify.alert.dirAbove")} on={direction === "above"} onPress={() => setDirection("above")} />
            <Choice label={t("m.social.notify.alert.dirBelow")} on={direction === "below"} onPress={() => setDirection("below")} />
          </View>
        </View>
        <Field
          label={t("m.social.notify.alert.price", { currency })}
          keyboardType="decimal-pad"
          value={price}
          onChangeText={setPrice}
          error={priceErr}
          testID="alert-price"
          hint={now !== undefined ? t("m.social.notify.alert.now", { price: formatFiat(now, currency) }) : undefined}
        />
        {err && <Notice level="danger">{err}</Notice>}
        <Button variant="secondary" block testID="alert-add" disabled={!key || !price || !!priceErr} onPress={() => void add()}>
          {t("m.social.notify.alert.add")}
        </Button>
      </Card>
    </View>
  );
}
