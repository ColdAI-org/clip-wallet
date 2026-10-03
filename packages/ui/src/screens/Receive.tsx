import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, CopyButton, ErrorNote, Qr, Screen, Spinner } from "../components";
import { IconChevron } from "../components/icons";
import { mergeBalances } from "../lib/portfolio";
import { useUiT } from "../i18n";

/** Receive: pick the asset first, then show the right address. Networks appear only when ambiguous. */
export function Receive(props: { assetKey?: string }) {
  const t = useUiT();
  const { client } = useUi();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const choices = useMemo(() => {
    const held = mergeBalances(data?.balances ?? []).assets.filter((a) => !a.bridged).map((a) => ({ key: a.key, symbol: a.symbol, name: a.name }));
    const keys = new Set(held.map((h) => h.key));
    // Assets the wallet can receive even with a zero balance (native coins and curated tokens).
    const extra = (data?.assets ?? [])
      .filter((a) => !keys.has(a.key) && !a.bridged && !a.spam)
      .map((a) => ({ key: a.key, symbol: a.symbol, name: a.name }));
    return [...held, ...extra.filter((e, i) => extra.findIndex((x) => x.key === e.key) === i)];
  }, [data]);

  if (!props.assetKey) {
    return (
      <Screen back title={t("receive.title")}>
        <p className="clip-lede">{t("receive.pick")}</p>
        {!data ? (
          <Spinner />
        ) : (
          <ul className="clip-list" aria-label={t("receive.assetsList")}>
            {choices.map((c) => (
              <li key={c.key}>
                <button type="button" className="clip-asset-row" onClick={() => navigate(`/receive?asset=${encodeURIComponent(c.key)}`, { replace: true })}>
                  <AssetIcon symbol={c.symbol} />
                  <span className="clip-asset-row__main">
                    <span className="clip-asset-row__symbol">{c.symbol}</span>
                    <span className="clip-asset-row__name">{c.name}</span>
                  </span>
                  <IconChevron />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Screen>
    );
  }
  return <ReceiveAddress assetKey={props.assetKey} />;
}

function ReceiveAddress(props: { assetKey: string }) {
  const t = useUiT();
  const { client } = useUi();
  const { data, error } = useAsync(() => client.getReceiveTargets({ assetKey: props.assetKey }), [client, props.assetKey]);
  const [idx, setIdx] = useState(0);
  if (error) return <Screen back title={t("receive.title")}><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back title={t("receive.title")}><Spinner /></Screen>;
  const target = data[Math.min(idx, data.length - 1)];
  if (!target) return <Screen back title={t("receive.title")}><ErrorNote message={t("receive.cantReceive")} /></Screen>;
  const ambiguous = data.length > 1 || target.networks.length > 1;
  const shown = target.displayAddress ?? target.address;
  return (
    <Screen back title={t("receive.titleAsset", { symbol: target.asset.symbol })}>
      {data.length > 1 && (
        <div className="clip-segmented" role="tablist" aria-label={t("receive.senderNetwork")}>
          {data.map((d, i) => (
            <button key={d.address} type="button" role="tab" aria-selected={i === idx} className={i === idx ? "is-active" : ""} onClick={() => setIdx(i)}>
              {d.networks.length === 1 ? d.networks[0]!.name : t("receive.networkMore", { network: d.networks[0]!.name, n: d.networks.length - 1 })}
            </button>
          ))}
        </div>
      )}
      <div className="clip-receive">
        <Qr value={shown} label={t("receive.qr", { symbol: target.asset.symbol })} />
        <code className="clip-address" data-testid="receive-address">
          {shown}
        </code>
        <CopyButton value={shown} label={t("receive.copyAddress")} />
        {ambiguous && (
          <p className="clip-notice clip-notice--info">
            {target.networks.length > 1
              ? t("receive.manyNetworks", { symbol: target.asset.symbol, networks: target.networks.map((n) => n.name).join(", ") })
              : t("receive.oneNetwork", { network: target.networks[0]!.name })}
          </p>
        )}
      </div>
    </Screen>
  );
}
