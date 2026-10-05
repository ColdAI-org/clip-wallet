import { HardwareApprovalGate } from "../hardware/HardwareApprovalGate";
import { useHardwareOptional } from "../hardware/context";
import { useId, useState } from "react";
import { finalMsg, knownMsg, type BalanceChange } from "@clip-wallet/core";
import type { ApprovalView } from "../client";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Button, Chip, ErrorNote, Row, Toggle, Warnings } from "../components";
import { PluginInsights, type PluginInsightView } from "../plugins";
import { IconChevron, IconShield, IconAlert } from "../components/icons";
import { formatFiat, formatLocale, formatUnits, readyInMessage } from "../lib/format";
import { useUiT } from "../i18n";
import { useBgText } from "../i18n/bg";
import { RecipientCheck } from "../social/RecipientCheck";
import { SettleProgress, settleBusy, settleSteps } from "./SettleFunding";
import { hueFor } from "../lib/media";

function DappHeader(props: { approval: ApprovalView; advanced: boolean }) {
  const t = useUiT();
  const { dapp, network } = props.approval;
  const hue = hueFor(dapp.domain);
  return (
    <div className="clip-approval__head">
      <span className="clip-dapp-icon" aria-hidden style={{ background: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 55% 30%)` }}>
        {dapp.name.slice(0, 1)}
      </span>
      <div className="clip-approval__dapp">
        <div className="clip-approval__dapp-name">{dapp.name}</div>
        <div className={`clip-approval__domain ${dapp.verified ? "is-verified" : "is-unverified"}`}>
          {dapp.verified ? <IconShield width={14} height={14} /> : <IconAlert width={14} height={14} />}
          <span>{dapp.domain}</span>
          <span className="clip-visually-hidden">{dapp.verified ? t("approval.verified") : t("approval.notVerified")}</span>
        </div>
      </div>
      <Chip tone="muted" className="clip-network-chip" title={props.advanced ? network.id : undefined}>
        {network.name}
        {props.advanced && network.chainId !== undefined ? ` · ${network.chainId}` : ""}
      </Chip>
    </div>
  );
}

/** Smallest amount the approval shows in full (6 decimals); anything smaller but not zero reads "<0.000001". */
const SHOWN_DECIMALS = 6;

function ChangeLine(props: { change: BalanceChange }) {
  const neg = props.change.delta.startsWith("-");
  const raw = neg ? props.change.delta.slice(1) : props.change.delta;
  const { decimals } = props.change.asset;
  // 1 wei used to read "−0 ETH" here while the title said "<0.000001 ETH": a real amount must never look like zero.
  const tiny = decimals > SHOWN_DECIMALS && BigInt(raw || "0") > 0n && BigInt(raw) < 10n ** BigInt(decimals - SHOWN_DECIMALS);
  const amount = tiny ? `<${formatUnits(10n ** BigInt(decimals - SHOWN_DECIMALS), decimals)}` : formatUnits(raw, decimals);
  return (
    <li className={`clip-change ${neg ? "is-out" : "is-in"}`}>
      {neg ? "−" : "+"}
      {amount} {props.change.asset.symbol}
    </li>
  );
}

export function TransactionApproval(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const t = useUiT();
  const bg = useBgText();
  const { client, state, config } = useUi();
  const a = props.approval;
  const d = a.decoded!;
  const advanced = !!state?.prefs.advanced;
  const currency = state?.prefs.displayCurrency ?? "USD";
  const [open, setOpen] = useState(false);
  const [blindOk, setBlindOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const detailsId = useId();

  const problem = a.plan?.problem;
  // Money from a bonded Connector (settle on Hedera): after the first Approve the order's progress replaces the actions.
  const funding = a.plan?.funding;
  // Messages and sign-ins move no money: no From/Fee/Ready rows for them.
  const movesMoney = d.balanceChanges.some((c) => c.delta.startsWith("-"));
  const blocked = (d.blind && !(advanced && blindOk)) || !!problem;
  const feeText =
    a.plan?.feeFiat !== undefined
      ? formatFiat(a.plan.feeFiat, currency)
      : d.fee?.fiatValue !== undefined
        ? formatFiat(d.fee.fiatValue, currency)
        : d.fee
          ? `${formatUnits(d.fee.amount, d.fee.asset.decimals)} ${d.fee.asset.symbol}`
          : "—";

  const act = async (approve: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      if (approve) await client.approve(a.id, { allowBlind: d.blind ? blindOk : undefined });
      else await client.reject(a.id);
      props.onDone?.(approve);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = readyInMessage(a.plan?.readyInSeconds ?? 10);
  const planSteps = a.plan?.steps ?? [{ kind: "action" as const, title: d.title, titleMsg: d.titleMsg, balanceChanges: d.balanceChanges }];
  const steps = funding
    ? [...settleSteps(funding, t).map((s) => ({ ...s, kind: "funding" as const, balanceChanges: undefined })), ...planSteps.filter((s) => s.kind !== "funding")]
    : planSteps;

  return (
    <div className="clip-approval" aria-labelledby={`${detailsId}-t`}>
      <DappHeader approval={a} advanced={advanced} />

      <div className="clip-approval__hero">
        <h1 id={`${detailsId}-t`} className="clip-approval__title">
          {d.blind ? t("approval.unreadable") : bg.title(d)}
        </h1>
        {a.fiatValue !== undefined && !d.blind && <p className="clip-approval__fiat">{formatFiat(a.fiatValue, currency)}</p>}
      </div>

      {a.recipient && <RecipientCheck address={a.recipient.address} family={a.recipient.family} />}

      <div className="clip-rows">
        {movesMoney && <Row label={t("approval.from")} value={funding ? t("settle.from", { provider: funding.provider }) : (a.plan?.source ?? t("approval.yourBalance"))} />}
        {d.fee && <Row label={t("approval.fee")} value={feeText} hint={a.plan?.sponsored ? t("approval.feeCovered") : undefined} />}
        {(movesMoney || d.fee) && <Row label={t("approval.ready")} value={t(ready.id, ready)} />}
        {d.lines.map((l) => (
          <Row key={l.label} label={bg.label(l)} value={bg.value(l)} />
        ))}
      </div>

      <button
        type="button"
        className="clip-link clip-approval__details-toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
      >
        {t("approval.details")} <IconChevron width={14} height={14} className={open ? "is-open" : ""} />
      </button>

      {open && (
        <div id={detailsId} className="clip-approval__details">
          <ol className="clip-steps">
            {steps.map((s, i) => (
              <li key={i} className={`clip-step clip-step--${s.kind}`}>
                <span className="clip-step__n" aria-hidden>
                  {i + 1}
                </span>
                <div className="clip-step__body">
                  <div className="clip-step__title">{bg.title(s)}</div>
                  {s.detail && <div className="clip-step__detail">{s.detail}</div>}
                  {s.balanceChanges && s.balanceChanges.length > 0 && (
                    <ul className="clip-changes" aria-label={d.simulated ? t("approval.simulatedChanges") : t("approval.expectedChanges")}>
                      {s.balanceChanges.map((c, j) => (
                        <ChangeLine key={j} change={c} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {a.plan?.settlement && <p className="clip-approval__settlement">{funding ? t("settle.settlement", { provider: funding.provider }) : a.plan.settlement}</p>}
          {!d.simulated && !d.blind && <p className="clip-approval__settlement">{t("approval.estimated")}</p>}
          {advanced && (
            <div className="clip-advanced-block">
              <Row label={t("approval.network")} value={t("approval.networkValue", { name: a.network.name, id: a.network.id })} />
              <Row label={t("approval.via")} value={a.via} />
              {a.raw && (
                <pre className="clip-raw" aria-label={t("approval.raw")}>
                  {a.raw}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <div className="clip-approval__bottom">
        {d.blind && (
          <div className="clip-notice clip-notice--danger" role="alert">
            <IconAlert />
            <span>{t(advanced ? "approval.blocked" : "approval.blockedNeedsAdvanced", { name: config.name })}</span>
          </div>
        )}
        {problem && (
          <div className="clip-notice clip-notice--caution" role="alert">
            <IconAlert />
            <span>{problem}</span>
          </div>
        )}
        {a.batch && a.batch.count > 1 && (
          <p className="clip-notice clip-notice--info" data-testid="batch-sequential">
            {t("approval.batch.sequential")}
          </p>
        )}
        <Warnings warnings={d.warnings.filter((w) => w.code !== "blind-signing")} />
        <PluginInsights insights={(d as { pluginInsights?: PluginInsightView[] }).pluginInsights} />
        {d.blind && advanced && (
          <Toggle
            label={t("approval.blindToggle")}
            description={t("approval.blindToggleHint")}
            checked={blindOk}
            onChange={setBlindOk}
          />
        )}
        <ErrorNote message={err} />
        {funding && (settleBusy(funding) || funding.arrived) && <SettleProgress funding={funding} app={a.dapp.name} busy={busy} act={() => act(true)} />}
        {!(funding && (settleBusy(funding) || (funding.arrived && funding.appGone))) && (
          <div className="clip-actions">
            <Button variant="secondary" onClick={() => act(false)} disabled={busy}>
              {t("approval.reject")}
            </Button>
            <Button onClick={() => act(true)} disabled={busy || blocked} aria-disabled={busy || blocked}>
              {t("approval.approve")}
            </Button>
          </div>
        )}
        {funding?.arrived && funding.appGone && (
          <Button block variant="secondary" onClick={() => act(true)} disabled={busy}>
            {t("settle.close")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function ConnectApproval(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const t = useUiT();
  const bg = useBgText();
  const { client, state, config } = useUi();
  const a = props.approval;
  const unknownSite = t("approval.connect.unknown", { name: config.name, domain: a.dapp.domain });
  const advanced = !!state?.prefs.advanced;
  const phishing = !!a.connect?.warnings?.some((w) => w.level === "danger");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const act = async (approve: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      if (approve) await client.approve(a.id);
      else await client.reject(a.id);
      props.onDone?.(approve);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="clip-approval">
      <DappHeader approval={a} advanced={advanced} />
      <div className="clip-approval__hero">
        <h1 className="clip-approval__title">{t("approval.connect.title", { app: a.dapp.name })}</h1>
        <p className="clip-approval__fiat">{t("approval.connect.lede", { app: a.dapp.name, account: formatLocale() === "en" && a.connect?.accountLabel ? a.connect.accountLabel : t("approval.connect.account") })}</p>
      </div>
      <ul className="clip-bullets">
        {(a.connect?.permissions ?? []).map((p) => (
          <li key={p}>{bg.msg(knownMsg(p), p)}</li>
        ))}
      </ul>
      {advanced && a.connect && <Row label={t("approval.connect.address")} value={<code className="clip-mono">{a.connect.address}</code>} />}
      <div className="clip-approval__bottom">
        <Warnings warnings={a.connect?.warnings ?? []} />
        {!a.dapp.verified && !a.connect?.warnings?.some((w) => w.code === "domain-mismatch") && (
          <Warnings
            warnings={[
              { level: "caution", code: "domain-mismatch", message: unknownSite, msg: finalMsg(unknownSite) },
            ]}
          />
        )}
        <ErrorNote message={err} />
        <div className="clip-actions">
          <Button variant="secondary" onClick={() => act(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant={phishing ? "danger" : "primary"} onClick={() => act(true)} disabled={busy}>
            {phishing ? t("approval.connect.connectAnyway") : t("approval.connect.connect")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalScreen(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const hardware = useHardwareOptional();
  const { client } = useUi();
  const bg = useBgText();
  if (props.approval.kind === "connect") return <ConnectApproval approval={props.approval} onDone={props.onDone} />;
  const tx = <TransactionApproval approval={props.approval} onDone={props.onDone} />;
  if (!hardware) return tx;
  // While a Ledger or Keystone signs this request, the device step replaces the approval screen.
  return (
    <HardwareApprovalGate
      approvalId={props.approval.id}
      title={props.approval.decoded ? bg.title(props.approval.decoded) : ""}
      state={props.approval.hardware}
      client={hardware}
      onRetry={() => void client.approve(props.approval.id).then(() => props.onDone?.(true), () => undefined)}
    >
      {tx}
    </HardwareApprovalGate>
  );
}
