/**
 * The approval sheet, laid out like the extension's (packages/ui/src/screens/Approval.tsx, the mock-up):
 * app + domain (verified or not) + network chip, plain-language title and fiat amount, From / Fee / Ready,
 * Details (steps, settlement, Advanced raw request), warnings, Reject / Approve. Unreadable requests are
 * blocked unless Advanced mode is on and the user flips the override for this one request.
 */
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { finalMsg, knownMsg, type BalanceChange } from "@clip-wallet/core";
import type { Family } from "@clip-wallet/core";
import { formatFiat, formatUnits, hueFor, readyInMessage, useBgText, userMessageOf, type ApprovalView, type PluginInsightView, formatLocale } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, ErrorNote, Notice, Row, T, Toggle, Warnings } from "../ui/kit";
import { IconAlert, IconChevron, IconShield } from "../ui/icons";
import { APP } from "../env";
import { useMobileT, type MobileMessageId } from "../i18n";
import { ContactAvatar } from "./Contacts";
import { PluginInsights } from "./Plugins";

/** readyInMessage's ids, in the mobile catalog ("common.readyIn.x" → "m.common.readyIn.x"). */
function useReadyIn() {
  const t = useMobileT();
  return (seconds: number) => {
    const r = readyInMessage(seconds);
    return t(`m.${r.id}` as MobileMessageId, "n" in r ? { n: r.n } : undefined);
  };
}

/**
 * On a wallet send: "Sending to Alex" when the recipient is a saved contact, or a danger notice when it looks
 * like a contact's address but isn't (address poisoning: same first and last characters, different middle).
 */
export function RecipientCheck(props: { address: string; family: Family }) {
  const { wallet, theme } = useWallet();
  const t = useMobileT();
  const { data } = useAsync(() => wallet.social.checkAddress({ address: props.address, family: props.family }), [wallet, props.address, props.family]);
  if (!data) return null;
  if (data.contact) {
    const c = data.contact;
    return (
      <View testID="recipient-contact" style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "center" }}>
        <ContactAvatar contact={c.contact} size={28} />
        <T style={{ fontWeight: "500" }}>
          {t("m.social.recipient.contact", { name: c.contact.name })}
          {c.entry.label ? <T v="hint">{` · ${c.entry.label}`}</T> : null}
        </T>
      </View>
    );
  }
  const l = data.lookalikes[0];
  if (!l) return null;
  return (
    <View testID="recipient-lookalike" accessibilityRole="alert" style={{ flexDirection: "row", gap: 10, backgroundColor: theme.c.dangerBg, borderRadius: theme.r.md, padding: 12, alignItems: "flex-start" }}>
      <IconAlert color={theme.c.dangerFg} size={18} />
      <View style={{ flex: 1, gap: 6 }}>
        <T color={theme.c.dangerFg} style={{ fontWeight: "700", fontSize: 15 }}>
          {t("m.social.recipient.lookalikeTitle")}
        </T>
        <T color={theme.c.dangerFg} style={{ fontSize: 14, lineHeight: 19 }}>
          {t("m.social.recipient.lookalike", { name: l.contact.name })}
        </T>
        <T v="mono" color={theme.c.dangerFg} selectable>
          {t("m.social.recipient.saved", { address: l.entry.address })}
        </T>
        <T v="mono" color={theme.c.dangerFg} selectable>
          {t("m.social.recipient.this", { address: props.address })}
        </T>
      </View>
    </View>
  );
}

function DappHeader(props: { approval: ApprovalView; advanced: boolean }) {
  const { theme } = useWallet();
  const t = useMobileT();
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }} accessibilityLabel={t(dapp.verified ? "m.approval.domainVerified" : "m.approval.domainNotVerified", { domain: dapp.domain })}>
          {dapp.verified ? <IconShield color={theme.c.positive} size={14} /> : <IconAlert color={theme.c.cautionFg} size={14} />}
          <T v="hint" color={dapp.verified ? theme.c.positive : theme.c.cautionFg} testID="dapp-domain">
            {dapp.domain}
          </T>
        </View>
      </View>
      <Chip tone="muted" testID="network-chip">{props.advanced && network.chainId !== undefined ? t("m.approval.networkChain", { name: network.name, chainId: network.chainId }) : network.name}</Chip>
    </View>
  );
}

function ChangeLine(props: { change: BalanceChange }) {
  const { theme } = useWallet();
  const t = useMobileT();
  const neg = props.change.delta.startsWith("-");
  const amount = formatUnits(neg ? props.change.delta.slice(1) : props.change.delta, props.change.asset.decimals);
  return <T color={neg ? theme.c.text : theme.c.positive}>{t("m.approval.change", { sign: neg ? "−" : "+", amount, symbol: props.change.asset.symbol })}</T>;
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
  const bg = useBgText();
  const { client, state, theme } = useWallet();
  const t = useMobileT();
  const readyIn = useReadyIn();
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
          ? t("m.common.amount", { amount: formatUnits(d.fee.amount, d.fee.asset.decimals), symbol: d.fee.asset.symbol })
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
  const steps = a.plan?.steps ?? [{ kind: "action" as const, title: d.title, titleMsg: d.titleMsg, balanceChanges: d.balanceChanges, detail: undefined }];

  return (
    <Shell
      footer={
        <>
          {d.blind && (
            <Notice level="danger">
              {t(advanced ? "m.approval.blocked" : "m.approval.blockedNeedsAdvanced", { name: APP.config.name })}
            </Notice>
          )}
          {problem && <Notice level="caution">{problem}</Notice>}
          <Warnings warnings={d.warnings.filter((w) => w.code !== "blind-signing")} />
          {d.blind && advanced && <Toggle label={t("m.approval.blindToggle")} description={t("m.approval.blindToggleHint")} checked={blindOk} onChange={setBlindOk} />}
          <ErrorNote message={err} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button variant="secondary" onPress={() => act(false)} disabled={busy} testID="reject">
              {t("m.approval.reject")}
            </Button>
            <Button onPress={() => act(true)} disabled={busy || blocked} testID="approve">
              {busy ? t("m.approval.approving") : t("m.approval.approve")}
            </Button>
          </View>
        </>
      }
    >
      <DappHeader approval={a} advanced={advanced} />
      <View style={{ alignItems: "center", gap: 6, paddingVertical: theme.s(3) }}>
        <T v="h1" style={{ textAlign: "center" }} testID="approval-title">
          {d.blind ? t("m.approval.unreadable") : bg.title(d)}
        </T>
        {a.fiatValue !== undefined && !d.blind && <T v="display">{formatFiat(a.fiatValue, currency)}</T>}
      </View>
      {a.recipient && <RecipientCheck address={a.recipient.address} family={a.recipient.family} />}
      <Card style={{ gap: 0 }}>
        {movesMoney && <Row label={t("m.approval.from")} value={a.plan?.source ?? t("m.approval.yourBalance")} />}
        {d.fee && <Row label={t("m.approval.fee")} value={feeText} hint={a.plan?.sponsored ? t("m.approval.feeCovered") : undefined} />}
        {(movesMoney || d.fee) && <Row label={t("m.approval.ready")} value={readyIn(a.plan?.readyInSeconds ?? 10)} />}
        {d.lines.map((l) => (
          <Row key={l.label} label={bg.label(l)} value={bg.value(l)} />
        ))}
      </Card>
      {/* Clip Plugins' notes: their own "From <plugin>" cards, never mixed into the wallet's lines or warnings. */}
      <PluginInsights insights={(d as { pluginInsights?: PluginInsightView[] }).pluginInsights} />
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <T color={theme.c.accent} style={{ fontWeight: "600" }}>
          {t("m.approval.details")}
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
                <T style={{ fontWeight: "500" }}>{bg.title(s)}</T>
                {s.detail ? <T v="hint">{s.detail}</T> : null}
                {(s.balanceChanges ?? []).map((c, j) => (
                  <ChangeLine key={j} change={c} />
                ))}
              </View>
            </View>
          ))}
          {a.plan?.settlement ? <T v="hint">{a.plan.settlement}</T> : null}
          {!d.simulated && !d.blind && <T v="hint">{t("m.approval.estimated")}</T>}
          {advanced && (
            <Card>
              <Row label={t("m.approval.network")} value={t("m.approval.networkValue", { name: a.network.name, id: a.network.id })} />
              <Row label={t("m.approval.via")} value={a.via} />
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
  const t = useMobileT();
  const bg = useBgText();
  const a = props.approval;
  const unknownSite = t("m.approval.connect.unknown", { name: APP.config.name, domain: a.dapp.domain });
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
          {/* Phishing lists and WalletConnect Verify (security stream); a danger finding makes this "Connect anyway". */}
          <Warnings warnings={a.connect?.warnings ?? []} />
          {!a.dapp.verified && !a.connect?.warnings?.some((w) => w.code === "domain-mismatch") && (
            <Warnings warnings={[{ level: "caution", code: "domain-mismatch", message: unknownSite, msg: finalMsg(unknownSite) }]} />
          )}
          <ErrorNote message={err} />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button variant="secondary" onPress={() => act(false)} disabled={busy} testID="reject">
              {t("m.common.cancel")}
            </Button>
            <Button variant={phishing ? "danger" : "primary"} onPress={() => act(true)} disabled={busy} testID="approve">
              {phishing ? t("m.approval.connect.connectAnyway") : t("m.approval.connect.connect")}
            </Button>
          </View>
        </>
      }
    >
      <DappHeader approval={a} advanced={advanced} />
      <View style={{ gap: 8, paddingVertical: theme.s(3) }}>
        <T v="h1" testID="approval-title">{t("m.approval.connect.title", { app: a.dapp.name })}</T>
        <T v="lede">{t("m.approval.connect.lede", { app: a.dapp.name, account: formatLocale() === "en" && a.connect?.accountLabel ? a.connect.accountLabel : t("m.approval.connect.account") })}</T>
      </View>
      <Card>
        {(a.connect?.permissions ?? []).map((p) => (
          <T key={p}>{`•  ${bg.msg(knownMsg(p), p)}`}</T>
        ))}
      </Card>
      {advanced && a.connect && <Row label={t("m.approval.connect.address")} value={<T v="mono">{a.connect.address}</T>} />}
    </Shell>
  );
}

export function ApprovalScreen(props: { approval: ApprovalView; onDone: (approved: boolean) => void }) {
  return props.approval.kind === "connect" ? <ConnectApproval {...props} /> : <TransactionApproval {...props} />;
}
