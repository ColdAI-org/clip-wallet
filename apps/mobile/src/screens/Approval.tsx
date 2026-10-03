/**
 * The approval sheet, laid out like the extension's (packages/ui/src/screens/Approval.tsx, the mock-up):
 * app + domain (verified or not) + network chip, plain-language title and fiat amount, From / Fee / Ready,
 * Details (steps, settlement, Advanced raw request), warnings, Reject / Approve. Unreadable requests are
 * blocked unless Advanced mode is on and the user flips the override for this one request.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BalanceChange } from "@clip-wallet/core";
import { formatFiat, formatUnits, hueFor, readyIn, userMessageOf, type ApprovalView } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, Card, Chip, ErrorNote, Notice, Row, T, Toggle, Warnings } from "../ui/kit";
import { IconAlert, IconChevron, IconShield } from "../ui/icons";
import { APP } from "../env";

function DappHeader(props: { approval: ApprovalView; advanced: boolean }) {
  const { theme } = useWallet();
  const { dapp, network } = props.approval;
  const hue = hueFor(dapp.domain);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: `hsl(${hue}, 70%, 92%)`, alignItems: "center", justifyContent: "center" }}>
        <T color={`hsl(${hue}, 55%, 30%)`} style={{ fontWeight: "700", fontSize: 18 }}>
          {dapp.name.slice(0, 1)}
        </T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={{ fontWeight: "600" }} testID="dapp-name">
          {dapp.name}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityLabel={`${dapp.domain} ${dapp.verified ? "(verified)" : "(not verified)"}`}>
          {dapp.verified ? <IconShield color={theme.c.positive} size={14} /> : <IconAlert color={theme.c.cautionFg} size={14} />}
          <T v="hint" color={dapp.verified ? theme.c.positive : theme.c.cautionFg} testID="dapp-domain">
            {dapp.domain}
          </T>
        </View>
      </View>
      <Chip tone="muted" testID="network-chip">{`${network.name}${props.advanced && network.chainId !== undefined ? ` · ${network.chainId}` : ""}`}</Chip>
    </View>
  );
}

function ChangeLine(props: { change: BalanceChange }) {
  const { theme } = useWallet();
  const neg = props.change.delta.startsWith("-");
  const amount = formatUnits(neg ? props.change.delta.slice(1) : props.change.delta, props.change.asset.decimals);
  return <T color={neg ? theme.c.text : theme.c.positive}>{`${neg ? "−" : "+"}${amount} ${props.change.asset.symbol}`}</T>;
}

function Shell(props: { children: React.ReactNode; footer: React.ReactNode }) {
  const { theme } = useWallet();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.c.bg, paddingTop: insets.top + 8 }} testID="approval">
      <ScrollView contentContainerStyle={{ padding: theme.s(4), gap: theme.s(4) }}>{props.children}</ScrollView>
      <View style={{ padding: theme.s(4), paddingBottom: insets.bottom + theme.s(3), gap: theme.s(3), borderTopWidth: 1, borderTopColor: theme.c.border }}>{props.footer}</View>
    </View>
  );
}

export function TransactionApproval(props: { approval: ApprovalView; onDone: (approved: boolean) => void }) {
  const { client, state, theme } = useWallet();
  const a = props.approval;
  const d = a.decoded!;
  const advanced = !!state?.prefs.advanced;
  const currency = state?.prefs.displayCurrency ?? "USD";
  const [open, setOpen] = useState(false);
  const [blindOk, setBlindOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problem = a.plan?.problem;
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
      props.onDone(approve);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const steps = a.plan?.steps ?? [{ kind: "action" as const, title: d.title, balanceChanges: d.balanceChanges, detail: undefined }];

  return (
    <Shell
      footer={
        <>
          {d.blind && (
            <Notice level="danger">
              {`${APP.config.name} can't read this request, so it's blocked. Signing something you can't read can empty your wallet.${advanced ? "" : " Only Advanced mode can override this."}`}
            </Notice>
          )}
          {problem && <Notice level="caution">{problem}</Notice>}
          <Warnings warnings={d.warnings.filter((w) => w.code !== "blind-signing")} />
          {d.blind && advanced && <Toggle label="Sign this unreadable request anyway" description="Only if you trust this site completely." checked={blindOk} onChange={setBlindOk} />}
          <ErrorNote message={err} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button variant="secondary" onPress={() => act(false)} disabled={busy} testID="reject">
              Reject
            </Button>
            <Button onPress={() => act(true)} disabled={busy || blocked} testID="approve">
              {busy ? "Approving…" : "Approve"}
            </Button>
          </View>
        </>
      }
    >
      <DappHeader approval={a} advanced={advanced} />
      <View style={{ alignItems: "center", gap: 6, paddingVertical: theme.s(3) }}>
        <T v="h1" style={{ textAlign: "center" }} testID="approval-title">
          {d.blind ? "Unreadable request" : d.title}
        </T>
        {a.fiatValue !== undefined && !d.blind && <T v="display">{formatFiat(a.fiatValue, currency)}</T>}
      </View>
      <Card style={{ gap: 0 }}>
        {movesMoney && <Row label="From" value={a.plan?.source ?? "Your balance"} />}
        {d.fee && <Row label="Fee" value={feeText} hint={a.plan?.sponsored ? "network fee covered" : undefined} />}
        {(movesMoney || d.fee) && <Row label="Ready" value={readyIn(a.plan?.readyInSeconds ?? 10)} />}
        {d.lines.map((l) => (
          <Row key={l.label} label={l.label} value={l.value} />
        ))}
      </Card>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <T color={theme.c.accent} style={{ fontWeight: "600" }}>
          Details
        </T>
        <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}>
          <IconChevron color={theme.c.accent} size={14} />
        </View>
      </Pressable>
      {open && (
        <View style={{ gap: 10 }}>
          {steps.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: theme.c.surface2, alignItems: "center", justifyContent: "center" }}>
                <T v="hint">{i + 1}</T>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: "500" }}>{s.title}</T>
                {s.detail ? <T v="hint">{s.detail}</T> : null}
                {(s.balanceChanges ?? []).map((c, j) => (
                  <ChangeLine key={j} change={c} />
                ))}
              </View>
            </View>
          ))}
          {a.plan?.settlement ? <T v="hint">{a.plan.settlement}</T> : null}
          {!d.simulated && !d.blind && <T v="hint">These changes are estimated; this network can't preview them.</T>}
          {advanced && (
            <Card>
              <Row label="Network" value={`${a.network.name} (${a.network.id})`} />
              <Row label="Via" value={a.via} />
              {a.raw ? <T v="mono">{a.raw}</T> : null}
            </Card>
          )}
        </View>
      )}
    </Shell>
  );
}

export function ConnectApproval(props: { approval: ApprovalView; onDone: (approved: boolean) => void }) {
  const { client, state, theme } = useWallet();
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
      props.onDone(approve);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell
      footer={
        <>
          {!a.dapp.verified && (
            <Warnings warnings={[{ level: "caution", code: "domain-mismatch", message: `${APP.config.name} doesn't recognise ${a.dapp.domain}. Only connect if you opened it yourself.` }]} />
          )}
          <ErrorNote message={err} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button variant="secondary" onPress={() => act(false)} disabled={busy} testID="reject">
              Cancel
            </Button>
            <Button onPress={() => act(true)} disabled={busy} testID="approve">
              Connect
            </Button>
          </View>
        </>
      }
    >
      <DappHeader approval={a} advanced={advanced} />
      <View style={{ gap: 8, paddingVertical: theme.s(3) }}>
        <T v="h1" testID="approval-title">{`Connect to ${a.dapp.name}?`}</T>
        <T v="lede">{`${a.dapp.name} will see your ${a.connect?.accountLabel ?? "account"}. It can ask you to approve things, but can't move anything without you.`}</T>
      </View>
      <Card>
        {(a.connect?.permissions ?? []).map((p) => (
          <T key={p}>{`•  ${p}`}</T>
        ))}
      </Card>
      {advanced && a.connect && <Row label="Address" value={<T v="mono">{a.connect.address}</T>} />}
    </Shell>
  );
}

export function ApprovalScreen(props: { approval: ApprovalView; onDone: (approved: boolean) => void }) {
  return props.approval.kind === "connect" ? <ConnectApproval {...props} /> : <TransactionApproval {...props} />;
}
