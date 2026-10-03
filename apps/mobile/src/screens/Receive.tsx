/** Receive: pick the asset, then show the right address. Networks appear only when ambiguous. */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { mergeBalances, userMessageOf } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Card, CopyButton, ErrorNote, Notice, Qr, Screen, Spinner, T } from "../ui/kit";
import { IconChevron } from "../ui/icons";

export function Receive(props: { assetKey?: string }) {
  const { client, back, theme } = useWallet();
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
    <Screen back title="Receive">
      <T v="lede">What would you like to receive?</T>
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
  const { data, error } = useAsync(() => client.getReceiveTargets({ assetKey: props.assetKey }), [client, props.assetKey]);
  const [idx, setIdx] = useState(0);
  if (error) return <Screen back={props.onBack} title="Receive"><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back={props.onBack} title="Receive"><Spinner /></Screen>;
  const t = data[Math.min(idx, data.length - 1)];
  if (!t) return <Screen back={props.onBack} title="Receive"><ErrorNote message="This wallet can't receive that yet." /></Screen>;
  const ambiguous = data.length > 1 || t.networks.length > 1;
  const shown = t.displayAddress ?? t.address;
  return (
    <Screen back={props.onBack} title={`Receive ${t.asset.symbol}`}>
      {data.length > 1 && (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: theme.c.surface2, borderRadius: theme.r.md, padding: 3 }}>
          {data.map((d, i) => (
            <Pressable key={d.address} accessibilityRole="tab" accessibilityState={{ selected: i === idx }} onPress={() => setIdx(i)} style={{ flex: 1, padding: 8, borderRadius: theme.r.sm, backgroundColor: i === idx ? theme.c.surface : "transparent", alignItems: "center" }}>
              <T style={{ fontSize: 13, fontWeight: "600" }}>{d.networks.length === 1 ? d.networks[0]!.name : `${d.networks[0]!.name} +${d.networks.length - 1}`}</T>
            </Pressable>
          ))}
        </View>
      )}
      <Qr value={shown} label={`QR code for your ${t.asset.symbol} address`} />
      <T v="mono" testID="receive-address" selectable style={{ textAlign: "center", fontSize: 14 }}>
        {shown}
      </T>
      <CopyButton value={shown} label="Copy address" />
      {ambiguous && (
        <Notice level="info">
          {t.networks.length > 1
            ? `This address receives ${t.asset.symbol} on ${t.networks.map((n) => n.name).join(", ")}. Ask the sender to use one of these.`
            : `Ask the sender to send on ${t.networks[0]!.name}.`}
        </Notice>
      )}
    </Screen>
  );
}
