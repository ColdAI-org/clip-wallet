import { HardwareApprovalGate } from "../hardware/HardwareApprovalGate";
import { useHardwareOptional } from "../hardware/context";
import { useId, useState } from "react";
import type { BalanceChange } from "@clip-wallet/core";
import type { ApprovalView } from "../client";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Button, Chip, ErrorNote, Row, Toggle, Warnings } from "../components";
import { IconChevron, IconShield, IconAlert } from "../components/icons";
import { formatFiat, formatUnits, readyIn } from "../lib/format";
import { hueFor } from "../lib/media";

function DappHeader(props: { approval: ApprovalView; advanced: boolean }) {
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
          <span className="clip-visually-hidden">{dapp.verified ? "(verified)" : "(not verified)"}</span>
        </div>
      </div>
      <Chip tone="muted" className="clip-network-chip" title={props.advanced ? network.id : undefined}>
        {network.name}
        {props.advanced && network.chainId !== undefined ? ` · ${network.chainId}` : ""}
      </Chip>
    </div>
  );
}

function ChangeLine(props: { change: BalanceChange }) {
  const neg = props.change.delta.startsWith("-");
  const amount = formatUnits(neg ? props.change.delta.slice(1) : props.change.delta, props.change.asset.decimals);
  return (
    <li className={`clip-change ${neg ? "is-out" : "is-in"}`}>
      {neg ? "−" : "+"}
      {amount} {props.change.asset.symbol}
    </li>
  );
}

export function TransactionApproval(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const { client, state } = useUi();
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

  const steps = a.plan?.steps ?? [
    { kind: "action" as const, title: d.title, balanceChanges: d.balanceChanges },
  ];

  return (
    <div className="clip-approval" aria-labelledby={`${detailsId}-t`}>
      <DappHeader approval={a} advanced={advanced} />

      <div className="clip-approval__hero">
        <h1 id={`${detailsId}-t`} className="clip-approval__title">
          {d.blind ? "Unreadable request" : d.title}
        </h1>
        {a.fiatValue !== undefined && !d.blind && <p className="clip-approval__fiat">{formatFiat(a.fiatValue, currency)}</p>}
      </div>

      <div className="clip-rows">
        {movesMoney && <Row label="From" value={a.plan?.source ?? "Your balance"} />}
        {d.fee && <Row label="Fee" value={feeText} hint={a.plan?.sponsored ? "network fee covered" : undefined} />}
        {(movesMoney || d.fee) && <Row label="Ready" value={readyIn(a.plan?.readyInSeconds ?? 10)} />}
        {d.lines.map((l) => (
          <Row key={l.label} label={l.label} value={l.value} />
        ))}
      </div>

      <button
        type="button"
        className="clip-link clip-approval__details-toggle"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((o) => !o)}
      >
        Details <IconChevron width={14} height={14} className={open ? "is-open" : ""} />
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
                  <div className="clip-step__title">{s.title}</div>
                  {s.detail && <div className="clip-step__detail">{s.detail}</div>}
                  {s.balanceChanges && s.balanceChanges.length > 0 && (
                    <ul className="clip-changes" aria-label={d.simulated ? "Simulated balance changes" : "Expected balance changes"}>
                      {s.balanceChanges.map((c, j) => (
                        <ChangeLine key={j} change={c} />
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {a.plan?.settlement && <p className="clip-approval__settlement">{a.plan.settlement}</p>}
          {!d.simulated && !d.blind && <p className="clip-approval__settlement">These changes are estimated; this network can't preview them.</p>}
          {advanced && (
            <div className="clip-advanced-block">
              <Row label="Network" value={`${a.network.name} (${a.network.id})`} />
              <Row label="Via" value={a.via} />
              {a.raw && (
                <pre className="clip-raw" aria-label="Raw request">
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
            <span>
              Clip Wallet can't read this request, so it's blocked. Signing something you can't read can empty your wallet.
              {!advanced && " Only Advanced mode can override this."}
            </span>
          </div>
        )}
        {problem && (
          <div className="clip-notice clip-notice--caution" role="alert">
            <IconAlert />
            <span>{problem}</span>
          </div>
        )}
        <Warnings warnings={d.warnings.filter((w) => w.code !== "blind-signing")} />
        {d.blind && advanced && (
          <Toggle
            label="Sign this unreadable request anyway"
            description="Only if you trust this site completely."
            checked={blindOk}
            onChange={setBlindOk}
          />
        )}
        <ErrorNote message={err} />
        <div className="clip-actions">
          <Button variant="secondary" onClick={() => act(false)} disabled={busy}>
            Reject
          </Button>
          <Button onClick={() => act(true)} disabled={busy || blocked} aria-disabled={busy || blocked}>
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ConnectApproval(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const { client, state, config } = useUi();
  const a = props.approval;
  const advanced = !!state?.prefs.advanced;
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
        <h1 className="clip-approval__title">Connect to {a.dapp.name}?</h1>
        <p className="clip-approval__fiat">
          {a.dapp.name} will see your {a.connect?.accountLabel ?? "account"}. It can ask you to approve things, but can't move
          anything without you.
        </p>
      </div>
      <ul className="clip-bullets">
        {(a.connect?.permissions ?? []).map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      {advanced && a.connect && <Row label="Address" value={<code className="clip-mono">{a.connect.address}</code>} />}
      <div className="clip-approval__bottom">
        {!a.dapp.verified && (
          <Warnings
            warnings={[
              { level: "caution", code: "domain-mismatch", message: `${config.name} doesn't recognise ${a.dapp.domain}. Only connect if you opened it yourself.` },
            ]}
          />
        )}
        <ErrorNote message={err} />
        <div className="clip-actions">
          <Button variant="secondary" onClick={() => act(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => act(true)} disabled={busy}>
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalScreen(props: { approval: ApprovalView; onDone?: (approved: boolean) => void }) {
  const hardware = useHardwareOptional();
  const { client } = useUi();
  if (props.approval.kind === "connect") return <ConnectApproval approval={props.approval} onDone={props.onDone} />;
  const tx = <TransactionApproval approval={props.approval} onDone={props.onDone} />;
  if (!hardware) return tx;
  // While a Ledger or Keystone signs this request, the device step replaces the approval screen.
  return (
    <HardwareApprovalGate
      approvalId={props.approval.id}
      title={props.approval.decoded?.title ?? ""}
      state={props.approval.hardware}
      client={hardware}
      onRetry={() => void client.approve(props.approval.id).then(() => props.onDone?.(true), () => undefined)}
    >
      {tx}
    </HardwareApprovalGate>
  );
}
