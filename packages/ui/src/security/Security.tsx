import { useEffect, useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Screen, Spinner } from "../components";
import { relativeTime } from "../lib/format";
import type { CleanupItemView, CleanupSummaryView, GrantView } from "./client";
import { useSecurity } from "./context";

/* ------------------------------------------------------------------ menu */

const MENU = [
  { path: "/settings/security/permissions", title: "App permissions", text: "See which apps can spend your tokens or move your NFTs, and take that back." },
  { path: "/settings/security/cleanup", title: "Clean up spam", text: "Remove spam tokens and empty accounts. On Solana you get a little SOL back." },
  { path: "/settings/security/protection", title: "Scam protection", text: "The scam lists Clip Wallet checks before you connect or sign, and what each one sees." },
] as const;

/** Settings → Security. */
export function SecurityHome() {
  const { navigate } = useRouter();
  return (
    <Screen back title="Security">
      <nav className="clip-menu" aria-label="Security">
        {MENU.map((m) => (
          <div key={m.path}>
            <button type="button" className="clip-menu__item" onClick={() => navigate(m.path)}>
              {m.title}
            </button>
            <p className="clip-hint">{m.text}</p>
          </div>
        ))}
      </nav>
    </Screen>
  );
}

/* ------------------------------------------------------------------ permissions */

const RISK_TONE = { danger: "accent", caution: "neutral", info: "muted" } as const;
const LEVEL_TEXT = { high: "High risk", medium: "Worth a look", low: "Looks fine" } as const;

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
      title="App permissions"
      footer={
        data && data.grants.length > 0 ? (
          <Button block variant="danger" disabled={busy || picked.size === 0} onClick={() => void revoke()}>
            {picked.size === 0 ? "Pick permissions to remove" : picked.size === 1 ? "Remove 1 permission" : `Remove ${picked.size} permissions`}
          </Button>
        ) : undefined
      }
    >
      <p className="clip-lede">Apps you've used may still be allowed to spend your tokens or move your NFTs. Removing a permission moves nothing; you'll confirm each change.</p>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {loading && !data && <Spinner label="Checking your permissions" />}
      {data?.partial.map((p) => (
        <p key={p.code + p.message} className="clip-hint" role="status">
          {p.message}
        </p>
      ))}
      {data && data.grants.length === 0 && <Empty title="No apps can spend your tokens">Nothing to remove.</Empty>}
      <ul className="clip-list" aria-label="Permissions">
        {data?.grants.map((g) => (
          <li key={g.id} data-testid="grant">
            <Card>
              <div className="clip-select-row">
                <span>
                  <strong>{g.title}</strong>
                  <span className="clip-hint" style={{ display: "block" }}>
                    {g.spender.name ?? g.spender.address}
                    {g.grantedAt ? ` · set ${relativeTime(g.grantedAt)}` : ""}
                  </span>
                </span>
                <Selector checked={picked.has(g.id)} onChange={(v) => toggle(g, v)} label={`Remove: ${g.title}`} />
              </div>
              <div className="clip-actions">
                <Chip tone={g.riskLevel === "high" ? "accent" : "muted"}>{LEVEL_TEXT[g.riskLevel]}</Chip>
                {g.risks.map((r) => (
                  <Chip key={r.code} tone={RISK_TONE[r.level]}>
                    {r.label}
                  </Chip>
                ))}
                {advanced && <Chip tone="muted">{g.networkId}</Chip>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data?.notes.map((n) => (
        <p key={n} className="clip-hint">
          {n}
        </p>
      ))}
    </Screen>
  );
}

/* ------------------------------------------------------------------ cleanup */

const ACTION_TEXT: Record<CleanupItemView["action"], string> = {
  close: "Close",
  "burn-close": "Destroy and close",
  dissociate: "Remove",
  hide: "Hide",
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
        setDone(r.hidden === 1 ? "Hid 1 item." : `Hid ${r.hidden} items.`);
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
      title="Clean up spam"
      footer={
        data && data.items.length > 0 ? (
          <Button block disabled={busy || ids.length === 0} onClick={() => void run()}>
            {summary?.headline ?? "Pick items to clean up"}
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
      {loading && !data && <Spinner label="Looking for spam" />}
      {data?.partial.map((p) => (
        <p key={p.code + p.message} className="clip-hint" role="status">
          {p.message}
        </p>
      ))}
      {data && data.items.length === 0 && <Empty title="Nothing to clean up">No spam or empty accounts found.</Empty>}
      {summary && (
        <Card>
          <div aria-label="Summary" data-testid="cleanup-summary">
            <strong>{summary.headline}</strong>
            <ul className="clip-list">
              {summary.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {summary.approvals > 0 && <p className="clip-hint">{summary.approvals === 1 ? "You'll confirm 1 transaction." : `You'll confirm ${summary.approvals} transactions.`}</p>}
          </div>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <div className="clip-actions">
          <Button variant="ghost" onClick={() => setPicked(new Set(data.items.map((i) => i.id)))}>
            Select all
          </Button>
          <Button variant="ghost" onClick={() => setPicked(new Set())}>
            Select none
          </Button>
        </div>
      )}
      <ul className="clip-list" aria-label="Items">
        {data?.items.map((i) => (
          <li key={i.id} data-testid="cleanup-item">
            <Card>
              <div className="clip-select-row">
                <span>
                  <strong>{i.symbol}</strong> <Chip tone={i.spam ? "accent" : "muted"}>{i.spam ? "Spam" : i.action === "close" ? "Empty" : "Unused"}</Chip>
                  <span className="clip-hint" style={{ display: "block" }}>
                    {ACTION_TEXT[i.action]} · {i.reason}
                  </span>
                </span>
                <Selector checked={picked.has(i.id)} onChange={(v) => toggle(i.id, v)} label={`${ACTION_TEXT[i.action]} ${i.symbol}`} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data?.notes.map((n) => (
        <p key={n} className="clip-hint">
          {n}
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
    <Screen back title="Scam protection">
      <p className="clip-lede">Before you connect to a site or sign, Clip Wallet checks it against these sources. Lists are downloaded and checked on your device.</p>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      <ul className="clip-list" aria-label="Sources">
        {data?.map((p) => (
          <li key={p.id} data-testid="threat-source">
            <Card>
              <div className="clip-select-row">
                <strong>{p.name}</strong>
                <Chip tone={p.enabled ? "accent" : "muted"}>{p.enabled ? "On" : "Off"}</Chip>
              </div>
              <p className="clip-hint">{p.privacy}</p>
              {p.updatedAt && (
                <p className="clip-hint">
                  Updated {relativeTime(p.updatedAt)}
                  {p.entries ? ` · ${p.entries.toLocaleString("en-US")} entries` : ""}
                </p>
              )}
              {p.unavailable && <p className="clip-hint">{p.unavailable.message}</p>}
            </Card>
          </li>
        ))}
      </ul>
      <Button variant="secondary" disabled={busy} onClick={() => void refresh()}>
        Update lists now
      </Button>
    </Screen>
  );
}
