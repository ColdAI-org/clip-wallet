import { useMemo, useState } from "react";
import { userMessageOf, type PortfolioView } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, Button, Chip, Empty, ErrorNote, Row, Screen, Spinner, Toggle } from "../components";
import { IconArrowDown, IconArrowUp, IconExpand, IconLock, IconPin, IconSearch } from "../components/icons";
import { formatFiat, formatUnits, shortAddress } from "../lib/format";
import { mergeBalances, type MergedAsset } from "../lib/portfolio";

export function AssetRow(props: { asset: MergedAsset; currency: string; onOpen: () => void }) {
  const a = props.asset;
  return (
    <li>
      <button type="button" className="clip-asset-row" onClick={props.onOpen}>
        <AssetIcon symbol={a.symbol} logoUrl={a.logoUrl} />
        <span className="clip-asset-row__main">
          <span className="clip-asset-row__symbol">
            {a.symbol}
            {a.pinned && <IconPin width={13} height={13} aria-label="Pinned" className="clip-pin" />}
            {a.bridged && <Chip tone="muted">bridged</Chip>}
          </span>
          <span className="clip-asset-row__name">
            {formatUnits(a.amount, a.decimals, 4)} {a.symbol}
          </span>
        </span>
        <span className="clip-asset-row__fiat">{formatFiat(a.fiatValue, props.currency)}</span>
      </button>
    </li>
  );
}

export function Home() {
  const { client, state, variant, config, refresh } = useUi();
  const { navigate } = useRouter();
  const prefs = state?.prefs;
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { data, error, loading } = useAsync(() => client.getPortfolio(), [client, prefs?.displayCurrency]);
  const currency = data?.currency ?? prefs?.displayCurrency ?? "USD";

  const merged = useMemo(
    () =>
      mergeBalances(data?.balances ?? [], {
        pinned: prefs?.pinned,
        hideSmallBalances: prefs?.hideSmallBalances,
        showSpam: prefs?.showSpam,
        search,
      }),
    [data, prefs?.pinned, prefs?.hideSmallBalances, prefs?.showSpam, search],
  );

  const setPref = async (patch: Parameters<typeof client.setPrefs>[0]) => {
    await client.setPrefs(patch);
    await refresh();
  };

  return (
    <Screen
      nav
      title={<span className="clip-brand-title">{config.name}</span>}
      actions={
        <>
          <button type="button" className="clip-icon-btn" aria-label="Search assets" aria-expanded={searchOpen} onClick={() => setSearchOpen((o) => !o)}>
            <IconSearch />
          </button>
          {variant === "popup" && (
            <button type="button" className="clip-icon-btn" aria-label="Open in a tab" onClick={() => client.openFullTab("/")}>
              <IconExpand />
            </button>
          )}
          <button
            type="button"
            className="clip-icon-btn"
            aria-label="Lock wallet"
            onClick={async () => {
              await client.lock();
              await refresh();
            }}
          >
            <IconLock />
          </button>
        </>
      }
    >
      {state && state.pendingApprovals > 0 && (
        <button type="button" className="clip-banner" onClick={() => navigate("/approvals")}>
          {state.pendingApprovals === 1 ? "1 request is waiting for you" : `${state.pendingApprovals} requests are waiting for you`}
        </button>
      )}

      <div className="clip-total">
        <span className="clip-total__label">Total balance</span>
        <span className="clip-total__value" data-testid="total">
          {loading && !data ? <Spinner /> : formatFiat(merged.total, currency)}
        </span>
      </div>

      <div className="clip-actions clip-actions--hero">
        <Button onClick={() => navigate("/send")}>
          <IconArrowUp /> Send
        </Button>
        <Button variant="secondary" onClick={() => navigate("/receive")}>
          <IconArrowDown /> Receive
        </Button>
      </div>

      {searchOpen && (
        <div className="clip-search">
          <IconSearch />
          <input
            aria-label="Search assets"
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <ErrorNote message={error ? userMessageOf(error) : null} />

      {data && merged.assets.length === 0 ? (
        <Empty title={search ? "Nothing matches that search" : "Nothing here yet"}>
          {!search && "Tap Receive to add money from another wallet or exchange."}
        </Empty>
      ) : (
        <ul className="clip-list" aria-label="Your assets">
          {merged.assets.map((a) => (
            <AssetRow key={a.id} asset={a} currency={currency} onOpen={() => navigate(`/asset/${encodeURIComponent(a.id)}`)} />
          ))}
        </ul>
      )}

      {data && (
        <div className="clip-home-foot">
          <Toggle label="Hide small balances" checked={!!prefs?.hideSmallBalances} onChange={(v) => setPref({ hideSmallBalances: v })} />
          {(merged.hiddenSpam > 0 || prefs?.showSpam) && (
            <button type="button" className="clip-link" onClick={() => setPref({ showSpam: !prefs?.showSpam })}>
              {prefs?.showSpam ? "Hide suspicious tokens" : `${merged.hiddenSpam} suspicious token${merged.hiddenSpam === 1 ? "" : "s"} hidden`}
            </button>
          )}
          {data.stale.length > 0 && <p className="clip-hint">Some balances may be a few minutes old.</p>}
        </div>
      )}
    </Screen>
  );
}

export function networkName(portfolio: PortfolioView | undefined, id: string): string {
  return portfolio?.networks.find((n) => n.id === id)?.name ?? id;
}

export function AssetDetail(props: { id: string }) {
  const { client, state, refresh } = useUi();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const prefs = state?.prefs;
  const currency = data?.currency ?? prefs?.displayCurrency ?? "USD";
  const asset = useMemo(
    () => mergeBalances(data?.balances ?? [], { showSpam: true, pinned: prefs?.pinned }).assets.find((a) => a.id === props.id),
    [data, props.id, prefs?.pinned],
  );
  if (!data) return <Screen back title="Asset"><Spinner /></Screen>;
  if (!asset) return <Screen back title="Asset"><Empty title="You don't hold this anymore" /></Screen>;

  const togglePin = async () => {
    const pinned = new Set(prefs?.pinned ?? []);
    if (pinned.has(asset.id)) pinned.delete(asset.id);
    else pinned.add(asset.id);
    await client.setPrefs({ pinned: [...pinned] });
    await refresh();
  };

  return (
    <Screen
      back
      title={asset.name}
      actions={
        <button type="button" className={`clip-icon-btn ${asset.pinned ? "is-active" : ""}`} aria-pressed={asset.pinned} aria-label={asset.pinned ? "Unpin" : "Pin to top"} onClick={togglePin}>
          <IconPin />
        </button>
      }
    >
      <div className="clip-total">
        <AssetIcon symbol={asset.symbol} logoUrl={asset.logoUrl} size={48} />
        <span className="clip-total__value">
          {formatUnits(asset.amount, asset.decimals, 6)} {asset.symbol}
        </span>
        <span className="clip-total__label">{formatFiat(asset.fiatValue, currency)}</span>
        {asset.bridged && <Chip tone="muted">bridged copy — not the original {asset.symbol}</Chip>}
      </div>
      <div className="clip-actions clip-actions--hero">
        <Button onClick={() => navigate(`/send?asset=${encodeURIComponent(asset.key)}`)}>
          <IconArrowUp /> Send
        </Button>
        <Button variant="secondary" onClick={() => navigate(`/receive?asset=${encodeURIComponent(asset.key)}`)}>
          <IconArrowDown /> Receive
        </Button>
      </div>
      {asset.parts.length > 1 || prefs?.advanced ? (
        <section aria-labelledby="split-h">
          <h2 id="split-h" className="clip-h2">
            Where it is
          </h2>
          <div className="clip-rows" data-testid="network-split">
            {asset.parts.map((p) => (
              <Row
                key={p.asset.networkId + (p.asset.address ?? "")}
                label={networkName(data, p.asset.networkId)}
                value={`${formatUnits(p.amount, p.asset.decimals, 4)} ${p.asset.symbol}`}
                hint={formatFiat(p.fiatValue, currency)}
              />
            ))}
          </div>
          <p className="clip-hint">You don't need to manage this — {asset.symbol} is spent from wherever it is.</p>
        </section>
      ) : null}
      {prefs?.advanced &&
        asset.parts.map((p) =>
          p.asset.address ? (
            <Row key={`addr-${p.asset.networkId}`} label={`Contract (${networkName(data, p.asset.networkId)})`} value={<code className="clip-mono">{shortAddress(p.asset.address, 6)}</code>} />
          ) : null,
        )}
    </Screen>
  );
}
