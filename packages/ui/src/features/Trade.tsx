import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Chip, CopyButton, Empty, ErrorNote, Field, Qr, Row, Screen, Spinner, Warnings } from "../components";
import { formatUnits, relativeTime } from "../lib/format";
import type { TradeLegInput, TradeOfferView, TradeReviewView } from "./client";
import { useFeatures } from "./context";

/** Links longer than this don't fit a readable QR code; share the link instead. */
const QR_MAX = 2000;

const STATUS_TONE: Record<TradeOfferView["status"], "accent" | "neutral" | "muted"> = {
  draft: "muted",
  waiting: "neutral",
  done: "accent",
  expired: "muted",
  cancelled: "muted",
  failed: "muted",
};

/** Secure Trade: swap directly with one person. Both sides happen together, or not at all. */
export function TradeHome() {
  const features = useFeatures();
  const { navigate } = useRouter();
  const { data, error } = useAsync(() => features.tradeList(), [features]);
  return (
    <Screen back title="Secure Trade">
      <p className="clip-lede">Trade directly with someone you know. Both sides move together, or nothing moves.</p>
      <div className="clip-actions">
        <Button onClick={() => navigate("/trade/new")}>New trade</Button>
        <Button variant="secondary" onClick={() => navigate("/trade/open")}>
          Open a trade link
        </Button>
      </div>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title="No trades yet" />}
      <ul className="clip-list" aria-label="Your trades">
        {data?.map((t) => (
          <li key={t.id}>
            <button type="button" className="clip-asset-row" onClick={() => navigate(`/trade/${encodeURIComponent(t.id)}`)}>
              <span className="clip-asset-row__main">
                <span className="clip-asset-row__symbol">{t.title}</span>
                <span className="clip-asset-row__name">
                  {t.statusText} · {relativeTime(t.createdAt)}
                </span>
              </span>
              <Chip tone={STATUS_TONE[t.status]}>{t.status === "done" ? "Done" : t.status === "waiting" ? "Waiting" : "Closed"}</Chip>
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

/** One trade: status, and the link/QR to share while it's waiting. */
export function TradeDetail(props: { id: string }) {
  const features = useFeatures();
  const { data, error } = useAsync(() => features.tradeList(), [features]);
  const t = data?.find((x) => x.id === props.id);
  if (error) return <Screen back title="Secure Trade"><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back title="Secure Trade"><Spinner /></Screen>;
  if (!t) return <Screen back title="Secure Trade"><Empty title="This trade isn't here any more" /></Screen>;
  return (
    <Screen back title="Secure Trade">
      <p className="clip-h2">{t.title}</p>
      <div className="clip-rows">
        <Row label="You give" value={t.give.display} />
        <Row label="You get" value={t.get.display} />
        <Row label="With" value={t.counterparty} />
        <Row label="Status" value={t.statusText} />
        {t.expiresAt && t.status === "waiting" && <Row label="Open until" value={new Date(t.expiresAt).toLocaleString()} />}
      </div>
      {t.notes.map((n) => (
        <p key={n} className="clip-notice clip-notice--info">
          {n}
        </p>
      ))}
      {t.link && t.status === "waiting" && t.role === "maker" && (
        <Card>
          <p className="clip-hint">
            {t.mode === "direct" ? "Send this to them now: it works for about 3 minutes." : "Send this to them. They can accept any time before it expires."}
          </p>
          {t.link.length <= QR_MAX ? <Qr value={t.link} label="QR code for the trade link" /> : <p className="clip-hint">This link is too long for a QR code. Share the link instead.</p>}
          <code className="clip-address" data-testid="trade-link">
            {t.link.length > 80 ? `${t.link.slice(0, 60)}…` : t.link}
          </code>
          <CopyButton value={t.link} label="Copy link" />
        </Card>
      )}
    </Screen>
  );
}

type LegForm = { kind: "asset"; assetKey: string; amount: string } | { kind: "nft"; tokenId: string; serial: string };

function toInput(l: LegForm): TradeLegInput {
  return l.kind === "nft" ? { nft: { tokenId: l.tokenId.trim(), serial: l.serial.trim() } } : { assetKey: l.assetKey.trim(), amount: l.amount.trim() };
}

function LegFields(props: { label: string; value: LegForm; onChange: (v: LegForm) => void; assets: { key: string; symbol: string }[] }) {
  const v = props.value;
  return (
    <fieldset className="clip-stack">
      <legend className="clip-field__label">{props.label}</legend>
      <div className="clip-segmented" role="radiogroup" aria-label={`${props.label}: kind`}>
        <button type="button" role="radio" aria-checked={v.kind === "asset"} className={v.kind === "asset" ? "is-active" : ""} onClick={() => props.onChange({ kind: "asset", assetKey: props.assets[0]?.key ?? "hbar", amount: "" })}>
          Coins or tokens
        </button>
        <button type="button" role="radio" aria-checked={v.kind === "nft"} className={v.kind === "nft" ? "is-active" : ""} onClick={() => props.onChange({ kind: "nft", tokenId: "", serial: "" })}>
          A collectible
        </button>
      </div>
      {v.kind === "asset" ? (
        <>
          <select className="clip-select" aria-label={`${props.label}: asset`} value={v.assetKey} onChange={(e) => props.onChange({ ...v, assetKey: e.target.value })}>
            {props.assets.map((a) => (
              <option key={a.key} value={a.key}>
                {a.symbol}
              </option>
            ))}
          </select>
          <Field label="Amount" inputMode="decimal" placeholder="0" autoComplete="off" value={v.amount} onChange={(e) => props.onChange({ ...v, amount: e.target.value })} />
        </>
      ) : (
        <>
          <Field label="Collection" placeholder="0.0.1234" autoComplete="off" value={v.tokenId} onChange={(e) => props.onChange({ ...v, tokenId: e.target.value })} />
          <Field label="Item number" inputMode="numeric" placeholder="1" autoComplete="off" value={v.serial} onChange={(e) => props.onChange({ ...v, serial: e.target.value })} />
        </>
      )}
    </fieldset>
  );
}

/** Create an offer: what you give, what you get, who with, and whether they're online now. */
export function TradeCreate() {
  const features = useFeatures();
  const { client } = useUi();
  const { navigate } = useRouter();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  // Secure Trade runs on Hedera; offer the assets that live there, by symbol only.
  const assets = (data?.assets ?? [])
    .filter((a) => a.networkId.startsWith("hedera:") && !a.spam)
    .map((a) => ({ key: a.key, symbol: a.symbol }))
    .filter((a, i, all) => all.findIndex((x) => x.key === a.key) === i);
  // Asset choices arrive after the first render: "" means "the default for this side".
  const first = assets[0]?.key ?? "hbar";
  const second = assets[1]?.key ?? first;
  const [giveForm, setGive] = useState<LegForm>({ kind: "asset", assetKey: "", amount: "" });
  const [getForm, setGet] = useState<LegForm>({ kind: "asset", assetKey: "", amount: "" });
  const give: LegForm = giveForm.kind === "asset" && !giveForm.assetKey ? { ...giveForm, assetKey: first } : giveForm;
  const get: LegForm = getForm.kind === "asset" && !getForm.assetKey ? { ...getForm, assetKey: second } : getForm;
  const [counterparty, setCounterparty] = useState("");
  const [mode, setMode] = useState<"direct" | "scheduled">("scheduled");
  const [hours, setHours] = useState(24);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setErr(null);
    if (!/^0\.0\.\d+(-[a-z]{5})?$|^0x[0-9a-fA-F]{40}$/.test(counterparty.trim())) return setErr("Enter their account, like 0.0.1234.");
    setBusy(true);
    try {
      const r = await features.tradeCreate({ give: toInput(give), get: toInput(get), counterparty: counterparty.trim(), mode, expiresInHours: mode === "scheduled" ? hours : undefined });
      navigate(`/approval/${encodeURIComponent(r.queued.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Screen back title="New trade"><Spinner /></Screen>;
  return (
    <Screen back title="New trade">
      <LegFields label="You give" value={give} onChange={setGive} assets={assets} />
      <LegFields label="You get" value={get} onChange={setGet} assets={assets} />
      <Field label="Trade with" placeholder="0.0.1234" autoComplete="off" spellCheck={false} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
      <div className="clip-segmented" role="radiogroup" aria-label="When they accept">
        <button type="button" role="radio" aria-checked={mode === "direct"} className={mode === "direct" ? "is-active" : ""} onClick={() => setMode("direct")}>
          They're here now
        </button>
        <button type="button" role="radio" aria-checked={mode === "scheduled"} className={mode === "scheduled" ? "is-active" : ""} onClick={() => setMode("scheduled")}>
          They'll accept later
        </button>
      </div>
      <p className="clip-hint">
        {mode === "direct" ? "They get about 3 minutes to accept after you approve." : "They can accept until it expires. Nothing moves until both of you have approved."}
      </p>
      {mode === "scheduled" && (
        <label className="clip-field">
          <span className="clip-field__label">Open for</span>
          <select className="clip-select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={1}>1 hour</option>
            <option value={24}>1 day</option>
            <option value={168}>1 week</option>
          </select>
        </label>
      )}
      <ErrorNote message={err} />
      <Button block disabled={busy} onClick={() => void create()}>
        Review trade
      </Button>
    </Screen>
  );
}

/** Counterparty: paste or open a link, see what the actual transaction does, accept. */
export function TradeReview(props: { link?: string }) {
  const features = useFeatures();
  const { navigate } = useRouter();
  const [link, setLink] = useState(props.link ?? "");
  const [review, setReview] = useState<TradeReviewView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setErr(null);
    setReview(null);
    setBusy(true);
    try {
      setReview(await features.tradeReview({ link: link.trim() }));
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setErr(null);
    try {
      const q = await features.tradeAccept({ link: link.trim() });
      navigate(`/approval/${encodeURIComponent(q.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title="Trade offer">
      {!review && (
        <>
          <label className="clip-field">
            <span className="clip-field__label">Trade link</span>
            <textarea className="clip-textarea" rows={4} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the link you were sent" />
          </label>
          <ErrorNote message={err} />
          <Button block disabled={busy || !link.trim()} onClick={() => void check()}>
            Check offer
          </Button>
        </>
      )}
      {review && (
        <>
          <p className="clip-h2" data-testid="trade-review-title">{review.offer.title}</p>
          <div className="clip-rows">
            <Row label="You get" value={review.offer.give.display} />
            <Row label="You give" value={review.offer.get.display} />
            <Row label="From" value={review.offer.counterparty} />
            {review.lines.map((l) => (
              <Row key={l.label + l.value} label={l.label} value={l.value} />
            ))}
          </div>
          {review.balanceChanges.length > 0 && (
            <ul className="clip-list" aria-label="What changes in your balance">
              {review.balanceChanges.map((c) => (
                <li key={c.asset.key + c.delta}>
                  {c.delta.startsWith("-") ? "−" : "+"}
                  {formatUnits(c.delta.replace(/^-/, ""), c.asset.decimals)} {c.asset.symbol}
                </li>
              ))}
            </ul>
          )}
          <Warnings warnings={review.warnings} />
          {review.problem ? (
            <ErrorNote message={review.problem} />
          ) : (
            <>
              {review.steps.length > 1 && (
                <ol className="clip-steps" aria-label="What you'll approve">
                  {review.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <ErrorNote message={err} />
              <Button block disabled={busy} onClick={() => void accept()}>
                Accept trade
              </Button>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
