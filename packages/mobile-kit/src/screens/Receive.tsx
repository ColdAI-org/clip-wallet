/** Receive: pick the asset, then show the right address. Networks appear only when ambiguous. */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { mergeBalances, userMessageOf } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Card, CopyButton, ErrorNote, Notice, Qr, Screen, Spinner, T } from "../ui/kit";
import { IconChevron } from "../ui/icons";
import { useMobileT } from "../i18n";

export function Receive(props: { assetKey?: string }) {
  const { client, back, theme } = useWallet();
  const t = useMobileT();
  const [picked, setPicked] = useState(props.assetKey);
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const choices = useMemo(() => {
    const held = mergeBalances(data?.balances ?? []).assets.filter((a) => !a.bridged).map((a) => ({ key: a.key, symbol: a.symbol, name: a.name }));
    const keys = new Set(held.map((h) => h.key));
    const extra = (data?.assets ?? []).filter((a) => !keys.has(a.key) && !a.bridged && !a.spam).map((a) => ({ key: a.key, symbol: a.symbol, name: a.name }));
    return [...held, ...extra.filter((e, i) => extra.findIndex((x) => x.key === e.key) === i)];
  }, [data]);
  if (picked) return <ReceiveAddress assetKey={picked} onBack={props.assetKey ? back : () => setPicked(undefined)} />;
  return (
    <Screen back title={t("m.common.receive")}>
      <T v="lede">{t("m.receive.pick")}</T>
      {!data ? (
        <Spinner />
      ) : (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {choices.map((c) => (
            <Pressable key={c.key} testID={`receive-${c.key}`} onPress={() => setPicked(c.key)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
              <AssetIcon symbol={c.symbol} />
              <View style={{ flex: 1 }}>
                <T style={{ fontWeight: "600" }}>{c.symbol}</T>
                <T v="hint">{c.name}</T>
              </View>
              <IconChevron color={theme.c.text3} />
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function ReceiveAddress(props: { assetKey: string; onBack: () => void }) {
  const { client, theme } = useWallet();
  const t = useMobileT();
  const { data, error } = useAsync(() => client.getReceiveTargets({ assetKey: props.assetKey }), [client, props.assetKey]);
  const [idx, setIdx] = useState(0);
  if (error) return <Screen back={props.onBack} title={t("m.common.receive")}><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back={props.onBack} title={t("m.common.receive")}><Spinner /></Screen>;
  const target = data[Math.min(idx, data.length - 1)];
  if (!target) return <Screen back={props.onBack} title={t("m.common.receive")}><ErrorNote message={t("m.receive.unsupported")} /></Screen>;
  const ambiguous = data.length > 1 || target.networks.length > 1;
  const shown = target.displayAddress ?? target.address;
  return (
    <Screen back={props.onBack} title={t("m.receive.titleAsset", { symbol: target.asset.symbol })}>
      {data.length > 1 && (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: theme.c.surface2, borderRadius: theme.r.md, padding: 3 }}>
          {data.map((d, i) => (
            <Pressable key={d.address} accessibilityRole="tab" accessibilityState={{ selected: i === idx }} onPress={() => setIdx(i)} style={{ flex: 1, padding: 8, borderRadius: theme.r.sm, backgroundColor: i === idx ? theme.c.surface : "transparent", alignItems: "center" }}>
              <T style={{ fontSize: 13, fontWeight: "600" }}>{d.networks.length === 1 ? d.networks[0]!.name : t("m.receive.networksMore", { network: d.networks[0]!.name, n: d.networks.length - 1 })}</T>
            </Pressable>
          ))}
        </View>
      )}
      <Qr value={shown} label={t("m.receive.qr", { symbol: target.asset.symbol })} />
      <T v="mono" testID="receive-address" selectable style={{ textAlign: "center", fontSize: 14 }}>
        {shown}
      </T>
      <CopyButton value={shown} label={t("m.receive.copyAddress")} />
      {ambiguous && (
        <Notice level="info">
          {target.networks.length > 1
            ? t("m.receive.manyNetworks", { symbol: target.asset.symbol, networks: target.networks.map((n) => n.name).join(", ") })
            : t("m.receive.oneNetwork", { network: target.networks[0]!.name })}
        </Notice>
      )}
    </Screen>
  );
}
