import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Chip, CopyButton, Empty, ErrorNote, Field, Qr, Row, Screen, Spinner, Warnings } from "../components";
import { canonicalAmount, formatUnits, relativeTime } from "../lib/format";
import { useLocale, useUiT } from "../i18n";
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
  const t = useUiT();
  const features = useFeatures();
  const { navigate } = useRouter();
  const { data, error } = useAsync(() => features.tradeList(), [features]);
  return (
    <Screen back title={t("trade.title")}>
      <p className="clip-lede">{t("trade.lede")}</p>
      <div className="clip-actions">
        <Button onClick={() => navigate("/trade/new")}>{t("trade.new")}</Button>
        <Button variant="secondary" onClick={() => navigate("/trade/open")}>
          {t("trade.openLink")}
        </Button>
      </div>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title={t("trade.none")} />}
      <ul className="clip-list" aria-label={t("trade.yours")}>
        {data?.map((o) => (
          <li key={o.id}>
            <button type="button" className="clip-asset-row" onClick={() => navigate(`/trade/${encodeURIComponent(o.id)}`)}>
              <span className="clip-asset-row__main">
                <span className="clip-asset-row__symbol">{o.title}</span>
                <span className="clip-asset-row__name">
                  {o.statusText} · {relativeTime(o.createdAt)}
                </span>
              </span>
              <Chip tone={STATUS_TONE[o.status]}>{o.status === "done" ? t("trade.status.done") : o.status === "waiting" ? t("trade.status.waiting") : t("trade.status.closed")}</Chip>
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

/** One trade: status, and the link/QR to share while it's waiting. */
export function TradeDetail(props: { id: string }) {
  const tr = useUiT();
  const { locale } = useLocale();
  const features = useFeatures();
  const { data, error } = useAsync(() => features.tradeList(), [features]);
  const t = data?.find((x) => x.id === props.id);
  if (error) return <Screen back title={tr("trade.title")}><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back title={tr("trade.title")}><Spinner /></Screen>;
  if (!t) return <Screen back title={tr("trade.title")}><Empty title={tr("trade.gone")} /></Screen>;
  return (
    <Screen back title={tr("trade.title")}>
      <p className="clip-h2">{t.title}</p>
      <div className="clip-rows">
        <Row label={tr("trade.youGive")} value={t.give.display} />
        <Row label={tr("trade.youGet")} value={t.get.display} />
        <Row label={tr("trade.with")} value={t.counterparty} />
        <Row label={tr("trade.status")} value={t.statusText} />
        {t.expiresAt && t.status === "waiting" && <Row label={tr("trade.openUntil")} value={new Date(t.expiresAt).toLocaleString(locale)} />}
      </div>
      {t.notes.map((n) => (
        <p key={n} className="clip-notice clip-notice--info">
          {n}
        </p>
      ))}
      {t.link && t.status === "waiting" && t.role === "maker" && (
        <Card>
          <p className="clip-hint">
            {t.mode === "direct" ? tr("trade.shareDirect") : tr("trade.shareScheduled")}
          </p>
          {t.link.length <= QR_MAX ? <Qr value={t.link} label={tr("trade.qrLabel")} /> : <p className="clip-hint">{tr("trade.tooLongForQr")}</p>}
          <code className="clip-address" data-testid="trade-link">
            {t.link.length > 80 ? `${t.link.slice(0, 60)}…` : t.link}
          </code>
          <CopyButton value={t.link} label={tr("trade.copyLink")} />
        </Card>
      )}
    </Screen>
  );
}

type LegForm = { kind: "asset"; assetKey: string; amount: string } | { kind: "nft"; tokenId: string; serial: string };

/** Null when an asset leg's amount isn't a valid number (in the user's locale). */
function toInput(l: LegForm): TradeLegInput | null {
  if (l.kind === "nft") return { nft: { tokenId: l.tokenId.trim(), serial: l.serial.trim() } };
  const amount = canonicalAmount(l.amount);
  return amount === null ? null : { assetKey: l.assetKey.trim(), amount };
}

function LegFields(props: { label: string; value: LegForm; onChange: (v: LegForm) => void; assets: { key: string; symbol: string }[] }) {
  const t = useUiT();
  const v = props.value;
  return (
    <fieldset className="clip-stack">
      <legend className="clip-field__label">{props.label}</legend>
      <div className="clip-segmented" role="radiogroup" aria-label={t("trade.legKind", { label: props.label })}>
        <button type="button" role="radio" aria-checked={v.kind === "asset"} className={v.kind === "asset" ? "is-active" : ""} onClick={() => props.onChange({ kind: "asset", assetKey: props.assets[0]?.key ?? "hbar", amount: "" })}>
          {t("trade.kind.asset")}
        </button>
        <button type="button" role="radio" aria-checked={v.kind === "nft"} className={v.kind === "nft" ? "is-active" : ""} onClick={() => props.onChange({ kind: "nft", tokenId: "", serial: "" })}>
          {t("trade.kind.nft")}
        </button>
      </div>
      {v.kind === "asset" ? (
        <>
          <select className="clip-select" aria-label={t("trade.legAsset", { label: props.label })} value={v.assetKey} onChange={(e) => props.onChange({ ...v, assetKey: e.target.value })}>
            {props.assets.map((a) => (
              <option key={a.key} value={a.key}>
                {a.symbol}
              </option>
            ))}
          </select>
          <Field label={t("trade.amount")} inputMode="decimal" placeholder="0" autoComplete="off" value={v.amount} onChange={(e) => props.onChange({ ...v, amount: e.target.value })} />
        </>
      ) : (
        <>
          <Field label={t("trade.collection")} placeholder="0.0.1234" autoComplete="off" value={v.tokenId} onChange={(e) => props.onChange({ ...v, tokenId: e.target.value })} />
          <Field label={t("trade.itemNumber")} inputMode="numeric" placeholder="1" autoComplete="off" value={v.serial} onChange={(e) => props.onChange({ ...v, serial: e.target.value })} />
        </>
      )}
    </fieldset>
  );
}

/** Create an offer: what you give, what you get, who with, and whether they're online now. */
export function TradeCreate() {
  const t = useUiT();
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
    if (!/^0\.0\.\d+(-[a-z]{5})?$|^0x[0-9a-fA-F]{40}$/.test(counterparty.trim())) return setErr(t("trade.counterpartyBad"));
    const giveInput = toInput(give);
    const getInput = toInput(get);
    if (!giveInput || !getInput) return setErr(t("trade.amountBad"));
    setBusy(true);
    try {
      const r = await features.tradeCreate({ give: giveInput, get: getInput, counterparty: counterparty.trim(), mode, expiresInHours: mode === "scheduled" ? hours : undefined });
      navigate(`/approval/${encodeURIComponent(r.queued.approvalId)}`);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Screen back title={t("trade.new")}><Spinner /></Screen>;
  return (
    <Screen back title={t("trade.new")}>
      <LegFields label={t("trade.youGive")} value={give} onChange={setGive} assets={assets} />
      <LegFields label={t("trade.youGet")} value={get} onChange={setGet} assets={assets} />
      <Field label={t("trade.tradeWith")} placeholder="0.0.1234" autoComplete="off" spellCheck={false} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
      <div className="clip-segmented" role="radiogroup" aria-label={t("trade.whenAccept")}>
        <button type="button" role="radio" aria-checked={mode === "direct"} className={mode === "direct" ? "is-active" : ""} onClick={() => setMode("direct")}>
          {t("trade.mode.direct")}
        </button>
        <button type="button" role="radio" aria-checked={mode === "scheduled"} className={mode === "scheduled" ? "is-active" : ""} onClick={() => setMode("scheduled")}>
          {t("trade.mode.scheduled")}
        </button>
      </div>
      <p className="clip-hint">
        {mode === "direct" ? t("trade.mode.directHint") : t("trade.mode.scheduledHint")}
      </p>
      {mode === "scheduled" && (
        <label className="clip-field">
          <span className="clip-field__label">{t("trade.openFor")}</span>
          <select className="clip-select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={1}>{t("trade.hours", { n: 1 })}</option>
            <option value={24}>{t("trade.days", { n: 1 })}</option>
            <option value={168}>{t("trade.weeks", { n: 1 })}</option>
          </select>
        </label>
      )}
      <ErrorNote message={err} />
      <Button block disabled={busy} onClick={() => void create()}>
        {t("trade.review")}
      </Button>
    </Screen>
  );
}

/** Counterparty: paste or open a link, see what the actual transaction does, accept. */
export function TradeReview(props: { link?: string }) {
  const t = useUiT();
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
    <Screen back title={t("trade.offer")}>
      {!review && (
        <>
          <label className="clip-field">
            <span className="clip-field__label">{t("trade.link")}</span>
            <textarea className="clip-textarea" rows={4} value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("trade.linkPlaceholder")} />
          </label>
          <ErrorNote message={err} />
          <Button block disabled={busy || !link.trim()} onClick={() => void check()}>
            {t("trade.check")}
          </Button>
        </>
      )}
      {review && (
        <>
          <p className="clip-h2" data-testid="trade-review-title">{review.offer.title}</p>
          <div className="clip-rows">
            <Row label={t("trade.youGet")} value={review.offer.give.display} />
            <Row label={t("trade.youGive")} value={review.offer.get.display} />
            <Row label={t("trade.from")} value={review.offer.counterparty} />
            {review.lines.map((l) => (
              <Row key={l.label + l.value} label={l.label} value={l.value} />
            ))}
          </div>
          {review.balanceChanges.length > 0 && (
            <ul className="clip-list" aria-label={t("trade.balanceChanges")}>
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
                <ol className="clip-steps" aria-label={t("trade.steps")}>
                  {review.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <ErrorNote message={err} />
              <Button block disabled={busy} onClick={() => void accept()}>
                {t("trade.accept")}
              </Button>
            </>
          )}
        </>
      )}
    </Screen>
  );
}
