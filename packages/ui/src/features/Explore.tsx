import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Screen, Spinner } from "../components";
import { formatFiat } from "../lib/format";
import type { FeaturedDappView } from "./client";
import { useFeatures } from "./context";

const CATEGORY: Record<FeaturedDappView["category"], string> = {
  swap: "Swap",
  lend: "Lend and borrow",
  stake: "Stake",
  nft: "Collectibles",
  bridge: "Move between apps",
  pay: "Pay",
  tools: "Tools",
};

/** Featured apps (curated, verified domains) and your liquidity positions. */
export function Explore() {
  const features = useFeatures();
  const { state } = useUi();
  const apps = useAsync(() => features.featured(), [features]);
  const lp = useAsync(() => features.lpPositions(), [features]);
  const groups = new Map<string, FeaturedDappView[]>();
  for (const d of apps.data ?? []) {
    const k = CATEGORY[d.category];
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return (
    <Screen nav title="Explore">
      <h2 className="clip-h2">Your liquidity</h2>
      {lp.error ? <ErrorNote message={userMessageOf(lp.error)} /> : null}
      {!lp.data && !lp.error && <Spinner />}
      {lp.data?.length === 0 && <p className="clip-hint">When you add liquidity in a supported app, it shows up here.</p>}
      {lp.data?.map((p) => (
        <Card key={p.id}>
          <div className="clip-row">
            <span className="clip-row__label">
              <strong>{p.pair}</strong> <Chip tone={p.inRange ? "accent" : "muted"}>{p.inRange ? "Earning" : "Not earning"}</Chip>
            </span>
            <span className="clip-row__value">{p.fiatValue !== undefined ? formatFiat(p.fiatValue, state?.prefs.displayCurrency ?? "USD") : p.app}</span>
          </div>
          <p className="clip-hint">{p.holdings}</p>
          <p className="clip-hint">{p.status}</p>
          {p.fees && <p className="clip-hint">{p.fees}</p>}
          <Button variant="ghost" onClick={() => void features.openExternal(p.url)}>
            Manage in {p.app}
          </Button>
        </Card>
      ))}

      <h2 className="clip-h2">Featured apps</h2>
      {apps.error ? <ErrorNote message={userMessageOf(apps.error)} /> : null}
      {apps.data?.length === 0 && <Empty title="No featured apps yet" />}
      {[...groups].map(([title, list]) => (
        <section key={title} aria-label={title}>
          <h3 className="clip-hint">{title}</h3>
          <ul className="clip-list">
            {list.map((d) => (
              <li key={d.domain}>
                <button type="button" className="clip-asset-row" onClick={() => void features.openExternal(d.url)}>
                  <span className="clip-asset-row__main">
                    <span className="clip-asset-row__symbol">{d.name}</span>
                    <span className="clip-asset-row__name">
                      {d.description} · {d.domain}
                    </span>
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
