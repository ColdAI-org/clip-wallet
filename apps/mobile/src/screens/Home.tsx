/**
 * Home: one total, assets merged across networks (@clip-wallet/ui mergeBalances), Send / Receive.
 * Networks are invisible here; they appear only on an asset's "Where it is" split.
 */
import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { formatFiat, formatUnits, mergeBalances, shortAddress, userMessageOf, type MergedAsset } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, Card, Chip, Empty, ErrorNote, IconButton, Row, Screen, Spinner, T, Toggle } from "../ui/kit";
import { IconArrowDown, IconArrowUp, IconLock } from "../ui/icons";
import { APP } from "../env";
import { useMobileT } from "../i18n";

function AssetRow(props: { asset: MergedAsset; currency: string; onOpen: () => void }) {
  const { theme } = useWallet();
  const t = useMobileT();
  const a = props.asset;
  return (
    <Pressable accessibilityRole="button" testID={`asset-${a.id}`} onPress={props.onOpen} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
      <AssetIcon symbol={a.symbol} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <T style={{ fontWeight: "600" }}>{a.symbol}</T>
          {a.bridged && <Chip tone="muted">{t("m.home.bridged")}</Chip>}
        </View>
        <T v="hint">{t("m.common.amount", { amount: formatUnits(a.amount, a.decimals, 4), symbol: a.symbol })}</T>
      </View>
      <T style={{ fontWeight: "500", color: theme.c.text }}>{formatFiat(a.fiatValue, props.currency)}</T>
    </Pressable>
  );
}

export function Home() {
  const { client, state, refresh, navigate, theme, showApproval } = useWallet();
  const t = useMobileT();
  const prefs = state?.prefs;
  const { data, error, loading, reload } = useAsync(() => client.getPortfolio(), [client, prefs?.displayCurrency]);
  const currency = data?.currency ?? prefs?.displayCurrency ?? "USD";
  const merged = useMemo(
    () => mergeBalances(data?.balances ?? [], { pinned: prefs?.pinned, hideSmallBalances: prefs?.hideSmallBalances, showSpam: prefs?.showSpam }),
    [data, prefs?.pinned, prefs?.hideSmallBalances, prefs?.showSpam],
  );
  const setPref = async (patch: Parameters<typeof client.setPrefs>[0]) => {
    await client.setPrefs(patch);
    await refresh();
  };

  return (
    <Screen
      nav
      scroll={false}
      title={<T v="h1" style={{ fontSize: 18 }}>{APP.config.name}</T>}
      actions={
        <IconButton label={t("m.home.lock")} testID="lock" onPress={async () => (await client.lock(), await refresh())}>
          <IconLock color={theme.c.text} />
        </IconButton>
      }
    >
      <ScrollView
        contentContainerStyle={{ padding: theme.s(4), gap: theme.s(4) }}
        refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={async () => (await client.getPortfolio({ refresh: true }), reload())} />}
      >
        {state && state.pendingApprovals > 0 && (
          <Pressable
            testID="pending-banner"
            onPress={async () => {
              const [first] = await client.listApprovals();
              if (first) showApproval(first.id);
            }}
            style={{ backgroundColor: theme.c.accentSoft, borderRadius: theme.r.md, padding: 12 }}
          >
            <T color={theme.c.accent} style={{ fontWeight: "600" }}>
              {t("m.home.pending", { n: state.pendingApprovals })}
            </T>
          </Pressable>
        )}

        <View style={{ alignItems: "center", gap: 4, paddingVertical: theme.s(4) }}>
          <T v="label">{t("m.home.total")}</T>
          {loading && !data ? <Spinner /> : <T v="display" testID="total" style={{ fontSize: 40 }}>{formatFiat(merged.total, currency)}</T>}
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button onPress={() => navigate({ name: "send" })} testID="send">
            <IconArrowUp color={theme.c.accentText} />
            <T color={theme.c.accentText} style={{ fontWeight: "600" }}>{t("m.common.send")}</T>
          </Button>
          <Button variant="secondary" onPress={() => navigate({ name: "receive" })} testID="receive">
            <IconArrowDown color={theme.c.text} />
            <T style={{ fontWeight: "600" }}>{t("m.common.receive")}</T>
          </Button>
        </View>

        <ErrorNote message={error ? userMessageOf(error) : null} />

        {data && merged.assets.length === 0 ? (
          <Empty title={t("m.home.empty.title")}>{t("m.home.empty.body")}</Empty>
        ) : (
          <Card style={{ gap: 0, paddingVertical: 6 }}>
            {merged.assets.map((a) => (
              <AssetRow key={a.id} asset={a} currency={currency} onOpen={() => navigate({ name: "asset", id: a.id })} />
            ))}
          </Card>
        )}

        {data && (
          <View style={{ gap: 12 }}>
            <Toggle label={t("m.home.hideSmall")} checked={!!prefs?.hideSmallBalances} onChange={(v) => setPref({ hideSmallBalances: v })} />
            {(merged.hiddenSpam > 0 || prefs?.showSpam) && (
              <Pressable onPress={() => setPref({ showSpam: !prefs?.showSpam })}>
                <T v="hint" color={theme.c.accent}>
                  {prefs?.showSpam ? t("m.home.spam.hide") : t("m.home.spam.hidden", { n: merged.hiddenSpam })}
                </T>
              </Pressable>
            )}
            {data.stale.length > 0 && <T v="hint">{t("m.home.stale")}</T>}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

export function AssetDetail(props: { id: string }) {
  const { client, state, refresh, navigate, theme } = useWallet();
  const t = useMobileT();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const prefs = state?.prefs;
  const currency = data?.currency ?? prefs?.displayCurrency ?? "USD";
  const asset = useMemo(() => mergeBalances(data?.balances ?? [], { showSpam: true, pinned: prefs?.pinned }).assets.find((a) => a.id === props.id), [data, props.id, prefs?.pinned]);
  if (!data) return <Screen back title={t("m.home.asset.title")}><Spinner /></Screen>;
  if (!asset) return <Screen back title={t("m.home.asset.title")}><Empty title={t("m.home.asset.gone")} /></Screen>;
  const name = (id: string) => data.networks.find((n) => n.id === id)?.name ?? id;
  const togglePin = async () => {
    const pinned = new Set(prefs?.pinned ?? []);
    if (pinned.has(asset.id)) pinned.delete(asset.id);
    else pinned.add(asset.id);
    await client.setPrefs({ pinned: [...pinned] });
    await refresh();
  };
  return (
    <Screen back title={asset.name} actions={<Button variant="ghost" onPress={togglePin}>{asset.pinned ? t("m.home.asset.unpin") : t("m.home.asset.pin")}</Button>}>
      <View style={{ alignItems: "center", gap: 8 }}>
        <AssetIcon symbol={asset.symbol} size={48} />
        <T v="h1">{t("m.common.amount", { amount: formatUnits(asset.amount, asset.decimals, 6), symbol: asset.symbol })}</T>
        <T v="label">{formatFiat(asset.fiatValue, currency)}</T>
        {asset.bridged && <Chip tone="muted">{t("m.home.asset.bridgedCopy", { symbol: asset.symbol })}</Chip>}
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button onPress={() => navigate({ name: "send", assetKey: asset.key })}>{t("m.common.send")}</Button>
        <Button variant="secondary" onPress={() => navigate({ name: "receive", assetKey: asset.key })}>
          {t("m.common.receive")}
        </Button>
      </View>
      {asset.parts.length > 1 || prefs?.advanced ? (
        <View style={{ gap: 8 }} testID="network-split">
          <T v="h2">{t("m.home.asset.where")}</T>
          <Card style={{ gap: 0 }}>
            {asset.parts.map((p) => (
              <Row key={p.asset.networkId + (p.asset.address ?? "")} label={name(p.asset.networkId)} value={t("m.common.amount", { amount: formatUnits(p.amount, p.asset.decimals, 4), symbol: p.asset.symbol })} hint={formatFiat(p.fiatValue, currency)} />
            ))}
          </Card>
          <T v="hint">{t("m.home.asset.whereHint", { symbol: asset.symbol })}</T>
        </View>
      ) : null}
      {prefs?.advanced &&
        asset.parts.map((p) => (p.asset.address ? <Row key={`addr-${p.asset.networkId}`} label={t("m.home.asset.contract", { network: name(p.asset.networkId) })} value={<T v="mono">{shortAddress(p.asset.address, 6)}</T>} /> : null))}
    </Screen>
  );
}
