import { useState } from "react";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, Button, ErrorNote, Spinner } from "../components";
import { formatFiat, relativeTime } from "../lib/format";
import { useFormat, useUiT, type UiMessageId } from "../i18n";
import type { DiscoverFeed, DiscoverToken } from "./client";
import { useSocial } from "./context";
import { socialErrorText } from "./errors";

/** Where a Discover item's Swap goes: a wallet asset by key, or a token reference the swap screen can quote. */
export function swapRoute(t: DiscoverToken): string {
  const q = new URLSearchParams({ buy: t.swap.buy });
  if (!t.swap.assetKey) q.set("buySymbol", t.swap.symbol);
  return `/swap?${q.toString()}`;
}

function Change(props: { pct?: number }) {
  const f = useFormat();
  if (props.pct === undefined) return null;
  return <span className={`clip-change ${props.pct < 0 ? "is-out" : "is-in"}`}>{f.percent(props.pct, { signed: true, maxFraction: 1 })}</span>;
}

function TokenRow(props: { token: DiscoverToken; detail?: string; label?: string }) {
  const t = useUiT();
  const { navigate } = useRouter();
  const { state } = useUi();
  const tk = props.token;
  return (
    <li>
      <button type="button" className="clip-asset-row" onClick={() => navigate(swapRoute(tk))} aria-label={t("social.discover.swap", { symbol: tk.swap.symbol })}>
        <AssetIcon symbol={tk.symbol} size={32} />
        <span className="clip-asset-row__main">
          <span className="clip-asset-row__symbol">{props.label ?? tk.symbol}</span>
          <span className="clip-asset-row__name">
            {props.label ? tk.symbol : tk.name}
            {props.detail ? ` · ${props.detail}` : ""}
            {state?.prefs.advanced && tk.chain ? ` · ${tk.chain}` : ""}
          </span>
        </span>
        <span className="clip-asset-row__fiat">
          {tk.priceUsd !== undefined ? formatFiat(tk.priceUsd, "USD") : ""} <Change pct={tk.change24hPct} />
        </span>
      </button>
    </li>
  );
}

function Section(props: { title: UiMessageId; unavailable: boolean; empty: boolean; children: React.ReactNode }) {
  const t = useUiT();
  return (
    <section aria-label={t(props.title)}>
      <h3 className="clip-h2">{t(props.title)}</h3>
      {props.unavailable && <p className="clip-hint">{t("social.discover.unavailable")}</p>}
      {!props.unavailable && props.empty && <p className="clip-hint">{t("social.discover.empty")}</p>}
      <ul className="clip-list">{props.children}</ul>
    </section>
  );
}

/** Trending tokens, top pools and new tokens on the user's networks; every row opens Swap. */
export function Discover() {
  const t = useUiT();
  const f = useFormat();
  const social = useSocial();
  const [refresh, setRefresh] = useState(0);
  const { data, error } = useAsync<DiscoverFeed>(() => social.discover(refresh ? { refresh: true } : {}), [social, refresh]);
  // Compact money for pool sizes: "$2.8M", "2,8 Mio. $".
  const usd = (v: number) => f.number(v, { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
  return (
    <section className="clip-discover" aria-labelledby="discover-h">
      <div className="clip-row">
        <h2 id="discover-h" className="clip-h2">
          {t("social.discover.title")}
        </h2>
        <Button variant="ghost" onClick={() => setRefresh((n) => n + 1)}>
          {t("social.discover.refresh")}
        </Button>
      </div>
      {error ? <ErrorNote message={socialErrorText(error, t)} /> : null}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <Section title="social.discover.trending" unavailable={data.unavailable.includes("trending")} empty={data.trending.length === 0}>
            {data.trending.map((tk) => (
              <TokenRow key={tk.id} token={tk} />
            ))}
          </Section>
          <Section title="social.discover.pools" unavailable={data.unavailable.includes("topPools")} empty={data.topPools.length === 0}>
            {data.topPools.map((p) => (
              <TokenRow key={p.id} token={p.token} label={p.pair} detail={t("social.discover.volume", { amount: usd(p.volume24hUsd) })} />
            ))}
          </Section>
          <Section title="social.discover.new" unavailable={data.unavailable.includes("newTokens")} empty={data.newTokens.length === 0}>
            {data.newTokens.map((tk) => (
              <TokenRow key={tk.id} token={tk} detail={tk.liquidityUsd !== undefined ? t("social.discover.liquidity", { amount: usd(tk.liquidityUsd) }) : undefined} />
            ))}
          </Section>
          <p className="clip-hint">{t("social.discover.note")}</p>
          <p className="clip-hint">{t("social.discover.updated", { when: relativeTime(data.updatedAt) })}</p>
        </>
      )}
    </section>
  );
}
