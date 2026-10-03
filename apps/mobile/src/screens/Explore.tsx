/**
 * Explore: Discover (trending tokens, top pools, new tokens on the user's networks; packages/ui/src/social/Discover.tsx),
 * then what's staked and featured apps (open in the in-app browser), from the same feature services as the
 * extension. There is no native Swap screen on the phone yet, so a Discover row opens a DEX in the in-app
 * browser with the token prefilled (lib/swap-links.ts).
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatFiat, relativeTime, userMessageOf, type DiscoverFeed, type DiscoverToken } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, Card, Chip, Empty, ErrorNote, Row, Screen, Spinner, T } from "../ui/kit";
import { useFormat, useMobileT, type MobileMessageId } from "../i18n";
import { externalSwapUrl } from "../lib/swap-links";
import { socialErrorText } from "../lib/social-errors";

function TokenRow(props: { token: DiscoverToken; detail?: string; label?: string; testID?: string }) {
  const { navigate, theme, state } = useWallet();
  const t = useMobileT();
  const f = useFormat();
  const tk = props.token;
  const url = externalSwapUrl(tk);
  const pct = tk.change24hPct;
  const body = (
    <>
      <AssetIcon symbol={tk.symbol} size={32} />
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: "600" }} numberOfLines={1}>
          {props.label ?? tk.symbol}
        </T>
        <T v="hint" numberOfLines={1}>
          {`${props.label ? tk.symbol : tk.name}${props.detail ? ` · ${props.detail}` : ""}${state?.prefs.advanced && tk.chain ? ` · ${tk.chain}` : ""}`}
        </T>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        {tk.priceUsd !== undefined && <T style={{ fontSize: 15 }}>{formatFiat(tk.priceUsd, "USD")}</T>}
        {pct !== undefined && (
          <T v="hint" color={pct < 0 ? theme.c.dangerFg : theme.c.positive}>
            {f.percent(pct, { signed: true, maxFraction: 1 })}
          </T>
        )}
      </View>
    </>
  );
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingVertical: 10 };
  if (!url) return <View style={style} testID={props.testID}>{body}</View>;
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={t("m.social.discover.swap", { symbol: tk.swap.symbol })} testID={props.testID} onPress={() => navigate({ name: "browser", url })} style={style}>
      {body}
    </Pressable>
  );
}

function Section(props: { title: MobileMessageId; unavailable: boolean; empty: boolean; children: React.ReactNode }) {
  const t = useMobileT();
  return (
    <View style={{ gap: 6 }} accessibilityLabel={t(props.title)}>
      <T v="label">{t(props.title)}</T>
      {props.unavailable && <T v="hint">{t("m.social.discover.unavailable")}</T>}
      {!props.unavailable && props.empty && <T v="hint">{t("m.social.discover.empty")}</T>}
      {!props.empty && <Card style={{ gap: 0, paddingVertical: 4 }}>{props.children}</Card>}
    </View>
  );
}

function Discover() {
  const { wallet } = useWallet();
  const t = useMobileT();
  const f = useFormat();
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useAsync<DiscoverFeed>(() => wallet.social.discover(refresh ? { refresh: true } : {}), [wallet, refresh]);
  // Compact money for pool sizes: "$2.8M", "2,8 Mio. $".
  const usd = (v: number) => f.number(v, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  return (
    <View style={{ gap: 12 }} testID="discover">
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <T v="h2" style={{ flex: 1 }}>
          {t("m.social.discover.title")}
        </T>
        <Button variant="ghost" style={{ flex: 0, paddingVertical: 6, paddingHorizontal: 10 }} onPress={() => setRefresh((n) => n + 1)}>
          {t("m.social.discover.refresh")}
        </Button>
      </View>
      {error ? <ErrorNote message={socialErrorText(error, t)} /> : null}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <Section title="m.social.discover.trending" unavailable={data.unavailable.includes("trending")} empty={data.trending.length === 0}>
            {data.trending.map((tk) => (
              <TokenRow key={tk.id} token={tk} testID={`discover-${tk.id}`} />
            ))}
          </Section>
          <Section title="m.social.discover.pools" unavailable={data.unavailable.includes("topPools")} empty={data.topPools.length === 0}>
            {data.topPools.map((p) => (
              <TokenRow key={p.id} token={p.token} label={p.pair} detail={t("m.social.discover.volume", { amount: usd(p.volume24hUsd) })} testID={`discover-${p.id}`} />
            ))}
          </Section>
          <Section title="m.social.discover.new" unavailable={data.unavailable.includes("newTokens")} empty={data.newTokens.length === 0}>
            {data.newTokens.map((tk) => (
              <TokenRow key={tk.id} token={tk} detail={tk.liquidityUsd !== undefined ? t("m.social.discover.liquidity", { amount: usd(tk.liquidityUsd) }) : undefined} testID={`discover-${tk.id}`} />
            ))}
          </Section>
          <T v="hint">{t("m.social.discover.updated", { when: relativeTime(data.updatedAt) })}</T>
        </>
      )}
      <T v="hint">{t("m.social.discover.note")}</T>
    </View>
  );
}

export function Explore() {
  const { wallet, navigate } = useWallet();
  const t = useMobileT();
  const featured = useAsync(() => wallet.features.featured(), [wallet]);
  const staking = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  return (
    <Screen back title={t("m.explore.title")}>
      <Discover />
      <T v="h2">{t("m.explore.staking")}</T>
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
          {!a.unavailable && a.positions.length === 0 && <T v="hint">{t("m.explore.nothingStaked")}</T>}
        </Card>
      ))}
      <T v="h2">{t("m.explore.featured")}</T>
      <ErrorNote message={featured.error ? userMessageOf(featured.error) : null} />
      {featured.data && featured.data.length === 0 && <Empty title={t("m.explore.empty")} />}
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
