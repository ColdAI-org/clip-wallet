import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { AssetIcon, CopyButton, ErrorNote, Qr, Screen, Spinner } from "../components";
import { IconChevron } from "../components/icons";
import { mergeBalances } from "../lib/portfolio";

const COMMON_RECEIVE = ["usdc", "eth", "hbar", "sol", "btc"];

/** Receive: pick the asset first, then show the right address. Networks appear only when ambiguous. */
export function Receive(props: { assetKey?: string }) {
  const { client } = useUi();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const choices = useMemo(() => {
    const held = mergeBalances(data?.balances ?? []).assets.filter((a) => !a.bridged).map((a) => ({ key: a.key, symbol: a.symbol, name: a.name }));
    const keys = new Set(held.map((h) => h.key));
    // Assets the wallet can receive even with a zero balance (native coins and USDC).
    const extra = (data?.balances ?? [])
      .filter((b) => COMMON_RECEIVE.includes(b.asset.key) && !keys.has(b.asset.key) && !b.asset.bridged)
      .map((b) => ({ key: b.asset.key, symbol: b.asset.symbol, name: b.asset.name }));
    return [...held, ...extra.filter((e, i) => extra.findIndex((x) => x.key === e.key) === i)];
  }, [data]);

  if (!props.assetKey) {
    return (
      <Screen back title="Receive">
        <p className="clip-lede">What would you like to receive?</p>
        {!data ? (
          <Spinner />
        ) : (
          <ul className="clip-list" aria-label="Assets you can receive">
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
  const { client } = useUi();
  const { data, error } = useAsync(() => client.getReceiveTargets({ assetKey: props.assetKey }), [client, props.assetKey]);
  const [idx, setIdx] = useState(0);
  if (error) return <Screen back title="Receive"><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back title="Receive"><Spinner /></Screen>;
  const t = data[Math.min(idx, data.length - 1)];
  if (!t) return <Screen back title="Receive"><ErrorNote message="This wallet can't receive that yet." /></Screen>;
  const ambiguous = data.length > 1 || t.networks.length > 1;
  const shown = t.displayAddress ?? t.address;
  return (
    <Screen back title={`Receive ${t.asset.symbol}`}>
      {data.length > 1 && (
        <div className="clip-segmented" role="tablist" aria-label="Where the sender is">
          {data.map((d, i) => (
            <button key={d.address} type="button" role="tab" aria-selected={i === idx} className={i === idx ? "is-active" : ""} onClick={() => setIdx(i)}>
              {d.networks.length === 1 ? d.networks[0]!.name : `${d.networks[0]!.name} +${d.networks.length - 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="clip-receive">
        <Qr value={shown} label={`QR code for your ${t.asset.symbol} address`} />
        <code className="clip-address" data-testid="receive-address">
          {shown}
        </code>
        <CopyButton value={shown} label="Copy address" />
        {ambiguous && (
          <p className="clip-notice clip-notice--info">
            {t.networks.length > 1
              ? `This address receives ${t.asset.symbol} on ${t.networks.map((n) => n.name).join(", ")}. Ask the sender to use one of these.`
              : `Ask the sender to send on ${t.networks[0]!.name}.`}
          </p>
        )}
      </div>
    </Screen>
  );
}
