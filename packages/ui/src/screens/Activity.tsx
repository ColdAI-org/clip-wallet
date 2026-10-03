import { useState } from "react";
import type { ActivityEntry } from "../client";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Chip, Empty, ErrorNote, Screen, Spinner } from "../components";
import { IconArrowDown, IconArrowUp, IconCheck, IconChevron, IconClock } from "../components/icons";
import { formatFiat, relativeTime, shortAddress } from "../lib/format";
import { useUiT } from "../i18n";

function KindIcon(props: { kind: ActivityEntry["kind"] }) {
  if (props.kind === "receive") return <IconArrowDown />;
  if (props.kind === "connect" || props.kind === "sign") return <IconCheck />;
  return <IconArrowUp />;
}

export function ActivityItem(props: { entry: ActivityEntry; currency: string; networkName: (id: string) => string; advanced: boolean }) {
  const t = useUiT();
  const e = props.entry;
  const [open, setOpen] = useState(false);
  const hasLegs = e.legs.length > 0;
  return (
    <li className="clip-activity">
      <button type="button" className="clip-activity__main" aria-expanded={hasLegs ? open : undefined} onClick={() => hasLegs && setOpen((o) => !o)}>
        <span className={`clip-activity__icon clip-activity__icon--${e.kind}`}>
          <KindIcon kind={e.kind} />
        </span>
        <span className="clip-activity__text">
          <span className="clip-activity__title">{e.title}</span>
          <span className="clip-activity__meta">
            {e.status === "pending" ? (
              <Chip tone="accent">
                <IconClock width={12} height={12} /> {t("activity.inProgress")}
              </Chip>
            ) : e.status === "failed" ? (
              <Chip tone="neutral">{t("activity.failed")}</Chip>
            ) : (
              relativeTime(e.timestamp)
            )}
          </span>
        </span>
        {e.fiatValue !== undefined && (
          <span className={`clip-activity__fiat ${e.fiatValue > 0 ? "is-in" : ""}`}>{formatFiat(e.fiatValue, props.currency, { signed: true })}</span>
        )}
        {hasLegs && <IconChevron width={14} height={14} className={open ? "is-open" : ""} />}
      </button>
      {open && (
        <ol className="clip-legs">
          {e.legs.map((l, i) => (
            <li key={i}>
              <span>{l.title}</span>
              {props.advanced && (
                <span className="clip-legs__adv">
                  {props.networkName(l.networkId)}
                  {l.txHash ? ` · ${shortAddress(l.txHash, 6)}` : ""}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function Activity() {
  const t = useUiT();
  const { client, state } = useUi();
  const { data, error, loading } = useAsync(() => client.getActivity(), [client]);
  const { data: portfolio } = useAsync(() => client.getPortfolio(), [client]);
  const currency = state?.prefs.displayCurrency ?? "USD";
  const name = (id: string) => portfolio?.networks.find((n) => n.id === id)?.name ?? id;
  return (
    <Screen nav title={t("activity.title")}>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {loading && !data && <Spinner />}
      {data && data.length === 0 && <Empty title={t("activity.empty")} />}
      {data && data.length > 0 && (
        <ul className="clip-list" aria-label={t("activity.list")}>
          {data.map((e) => (
            <ActivityItem key={e.id} entry={e} currency={currency} networkName={name} advanced={!!state?.prefs.advanced} />
          ))}
        </ul>
      )}
    </Screen>
  );
}
