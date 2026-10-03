/**
 * Collectibles grouped by collection (@clip-wallet/ui groupCollectibles). NFT media is untrusted: like the
 * extension, nothing is fetched unless a media proxy is configured (none yet), so tiles are drawn locally.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import type { Nft } from "@clip-wallet/core";
import { groupCollectibles, hueFor, userMessageOf } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Card, Chip, Empty, ErrorNote, Row, Screen, Spinner, T } from "../ui/kit";

function Tile(props: { nft: Nft; size: number }) {
  const hue = hueFor(props.nft.collection.address + props.nft.tokenId);
  return (
    <View accessibilityRole="image" accessibilityLabel={props.nft.name ?? `${props.nft.collection.name} #${props.nft.tokenId}`} style={{ width: props.size, height: props.size, borderRadius: 14, backgroundColor: `hsl(${hue}, 70%, 60%)`, alignItems: "center", justifyContent: "center" }}>
      <T color="#fff" style={{ fontSize: props.size / 3, fontWeight: "700" }}>
        {props.nft.collection.name.slice(0, 1)}
      </T>
    </View>
  );
}

export function Collectibles() {
  const { client, state } = useWallet();
  const { data, error, loading } = useAsync(() => client.getCollectibles(), [client]);
  const { data: portfolio } = useAsync(() => client.getPortfolio(), [client]);
  const [network, setNetwork] = useState("");
  const [open, setOpen] = useState<Nft | null>(null);
  const showSpam = !!state?.prefs.showSpam;
  const groups = useMemo(() => groupCollectibles(data ?? [], { network: network || undefined, showSpam }), [data, network, showSpam]);
  const present = useMemo(() => [...new Set((data ?? []).filter((n) => showSpam || !n.spam).map((n) => n.networkId))], [data, showSpam]);
  const name = (id: string) => portfolio?.networks.find((n) => n.id === id)?.name ?? id;

  if (open) {
    return (
      <Screen back={() => setOpen(null)} title={open.name ?? `#${open.tokenId}`}>
        <View style={{ alignItems: "center" }}>
          <Tile nft={open} size={260} />
        </View>
        <Card style={{ gap: 0 }}>
          <Row label="Collection" value={open.collection.name} />
          <Row label="Token" value={`#${open.tokenId}`} />
          {state?.prefs.advanced && <Row label="Network" value={name(open.networkId)} />}
          {(open.attributes ?? []).map((a) => (
            <Row key={a.trait} label={a.trait} value={a.value} />
          ))}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen nav title="Collectibles">
      {present.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {["", ...present].map((id) => (
            <Pressable key={id || "all"} onPress={() => setNetwork(id)}>
              <Chip tone={network === id ? "accent" : "muted"}>{id ? `Only ${name(id)}` : "Everything"}</Chip>
            </Pressable>
          ))}
        </View>
      )}
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {loading && !data && <Spinner />}
      {data && groups.length === 0 && <Empty title="No collectibles yet">Collectibles you own on any network show up here.</Empty>}
      {groups.map((g) => (
        <View key={g.key} style={{ gap: 8 }}>
          <T v="h2">{`${g.name} · ${g.items.length}`}</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {g.items.map((n) => (
              <Pressable key={n.tokenId} onPress={() => setOpen(n)}>
                <Tile nft={n} size={104} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}
