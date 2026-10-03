import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatFiat, relativeTime, shortAddress, userMessageOf, type ActivityEntry } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Card, Chip, Empty, ErrorNote, Screen, Spinner, T } from "../ui/kit";
import { IconArrowDown, IconArrowUp, IconCheck } from "../ui/icons";

function KindIcon(props: { kind: ActivityEntry["kind"]; color: string }) {
  if (props.kind === "receive") return <IconArrowDown color={props.color} size={18} />;
  if (props.kind === "connect" || props.kind === "sign") return <IconCheck color={props.color} size={18} />;
  return <IconArrowUp color={props.color} size={18} />;
}

function Item(props: { e: ActivityEntry; currency: string; networkName: (id: string) => string; advanced: boolean }) {
  const { theme } = useWallet();
  const e = props.e;
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable onPress={() => e.legs.length && setOpen((o) => !o)} style={{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.c.surface2, alignItems: "center", justifyContent: "center" }}>
          <KindIcon kind={e.kind} color={theme.c.text2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T style={{ fontWeight: "500" }}>{e.title}</T>
          {e.status === "pending" ? <Chip tone="accent">In progress</Chip> : e.status === "failed" ? <Chip>Didn't go through — nothing was taken</Chip> : <T v="hint">{relativeTime(e.timestamp)}</T>}
        </View>
        {e.fiatValue !== undefined && <T color={e.fiatValue > 0 ? theme.c.positive : theme.c.text}>{formatFiat(e.fiatValue, props.currency, { signed: true })}</T>}
      </Pressable>
      {open &&
        e.legs.map((l, i) => (
          <View key={i} style={{ paddingLeft: 48, paddingBottom: 6 }}>
            <T v="hint">{l.title}</T>
            {props.advanced && <T v="hint">{`${props.networkName(l.networkId)}${l.txHash ? ` · ${shortAddress(l.txHash, 6)}` : ""}`}</T>}
          </View>
        ))}
    </View>
  );
}

export function Activity() {
  const { client, state } = useWallet();
  const { data, error, loading } = useAsync(() => client.getActivity(), [client]);
  const { data: portfolio } = useAsync(() => client.getPortfolio(), [client]);
  const currency = state?.prefs.displayCurrency ?? "USD";
  const name = (id: string) => portfolio?.networks.find((n) => n.id === id)?.name ?? id;
  return (
    <Screen nav title="Activity">
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {loading && !data && <Spinner />}
      {data && data.length === 0 && <Empty title="No activity yet" />}
      {data && data.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {data.map((e) => (
            <Item key={e.id} e={e} currency={currency} networkName={name} advanced={!!state?.prefs.advanced} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
