import { useEffect, useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Screen, Spinner } from "../components";
import { relativeTime } from "../lib/format";
import type { CleanupItemView, CleanupSummaryView, GrantView } from "./client";
import { useSecurity } from "./context";
import { useFormat, useUiT, type UiMessageId } from "../i18n";
import { cleanupLines, cleanupReason, grantTitle, noteText, partialText, privacyText, riskText, sourceName, sourceUnavailable } from "./text";

/* ------------------------------------------------------------------ menu */

const MENU: readonly { path: string; title: UiMessageId; text: UiMessageId }[] = [
  { path: "/settings/security/permissions", title: "security.menu.permissions", text: "security.menu.permissionsHint" },
  { path: "/settings/security/cleanup", title: "security.menu.cleanup", text: "security.menu.cleanupHint" },
  { path: "/settings/security/protection", title: "security.menu.protection", text: "security.menu.protectionHint" },
];

/** Settings → Security. */
export function SecurityHome() {
  const { navigate } = useRouter();
  const { config } = useUi();
  const t = useUiT();
  return (
    <Screen back title={t("security.title")}>
      <nav className="clip-menu" aria-label={t("security.title")}>
        {MENU.map((m) => (
          <div key={m.path}>
            <button type="button" className="clip-menu__item" onClick={() => navigate(m.path)}>
              {t(m.title)}
            </button>
            <p className="clip-hint">{t(m.text, { name: config.name })}</p>
          </div>
        ))}
      </nav>
    </Screen>
  );
}

/* ------------------------------------------------------------------ permissions */

const RISK_TONE = { danger: "accent", caution: "neutral", info: "muted" } as const;
const LEVEL_TEXT = { high: "security.level.high", medium: "security.level.medium", low: "security.level.low" } as const satisfies Record<string, UiMessageId>;

function Selector(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="clip-check">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} aria-label={props.label} />
    </label>
  );
}

/** Every standing permission across your accounts; revoke the chosen ones in one tap. */
export function Permissions() {
  const security = useSecurity();
  const { navigate } = useRouter();
  const { state } = useUi();
  const t = useUiT();
  const advanced = !!state?.prefs.advanced;
  const { data, error, reload, loading } = useAsync(() => security.approvalsScan(), [security]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Risky ones are ticked for you; anything that looks fine isn't.
  useEffect(() => {
    if (data) setPicked(new Set(data.grants.filter((g) => g.riskLevel !== "low").map((g) => g.id)));
  }, [data]);

  async function revoke() {
    setErr(null);
    setBusy(true);
    try {
      const r = await security.revoke({ ids: [...picked] });
      if (r.queued) navigate(`/approval/${encodeURIComponent(r.queued.approvalId)}`);
      else reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (g: GrantView, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(g.id);
      else n.delete(g.id);
      return n;
    });

  return (
    <Screen
      back
      title={t("security.menu.permissions")}
      footer={
        data && data.grants.length > 0 ? (
          <Button block variant="danger" disabled={busy || picked.size === 0} onClick={() => void revoke()}>
            {picked.size === 0 ? t("security.perm.pick") : t("security.perm.remove", { count: picked.size })}
          </Button>
        ) : undefined
      }
    >
      <p className="clip-lede">{t("security.perm.lede")}</p>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {loading && !data && <Spinner label={t("security.perm.checking")} />}
      {data?.partial.map((p) => (
        <p key={p.code + p.message} className="clip-hint" role="status">
          {partialText(p, t)}
        </p>
      ))}
      {data && data.grants.length === 0 && <Empty title={t("security.perm.none")}>{t("security.perm.noneHint")}</Empty>}
      <ul className="clip-list" aria-label={t("security.perm.list")}>
        {data?.grants.map((g) => (
          <li key={g.id} data-testid="grant">
            <Card>
              <div className="clip-select-row">
                <span>
                  <strong>{grantTitle(g, t)}</strong>
                  <span className="clip-hint" style={{ display: "block" }}>
                    {g.grantedAt ? t("security.perm.spenderSet", { spender: g.spender.name ?? g.spender.address, when: relativeTime(g.grantedAt) }) : (g.spender.name ?? g.spender.address)}
                  </span>
                </span>
                <Selector checked={picked.has(g.id)} onChange={(v) => toggle(g, v)} label={t("security.perm.removeOne", { title: grantTitle(g, t) })} />
              </div>
              <div className="clip-actions">
                <Chip tone={g.riskLevel === "high" ? "accent" : "muted"}>{t(LEVEL_TEXT[g.riskLevel])}</Chip>
                {g.risks.map((r) => (
                  <Chip key={r.code} tone={RISK_TONE[r.level]}>
                    {riskText(r, g, t)}
                  </Chip>
                ))}
                {advanced && <Chip tone="muted">{g.networkId}</Chip>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data?.notes.map((n, i) => (
        <p key={n} className="clip-hint">
          {noteText(data.noteCodes?.[i], n, t)}
        </p>
      ))}
    </Screen>
  );
}

/* ------------------------------------------------------------------ cleanup */

const ACTION_TEXT: Record<CleanupItemView["action"], UiMessageId> = {
  close: "security.action.close",
  "burn-close": "security.action.burnClose",
  dissociate: "security.action.dissociate",
  hide: "security.action.hide",
};

/** Spam and empty accounts, with a clear summary of what one tap does. */
export function Cleanup() {
  const security = useSecurity();
  const { navigate } = useRouter();
  const { data, error, reload, loading } = useAsync(() => security.cleanupScan(), [security]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<CleanupSummaryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const t = useUiT();

  useEffect(() => {
    if (data) setPicked(new Set(data.items.filter((i) => i.preselected).map((i) => i.id)));
  }, [data]);

  const ids = useMemo(() => [...picked], [picked]);
  useEffect(() => {
    let live = true;
    if (!ids.length) {
      setSummary(null);
      return;
    }
    security
      .cleanupPreview({ ids })
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [security, ids]);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      const r = await security.cleanupRun({ ids });
      if (r.queued) navigate(`/approval/${encodeURIComponent(r.queued.approvalId)}`);
      else {
        setDone(t("security.clean.hid", { count: r.hidden }));
        reload();
      }
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  return (
    <Screen
      back
      title={t("security.menu.cleanup")}
      footer={
        data && data.items.length > 0 ? (
          <Button block disabled={busy || ids.length === 0} onClick={() => void run()}>
            {summary ? cleanupLines(summary, t).headline : t("security.clean.pick")}
          </Button>
        ) : undefined
      }
    >
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {done && (
        <p className="clip-hint" role="status">
          {done}
        </p>
      )}
      {loading && !data && <Spinner label={t("security.clean.looking")} />}
      {data?.partial.map((p) => (
        <p key={p.code + p.message} className="clip-hint" role="status">
          {partialText(p, t)}
        </p>
      ))}
      {data && data.items.length === 0 && <Empty title={t("security.clean.none")}>{t("security.clean.noneHint")}</Empty>}
      {summary && (
        <Card>
          <div aria-label={t("security.clean.summary")} data-testid="cleanup-summary">
            <strong>{cleanupLines(summary, t).headline}</strong>
            <ul className="clip-list">
              {cleanupLines(summary, t).lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {summary.approvals > 0 && <p className="clip-hint">{t("security.clean.confirmations", { count: summary.approvals })}</p>}
          </div>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <div className="clip-actions">
          <Button variant="ghost" onClick={() => setPicked(new Set(data.items.map((i) => i.id)))}>
            {t("security.clean.selectAll")}
          </Button>
          <Button variant="ghost" onClick={() => setPicked(new Set())}>
            {t("security.clean.selectNone")}
          </Button>
        </div>
      )}
      <ul className="clip-list" aria-label={t("security.clean.items")}>
        {data?.items.map((i) => (
          <li key={i.id} data-testid="cleanup-item">
            <Card>
              <div className="clip-select-row">
                <span>
                  <strong>{i.symbol}</strong>{" "}
                  <Chip tone={i.spam ? "accent" : "muted"}>{i.spam ? t("security.clean.spam") : i.action === "close" ? t("security.clean.empty") : t("security.clean.unused")}</Chip>
                  <span className="clip-hint" style={{ display: "block" }}>
                    {t("security.clean.itemLine", { action: t(ACTION_TEXT[i.action]), reason: cleanupReason(i, t) })}
                  </span>
                </span>
                <Selector checked={picked.has(i.id)} onChange={(v) => toggle(i.id, v)} label={t("security.clean.itemLabel", { action: t(ACTION_TEXT[i.action]), symbol: i.symbol })} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data?.notes.map((n, i) => (
        <p key={n} className="clip-hint">
          {noteText(data.noteCodes?.[i], n, t)}
        </p>
      ))}
    </Screen>
  );
}

/* ------------------------------------------------------------------ scam protection */

/** What Clip Wallet checks, and exactly what each source sees. */
export function Protection() {
  const security = useSecurity();
  const { data, error, reload } = useAsync(() => security.threatStatus(), [security]);
  const [busy, setBusy] = useState(false);
  const t = useUiT();
  const f = useFormat();
  const { config } = useUi();

  async function refresh() {
    setBusy(true);
    try {
      await security.threatRefresh();
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <Screen back title={t("security.menu.protection")}>
      <p className="clip-lede">{t("security.protect.lede", { name: config.name })}</p>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      <ul className="clip-list" aria-label={t("security.protect.sources")}>
        {data?.map((p) => (
          <li key={p.id} data-testid="threat-source">
            <Card>
              <div className="clip-select-row">
                <strong>{sourceName(p, t)}</strong>
                <Chip tone={p.enabled ? "accent" : "muted"}>{p.enabled ? t("security.protect.on") : t("security.protect.off")}</Chip>
              </div>
              <p className="clip-hint">{privacyText(p, t)}</p>
              {p.updatedAt && (
                <p className="clip-hint">
                  {p.entries
                    ? t("security.protect.updatedEntries", { when: relativeTime(p.updatedAt), entries: f.number(p.entries), count: p.entries })
                    : t("security.protect.updated", { when: relativeTime(p.updatedAt) })}
                </p>
              )}
              {p.unavailable && <p className="clip-hint">{sourceUnavailable(p.unavailable, t)}</p>}
            </Card>
          </li>
        ))}
      </ul>
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
        {t("security.protect.refresh")}
      </Button>
    </Screen>
  );
}
