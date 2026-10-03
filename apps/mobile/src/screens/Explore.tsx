/**
 * Explore: featured apps (open in the in-app browser) and what's staked, from the same feature services as the
 * extension (@clip-wallet/features through the engine). Staking and swap actions stay in the extension for now.
 */
import { Pressable, View } from "react-native";
import { userMessageOf } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Card, Chip, Empty, ErrorNote, Row, Screen, Spinner, T } from "../ui/kit";

export function Explore() {
  const { wallet, navigate } = useWallet();
  const featured = useAsync(() => wallet.features.featured(), [wallet]);
  const staking = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  return (
    <Screen back title="Explore">
      <T v="h2">Staking</T>
      <ErrorNote message={staking.error ? userMessageOf(staking.error) : null} />
      {staking.loading && !staking.data && <Spinner />}
      {staking.data?.map((a) => (
        <Card key={a.assetKey}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <T style={{ fontWeight: "600" }}>{a.symbol}</T>
            {a.rewardRate && <Chip tone="accent">{a.rewardRate}</Chip>}
          </View>
          {a.unavailable ? <T v="hint">{a.unavailable.message}</T> : null}
          {a.positions.map((p) => (
            <Row key={p.id} label={p.amountDisplay} value={p.statusText} hint={p.with} />
          ))}
          {!a.unavailable && a.positions.length === 0 && <T v="hint">Nothing staked yet.</T>}
        </Card>
      ))}
      <T v="h2">Featured apps</T>
      <ErrorNote message={featured.error ? userMessageOf(featured.error) : null} />
      {featured.data && featured.data.length === 0 && <Empty title="Nothing to show yet" />}
      {featured.data && featured.data.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {featured.data.map((d) => (
            <Pressable key={d.url} accessibilityRole="link" onPress={() => navigate({ name: "browser", url: d.url })} style={{ paddingVertical: 10, gap: 2 }}>
              <T style={{ fontWeight: "500" }}>{d.name}</T>
              <T v="hint">{`${d.description} · ${d.domain}`}</T>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
