import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Screen, Spinner } from "../components";
import { formatFiat } from "../lib/format";
import type { FeaturedDappView } from "./client";
import { useFeatures } from "./context";
import { useUiT, type UiMessageId } from "../i18n";
import { useSocialOptional } from "../social/context";
import { Discover } from "../social/Discover";

const CATEGORY: Record<FeaturedDappView["category"], UiMessageId> = {
  swap: "explore.category.swap",
  lend: "explore.category.lend",
  stake: "explore.category.stake",
  nft: "explore.category.nft",
  bridge: "explore.category.bridge",
  pay: "explore.category.pay",
  tools: "explore.category.tools",
};

/** Discover (trending tokens, top pools, new tokens; social stream), featured apps and your liquidity positions. */
export function Explore() {
  const t = useUiT();
  const social = useSocialOptional();
  const features = useFeatures();
  const { state } = useUi();
  const apps = useAsync(() => features.featured(), [features]);
  const lp = useAsync(() => features.lpPositions(), [features]);
  const groups = new Map<string, FeaturedDappView[]>();
  for (const d of apps.data ?? []) {
    const k = t(CATEGORY[d.category]);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return (
    <Screen nav title={t("explore.title")}>
      {social && <Discover />}
      <h2 className="clip-h2">{t("explore.liquidity")}</h2>
      {lp.error ? <ErrorNote message={userMessageOf(lp.error)} /> : null}
      {!lp.data && !lp.error && <Spinner />}
      {lp.data?.length === 0 && <p className="clip-hint">{t("explore.liquidityEmpty")}</p>}
      {lp.data?.map((p) => (
        <Card key={p.id}>
          <div className="clip-row">
            <span className="clip-row__label">
              <strong>{p.pair}</strong> <Chip tone={p.inRange ? "accent" : "muted"}>{p.inRange ? t("explore.earning") : t("explore.notEarning")}</Chip>
            </span>
            <span className="clip-row__value">{p.fiatValue !== undefined ? formatFiat(p.fiatValue, state?.prefs.displayCurrency ?? "USD") : p.app}</span>
          </div>
          <p className="clip-hint">{p.holdings}</p>
          <p className="clip-hint">{p.status}</p>
          {p.fees && <p className="clip-hint">{p.fees}</p>}
          <Button variant="ghost" onClick={() => void features.openExternal(p.url)}>
            {t("explore.manageIn", { app: p.app })}
          </Button>
        </Card>
      ))}

      <h2 className="clip-h2">{t("explore.featured")}</h2>
      {apps.error ? <ErrorNote message={userMessageOf(apps.error)} /> : null}
      {apps.data?.length === 0 && <Empty title={t("explore.featuredEmpty")} />}
      {[...groups].map(([title, list]) => (
        <section key={title} aria-label={title}>
          <h3 className="clip-hint">{title}</h3>
          <ul className="clip-list">
            {list.map((d) => (
              <li key={d.domain}>
                <button type="button" className="clip-asset-row" onClick={() => void features.openExternal(d.url)}>
                  <span className="clip-asset-row__main">
                    <span className="clip-asset-row__symbol">{d.name}</span>
                    <span className="clip-asset-row__name">{t("explore.appLine", { description: d.description, domain: d.domain })}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  );
}
