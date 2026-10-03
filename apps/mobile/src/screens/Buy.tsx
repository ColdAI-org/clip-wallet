/**
 * Buy crypto: the extension's Buy (packages/ui/src/features/Buy.tsx) in React Native. Asks only what and how
 * much; the wallet picks where it lands. The provider's widget opens in the in-app browser sheet
 * (expo-web-browser: SFSafariViewController on iOS, Custom Tabs on Android), so card entry, Apple Pay / Google
 * Pay and ID checks run on the provider's own page, never inside the wallet.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { userMessageOf, type OnRampView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, Card, Empty, ErrorNote, Field, Screen, Spinner, T } from "../ui/kit";
import { IconChevron } from "../ui/icons";

export function Buy(props: { assetKey?: string }) {
  const { wallet, state, theme } = useWallet();
  const currency = state?.prefs.displayCurrency ?? "USD";
  const assets = useAsync(() => wallet.features.buyAssets(), [wallet]);
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
        <T v="lede">What would you like to buy?</T>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {assets.data.map((a) => (
            <Pressable key={a.assetKey} accessibilityRole="button" testID={`buy-${a.assetKey}`} onPress={() => setAssetKey(a.assetKey)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
              <AssetIcon symbol={a.symbol} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: "600" }}>{a.symbol}</T>
                <T v="hint">{a.name}</T>
              </View>
              <IconChevron color={theme.c.text3} />
            </Pressable>
          ))}
        </Card>
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
      setView(await wallet.features.buyOptions({ assetKey: picked!.assetKey, fiatAmount: n, fiatCurrency: currency }));
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function open(url: string) {
    setErr(null);
    try {
      await wallet.features.openExternal(url);
    } catch (e) {
      setErr(userMessageOf(e));
    }
  }

  return (
    <Screen back={props.assetKey ? true : () => (setAssetKey(""), setView(null))} title={`Buy ${picked.symbol}`}>
      <Field label={`How much (${currency})`} keyboardType="decimal-pad" placeholder="50" testID="buy-amount" value={amount} onChangeText={(t) => (setAmount(t), setView(null))} />
      <ErrorNote message={err} />
      {!view && (
        <Button block disabled={busy} onPress={() => void seeOptions()} testID="buy-options">
          See ways to pay
        </Button>
      )}
      {view && (
        <>
          <T v="hint">{view.explainer}</T>
          {view.options.map((o) => (
            <Card key={o.provider}>
              <View style={{ gap: 2 }}>
                <T style={{ fontWeight: "600" }}>{o.name}</T>
                {o.methods ? <T v="hint">{o.methods}</T> : null}
              </View>
              {o.url ? (
                <Button variant="secondary" block testID={`buy-with-${o.provider}`} onPress={() => void open(o.url!)}>
                  {`Continue with ${o.name}`}
                </Button>
              ) : (
                <T v="hint">{o.unavailable?.message ?? ""}</T>
              )}
            </Card>
          ))}
          <T v="hint">You finish the purchase on the provider's page. They may ask to verify who you are.</T>
        </>
      )}
    </Screen>
  );
}
