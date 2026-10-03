import { useMemo, useState } from "react";
import type { Nft } from "@clip-wallet/core";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { CopyButton, Empty, ErrorNote, NftMedia, Row, Screen, Spinner } from "../components";
import { looksLikeLink } from "../lib/media";
import { useUiT } from "../i18n";

export interface CollectionGroup {
  key: string;
  name: string;
  items: Nft[];
}

export function nftId(n: Nft): string {
  return `${n.networkId}|${n.collection.address}|${n.tokenId}`;
}

export function groupCollectibles(nfts: Nft[], opts: { network?: string; showSpam?: boolean } = {}): CollectionGroup[] {
  const map = new Map<string, CollectionGroup>();
  for (const n of nfts) {
    if (n.spam && !opts.showSpam) continue;
    if (opts.network && n.networkId !== opts.network) continue;
    const key = `${n.networkId}|${n.collection.address}`;
    const g = map.get(key) ?? { key, name: n.collection.name, items: [] };
    g.items.push(n);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

export function Collectibles() {
  const t = useUiT();
  const { client, state } = useUi();
  const { navigate } = useRouter();
  const { data, error, loading } = useAsync(() => client.getCollectibles(), [client]);
  const { data: portfolio } = useAsync(() => client.getPortfolio(), [client]);
  const [network, setNetwork] = useState<string>("");
  const showSpam = !!state?.prefs.showSpam;

  const groups = useMemo(() => groupCollectibles(data ?? [], { network: network || undefined, showSpam }), [data, network, showSpam]);
  const networksPresent = useMemo(() => [...new Set((data ?? []).filter((n) => showSpam || !n.spam).map((n) => n.networkId))], [data, showSpam]);
  const name = (id: string) => portfolio?.networks.find((n) => n.id === id)?.name ?? id;

  return (
    <Screen nav title={t("collectibles.title")}>
      {networksPresent.length > 1 && (
        <div className="clip-filter">
          <label className="clip-filter__label" htmlFor="nft-network-filter">
            {t("collectibles.filter.show")}
          </label>
          <select id="nft-network-filter" className="clip-select" value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="">{t("collectibles.filter.everything")}</option>
            {networksPresent.map((id) => (
              <option key={id} value={id}>
                {t("collectibles.filter.only", { network: name(id) })}
              </option>
            ))}
          </select>
        </div>
      )}
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {loading && !data && <Spinner />}
      {data && groups.length === 0 && <Empty title={t("collectibles.emptyTitle")}>{t("collectibles.emptyBody")}</Empty>}
      {groups.map((g) => (
        <section key={g.key} className="clip-collection" aria-labelledby={`c-${g.key}`}>
          <h2 id={`c-${g.key}`} className="clip-h2">
            {g.name} <span className="clip-count">{g.items.length}</span>
          </h2>
          <ul className="clip-gallery">
            {g.items.map((n) => (
              <li key={nftId(n)}>
                <button type="button" className="clip-nft-tile" onClick={() => navigate(`/collectible/${encodeURIComponent(nftId(n))}`)}>
                  <NftMedia nft={n} />
                  <span className="clip-nft-tile__name">{n.name ?? t("collectibles.tokenNumber", { tokenId: n.tokenId })}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Screen>
  );
}

export function CollectibleDetail(props: { id: string }) {
  const t = useUiT();
  const { client, state } = useUi();
  const { data } = useAsync(() => client.getCollectibles(), [client]);
  const { data: portfolio } = useAsync(() => client.getPortfolio(), [client]);
  const nft = data?.find((n) => nftId(n) === props.id);
  if (!data) return <Screen back title={t("collectibles.detail.title")}><Spinner /></Screen>;
  if (!nft) return <Screen back title={t("collectibles.detail.title")}><Empty title={t("collectibles.detail.gone")} /></Screen>;
  const advanced = !!state?.prefs.advanced;
  return (
    <Screen back title={nft.collection.name}>
      <NftMedia nft={nft} size="full" />
      <h1 className="clip-h1">{nft.name ?? t("collectibles.tokenNumber", { tokenId: nft.tokenId })}</h1>
      {nft.attributes && nft.attributes.length > 0 && (
        <div className="clip-rows">
          {nft.attributes.map((a) =>
            looksLikeLink(a.value) ? (
              // Links in metadata are shown as inert text, never opened automatically.
              <Row key={a.trait} label={a.trait} value={<span className="clip-inert-link">{a.value}</span>} hint={<CopyButton value={a.value} label={t("collectibles.detail.copyLink")} />} />
            ) : (
              <Row key={a.trait} label={a.trait} value={a.value} />
            ),
          )}
        </div>
      )}
      {advanced && (
        <div className="clip-rows clip-advanced-block">
          <Row label={t("collectibles.detail.network")} value={portfolio?.networks.find((n) => n.id === nft.networkId)?.name ?? nft.networkId} />
          <Row label={t("collectibles.detail.standard")} value={nft.standard} />
          <Row label={t("collectibles.detail.tokenId")} value={<code className="clip-mono">{nft.tokenId}</code>} />
          <Row label={t("collectibles.detail.collection")} value={<code className="clip-mono">{nft.collection.address}</code>} />
        </div>
      )}
    </Screen>
  );
}
