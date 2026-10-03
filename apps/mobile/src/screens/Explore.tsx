/**
 * Explore tab: the extension's Explore (packages/ui/src/features/Explore.tsx) plus its "More" menu. Stake,
 * Swap, Buy and Secure Trade; your liquidity positions; featured apps (curated, verified domains) open in the
 * in-app browser so they can connect.
 */
import { Pressable, View } from "react-native";
import { formatFiat, userMessageOf, type FeaturedDappView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, Empty, ErrorNote, MenuItem, Screen, Spinner, T } from "../ui/kit";

const CATEGORY: Record<FeaturedDappView["category"], string> = {
  swap: "Swap",
  lend: "Lend and borrow",
  stake: "Stake",
  nft: "Collectibles",
  bridge: "Move between apps",
  pay: "Pay",
  tools: "Tools",
};

export function Explore() {
  const { wallet, navigate, state } = useWallet();
  const featured = useAsync(() => wallet.features.featured(), [wallet]);
  const staking = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  const lp = useAsync(() => wallet.features.lpPositions(), [wallet]);
  const currency = state?.prefs.displayCurrency ?? "USD";
  const groups = new Map<string, FeaturedDappView[]>();
  for (const d of featured.data ?? []) {
    const k = CATEGORY[d.category];
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const staked = (staking.data ?? []).flatMap((a) => a.positions.map((p) => ({ ...p, symbol: a.symbol })));
  const comingSoon = (staking.data ?? []).filter((a) => a.unavailable).map((a) => a.unavailable!.message);

  return (
    <Screen nav title="Explore">
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <MenuItem title="Stake" hint="Earn rewards on coins you hold" testID="explore-stake" onPress={() => navigate({ name: "stake" })} />
        <MenuItem title="Swap" hint="Trade one asset for another" testID="explore-swap" onPress={() => navigate({ name: "swap" })} />
        <MenuItem title="Buy" hint="With a card or bank transfer" testID="explore-buy" onPress={() => navigate({ name: "buy" })} />
        <MenuItem title="Secure Trade" hint="Swap directly with someone you know" testID="explore-trade" onPress={() => navigate({ name: "trade" })} />
      </Card>

      <T v="h2">Staking</T>
      <ErrorNote message={staking.error ? userMessageOf(staking.error) : null} />
      {staking.loading && !staking.data && <Spinner />}
      {staking.data && staked.length === 0 && <T v="hint">Nothing staked yet.</T>}
      {staked.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <T style={{ fontWeight: "600" }}>{p.amountDisplay}</T>
            <T v="hint">{p.statusText}</T>
          </View>
          <T v="hint">{p.with}</T>
        </Card>
      ))}
      {comingSoon.map((m) => (
        <T key={m} v="hint">
          {m}
        </T>
      ))}

      <T v="h2">Your liquidity</T>
      <ErrorNote message={lp.error ? userMessageOf(lp.error) : null} />
      {lp.data?.length === 0 && <T v="hint">When you add liquidity in a supported app, it shows up here.</T>}
      {lp.data?.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T style={{ fontWeight: "600" }}>{p.pair}</T>
            <Chip tone={p.inRange ? "accent" : "muted"}>{p.inRange ? "Earning" : "Not earning"}</Chip>
            <View style={{ flex: 1 }} />
            <T>{p.fiatValue !== undefined ? formatFiat(p.fiatValue, currency) : p.app}</T>
          </View>
          <T v="hint">{p.holdings}</T>
          <T v="hint">{p.status}</T>
          {p.fees ? <T v="hint">{p.fees}</T> : null}
          <Button variant="ghost" block onPress={() => navigate({ name: "browser", url: p.url })}>
            {`Manage in ${p.app}`}
          </Button>
        </Card>
      ))}

      <T v="h2">Featured apps</T>
      <ErrorNote message={featured.error ? userMessageOf(featured.error) : null} />
      {featured.data && featured.data.length === 0 && <Empty title="Nothing to show yet" />}
      {[...groups].map(([title, list]) => (
        <View key={title} style={{ gap: 6 }}>
          <T v="hint">{title}</T>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {list.map((d) => (
              <Pressable key={d.url} accessibilityRole="link" onPress={() => navigate({ name: "browser", url: d.url })} style={{ paddingVertical: 10, gap: 2 }}>
                <T style={{ fontWeight: "500" }}>{d.name}</T>
                <T v="hint">{`${d.description} · ${d.domain}`}</T>
              </Pressable>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}
