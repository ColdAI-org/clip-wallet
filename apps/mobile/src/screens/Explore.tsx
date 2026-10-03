/**
 * Explore tab: the extension's Explore (packages/ui/src/features/Explore.tsx) plus its "More" menu. Stake, Swap,
 * Buy and Secure Trade; Discover (trending tokens, top pools, new tokens on the user's networks;
 * packages/ui/src/social/Discover.tsx); what's staked; your liquidity positions; featured apps (curated, verified
 * domains) open in the in-app browser so they can connect. A Discover row opens a DEX in the in-app browser with
 * the token prefilled (lib/swap-links.ts): the native Swap screen can't quote tokens the wallet doesn't list yet.
 */
import { useState } from "react";
import { Pressable, View } from "react-native";
import { formatFiat, relativeTime, userMessageOf, type DiscoverFeed, type DiscoverToken, type FeaturedDappView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { AssetIcon, Button, Card, Chip, Empty, ErrorNote, MenuItem, Row, Screen, Spinner, T } from "../ui/kit";
import { useFormat, useMobileT, type MobileMessageId } from "../i18n";
import { APP } from "../env";
import { externalSwapUrl } from "../lib/swap-links";
import { socialErrorText } from "../lib/social-errors";
import { tradeText } from "../lib/trade-text";

const CATEGORY: Record<FeaturedDappView["category"], MobileMessageId> = {
  swap: "m.explore.category.swap",
  lend: "m.explore.category.lend",
  stake: "m.explore.category.stake",
  nft: "m.explore.category.nft",
  bridge: "m.explore.category.bridge",
  pay: "m.explore.category.pay",
  tools: "m.explore.category.tools",
  trade: "m.explore.category.trade",
};

const KIND: Record<NonNullable<FeaturedDappView["kind"]>, MobileMessageId> = {
  perps: "m.explore.kind.perps",
  predictions: "m.explore.kind.predictions",
  stocks: "m.explore.kind.stocks",
  funds: "m.explore.kind.funds",
  yield: "m.explore.kind.yield",
};

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
  const { wallet, navigate, state } = useWallet();
  const t = useMobileT();
  const featured = useAsync(() => wallet.features.featured(), [wallet]);
  const staking = useAsync(() => wallet.features.stakingOverview(), [wallet]);
  const lp = useAsync(() => wallet.features.lpPositions(), [wallet]);
  const currency = state?.prefs.displayCurrency ?? "USD";
  const groups = new Map<string, FeaturedDappView[]>();
  const trade = (featured.data ?? []).filter((d) => d.category === "trade");
  for (const d of (featured.data ?? []).filter((x) => x.category !== "trade")) {
    const k = t(CATEGORY[d.category]);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return (
    <Screen nav title={t("m.explore.title")}>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <MenuItem title={t("m.explore.menu.stake")} hint={t("m.explore.menu.stakeHint")} testID="explore-stake" onPress={() => navigate({ name: "stake" })} />
        <MenuItem title={t("m.explore.menu.swap")} hint={t("m.explore.menu.swapHint")} testID="explore-swap" onPress={() => navigate({ name: "swap" })} />
        <MenuItem title={t("m.explore.menu.buy")} hint={t("m.explore.menu.buyHint")} testID="explore-buy" onPress={() => navigate({ name: "buy" })} />
        <MenuItem title={t("m.explore.menu.trade")} hint={t("m.explore.menu.tradeHint")} testID="explore-trade" onPress={() => navigate({ name: "trade" })} />
      </Card>

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

      <T v="h2">{t("m.explore.liquidity")}</T>
      <ErrorNote message={lp.error ? userMessageOf(lp.error) : null} />
      {lp.data?.length === 0 && <T v="hint">{t("m.explore.liquidityEmpty")}</T>}
      {lp.data?.map((p) => (
        <Card key={p.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T style={{ fontWeight: "600" }}>{p.pair}</T>
            <Chip tone={p.inRange ? "accent" : "muted"}>{p.inRange ? t("m.explore.earning") : t("m.explore.notEarning")}</Chip>
            <View style={{ flex: 1 }} />
            <T>{p.fiatValue !== undefined ? formatFiat(p.fiatValue, currency) : p.app}</T>
          </View>
          <T v="hint">{p.holdings}</T>
          <T v="hint">{p.status}</T>
          {p.fees ? <T v="hint">{p.fees}</T> : null}
          <Button variant="ghost" block onPress={() => navigate({ name: "browser", url: p.url })}>
            {t("m.explore.manageIn", { app: p.app })}
          </Button>
        </Card>
      ))}

      <T v="h2">{t("m.explore.featured")}</T>
      <ErrorNote message={featured.error ? userMessageOf(featured.error) : null} />
      {featured.data && featured.data.length === 0 && <Empty title={t("m.explore.empty")} />}
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

      {trade.length > 0 && (
        <View style={{ gap: 6 }} testID="trade-and-earn">
          <T v="h2">{t("m.explore.category.trade")}</T>
          <T v="hint">{t("m.explore.tradeDisclaimer", { name: APP.config.name })}</T>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {trade.map((d) => {
              const text = tradeText(d, t);
              return (
                <Pressable key={d.url} accessibilityRole="link" onPress={() => navigate({ name: "browser", url: d.url })} style={{ paddingVertical: 10, gap: 2 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <T style={{ fontWeight: "500" }}>{d.name}</T>
                    {d.kind && <Chip tone="muted">{t(KIND[d.kind])}</Chip>}
                  </View>
                  <T v="hint">{`${text.description} · ${d.domain}`}</T>
                  {text.note ? <T v="hint">{text.note}</T> : null}
                </Pressable>
              );
            })}
          </Card>
        </View>
      )}
    </Screen>
  );
}
