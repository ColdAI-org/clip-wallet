/**
 * Secure Trade: the extension's TradeHome / TradeCreate / TradeDetail / TradeReview
 * (packages/ui/src/features/Trade.tsx) in React Native. Swap directly with one person on Hedera: both sides
 * move together, or nothing moves.
 *
 * Mobile differences: the offer link goes out through the native share sheet (and as a QR code), and the other
 * side opens it as a deep link (clipwallet://trade#offer=… or ?offer=…, or the https universal link), which
 * lands on TradeReview. Review is decoded from the actual transaction, not from what the link claims.
 */
import { useState } from "react";
import { Platform, Pressable, Share, View } from "react-native";
import { canonicalAmount, formatUnits, relativeTime, userMessageOf, type TradeLegInput, type TradeOfferView, type TradeReviewView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, CopyButton, Empty, ErrorNote, Field, Notice, Pills, Qr, Row, Screen, Spinner, Steps, T, Warnings } from "../ui/kit";
import { IconShare } from "../ui/icons";
import { useFormat, useMobileT } from "../i18n";

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

export function TradeHome() {
  const { wallet, navigate } = useWallet();
  const tr = useMobileT();
  const { data, error } = useAsync(() => wallet.features.tradeList(), [wallet]);
  return (
    <Screen back title={tr("m.trade.title")}>
      <T v="lede">{tr("m.trade.lede")}</T>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button onPress={() => navigate({ name: "trade-new" })} testID="trade-new">
          {tr("m.trade.new")}
        </Button>
        <Button variant="secondary" onPress={() => navigate({ name: "trade-open" })} testID="trade-open">
          {tr("m.trade.openLink")}
        </Button>
      </View>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      {data?.length === 0 && <Empty title={tr("m.trade.none")} />}
      {data && data.length > 0 && (
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          {data.map((t) => (
            <Pressable key={t.id} accessibilityRole="button" testID={`trade-${t.id}`} onPress={() => navigate({ name: "trade-detail", id: t.id })} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T style={{ fontWeight: "600" }}>{t.title}</T>
                <T v="hint">{tr("m.trade.statusWhen", { status: t.statusText, when: relativeTime(t.createdAt) })}</T>
              </View>
              <Chip tone={STATUS_TONE[t.status]}>{t.status === "done" ? tr("m.trade.chip.done") : t.status === "waiting" ? tr("m.trade.chip.waiting") : tr("m.trade.chip.closed")}</Chip>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}

/** Hands the link to the native share sheet (Messages, Signal, AirDrop, …), in the sender's language. */
export async function shareTrade(t: Pick<TradeOfferView, "title" | "link" | "mode">, tr: ReturnType<typeof useMobileT>): Promise<void> {
  if (!t.link) return;
  const lead = t.mode === "direct" ? tr("m.trade.share.direct") : tr("m.trade.share.later");
  if (Platform.OS === "ios") await Share.share({ message: tr("m.trade.share.ios", { title: t.title, lead }), url: t.link });
  else await Share.share({ message: tr("m.trade.share.android", { title: t.title, lead, link: t.link }), title: t.title });
}

export function TradeDetail(props: { id: string }) {
  const { wallet, theme } = useWallet();
  const tr = useMobileT();
  const f = useFormat();
  const { data, error } = useAsync(() => wallet.features.tradeList(), [wallet]);
  const [err, setErr] = useState<string | null>(null);
  const t = data?.find((x) => x.id === props.id);
  if (error) return <Screen back title={tr("m.trade.title")}><ErrorNote message={userMessageOf(error)} /></Screen>;
  if (!data) return <Screen back title={tr("m.trade.title")}><Spinner /></Screen>;
  if (!t) return <Screen back title={tr("m.trade.title")}><Empty title={tr("m.trade.gone")} /></Screen>;
  const sharing = !!t.link && t.status === "waiting" && t.role === "maker";
  return (
    <Screen back title={tr("m.trade.title")}>
      <T v="h1" style={{ fontSize: 20 }} testID="trade-title">
        {t.title}
      </T>
      <Card style={{ gap: 0 }}>
        <Row label={tr("m.trade.youGive")} value={t.give.display} />
        <Row label={tr("m.trade.youGet")} value={t.get.display} />
        <Row label={tr("m.trade.with")} value={t.counterparty} />
        <Row label={tr("m.trade.status")} value={t.statusText} testID="trade-status" />
        {t.expiresAt && t.status === "waiting" ? <Row label={tr("m.trade.openUntil")} value={new Date(t.expiresAt).toLocaleString(f.locale)} /> : null}
      </Card>
      {t.notes.map((n) => (
        <Notice key={n} level="info">
          {n}
        </Notice>
      ))}
      {sharing && (
        <Card>
          <T v="hint">{t.mode === "direct" ? tr("m.trade.sendNow") : tr("m.trade.sendLater")}</T>
          <Button block testID="trade-share" onPress={() => void shareTrade(t, tr).catch((e: unknown) => setErr(userMessageOf(e)))}>
            <IconShare color={theme.c.accentText} />
            <T color={theme.c.accentText} style={{ fontWeight: "600" }}>
              {tr("m.trade.shareLink")}
            </T>
          </Button>
          {t.link!.length <= QR_MAX ? <Qr value={t.link!} label={tr("m.trade.qrLabel")} size={220} /> : <T v="hint">{tr("m.trade.tooLong")}</T>}
          <T v="mono" testID="trade-link" numberOfLines={1}>
            {t.link!.length > 80 ? `${t.link!.slice(0, 60)}…` : t.link!}
          </T>
          <CopyButton value={t.link!} label={tr("m.trade.copyLink")} />
        </Card>
      )}
      <ErrorNote message={err} />
    </Screen>
  );
}

type LegForm = { kind: "asset"; assetKey: string; amount: string } | { kind: "nft"; tokenId: string; serial: string };

function toInput(l: LegForm): TradeLegInput {
  // "0,5" and "0.5" are both half (the shared amount rule); the background gets "0.5".
  return l.kind === "nft" ? { nft: { tokenId: l.tokenId.trim(), serial: l.serial.trim() } } : { assetKey: l.assetKey.trim(), amount: canonicalAmount(l.amount) ?? l.amount.trim() };
}

function LegFields(props: { label: string; id: string; value: LegForm; onChange: (v: LegForm) => void; assets: { key: string; symbol: string }[] }) {
  const v = props.value;
  const tr = useMobileT();
  return (
    <Card>
      <T v="h2">{props.label}</T>
      <Pills
        label={tr("m.trade.what")}
        testID={`${props.id}-kind`}
        value={v.kind}
        onChange={(k) => props.onChange(k === "asset" ? { kind: "asset", assetKey: props.assets[0]?.key ?? "hbar", amount: "" } : { kind: "nft", tokenId: "", serial: "" })}
        options={[
          { value: "asset", label: tr("m.trade.kind.asset") },
          { value: "nft", label: tr("m.trade.kind.nft") },
        ]}
      />
      {v.kind === "asset" ? (
        <>
          <Pills label={tr("m.trade.asset")} testID={`${props.id}-asset`} value={v.assetKey} onChange={(k) => props.onChange({ ...v, assetKey: k })} options={props.assets.map((a) => ({ value: a.key, label: a.symbol }))} />
          <Field label={tr("m.trade.amount")} keyboardType="decimal-pad" placeholder="0" testID={`${props.id}-amount`} value={v.amount} onChangeText={(t) => props.onChange({ ...v, amount: t })} />
        </>
      ) : (
        <>
          <Field label={tr("m.trade.collection")} placeholder="0.0.1234" autoCapitalize="none" testID={`${props.id}-token`} value={v.tokenId} onChangeText={(t) => props.onChange({ ...v, tokenId: t })} />
          <Field label={tr("m.trade.itemNumber")} keyboardType="number-pad" placeholder="1" testID={`${props.id}-serial`} value={v.serial} onChangeText={(t) => props.onChange({ ...v, serial: t })} />
        </>
      )}
    </Card>
  );
}

/** Create an offer: what you give, what you get, who with, and whether they're online now. */
export function TradeCreate() {
  const { client, wallet, showApproval } = useWallet();
  const tr = useMobileT();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  // Secure Trade runs on Hedera; offer the assets that live there, by symbol only.
  const assets = (data?.assets ?? [])
    .filter((a) => a.networkId.startsWith("hedera:") && !a.spam)
    .map((a) => ({ key: a.key, symbol: a.symbol }))
    .filter((a, i, all) => all.findIndex((x) => x.key === a.key) === i);
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
    if (!/^0\.0\.\d+(-[a-z]{5})?$|^0x[0-9a-fA-F]{40}$/.test(counterparty.trim())) return setErr(tr("m.trade.counterpartyBad", { example: "0.0.1234" }));
    setBusy(true);
    try {
      const r = await wallet.features.tradeCreate({ give: toInput(give), get: toInput(get), counterparty: counterparty.trim(), mode, expiresInHours: mode === "scheduled" ? hours : undefined });
      showApproval(r.queued.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <Screen back title={tr("m.trade.new")}><Spinner /></Screen>;
  return (
    <Screen
      back
      title={tr("m.trade.new")}
      footer={
        <Button block disabled={busy} onPress={() => void create()} testID="trade-create">
          {tr("m.trade.review")}
        </Button>
      }
    >
      <LegFields label={tr("m.trade.youGive")} id="give" value={give} onChange={setGive} assets={assets} />
      <LegFields label={tr("m.trade.youGet")} id="get" value={get} onChange={setGet} assets={assets} />
      <Field label={tr("m.trade.tradeWith")} placeholder="0.0.1234" autoCapitalize="none" spellCheck={false} testID="trade-counterparty" value={counterparty} onChangeText={setCounterparty} />
      <Pills
        label={tr("m.trade.whenAccept")}
        testID="trade-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: "direct", label: tr("m.trade.mode.direct") },
          { value: "scheduled", label: tr("m.trade.mode.later") },
        ]}
      />
      <T v="hint">{mode === "direct" ? tr("m.trade.mode.directHint") : tr("m.trade.mode.laterHint")}</T>
      {mode === "scheduled" && (
        <Pills
          label={tr("m.trade.openFor")}
          testID="trade-hours"
          value={hours}
          onChange={setHours}
          options={[
            { value: 1, label: tr("m.trade.hour") },
            { value: 24, label: tr("m.trade.day") },
            { value: 168, label: tr("m.trade.week") },
          ]}
        />
      )}
      <ErrorNote message={err} />
    </Screen>
  );
}

/** Counterparty: open (deep link) or paste a link, see what the actual transaction does, accept. */
export function TradeReview(props: { link?: string }) {
  const { wallet, navigate, showApproval } = useWallet();
  const tr = useMobileT();
  const [link, setLink] = useState(props.link ?? "");
  const auto = useAsync(async () => (props.link ? wallet.features.tradeReview({ link: props.link.trim() }) : null), [wallet, props.link]);
  const [review, setReview] = useState<TradeReviewView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = review ?? auto.data ?? null;
  const autoErr = !review && auto.error ? userMessageOf(auto.error) : null;

  async function check() {
    setErr(null);
    setReview(null);
    setBusy(true);
    try {
      setReview(await wallet.features.tradeReview({ link: link.trim() }));
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
      const q = await wallet.features.tradeAccept({ link: link.trim() });
      showApproval(q.approvalId);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (props.link && auto.loading && !shown) return <Screen back title={tr("m.trade.offer")}><Spinner /></Screen>;

  if (!shown) {
    return (
      <Screen back title={tr("m.trade.offer")}>
        <Field label={tr("m.trade.link")} multiline numberOfLines={4} autoCapitalize="none" placeholder={tr("m.trade.linkPlaceholder")} testID="trade-link-input" value={link} onChangeText={setLink} style={{ minHeight: 96, textAlignVertical: "top" }} />
        <ErrorNote message={err ?? autoErr} />
        <Button block disabled={busy || !link.trim()} onPress={() => void check()} testID="trade-check">
          {tr("m.trade.check")}
        </Button>
        <Button block variant="secondary" onPress={() => navigate({ name: "scan" })}>
          {tr("m.trade.scan")}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={tr("m.trade.offer")}
      footer={
        shown.problem ? null : (
          <Button block disabled={busy} onPress={() => void accept()} testID="trade-accept">
            {tr("m.trade.accept")}
          </Button>
        )
      }
    >
      <T v="h1" style={{ fontSize: 20 }} testID="trade-review-title">
        {shown.offer.title}
      </T>
      <Card style={{ gap: 0 }}>
        <Row label={tr("m.trade.youGet")} value={shown.offer.give.display} />
        <Row label={tr("m.trade.youGive")} value={shown.offer.get.display} />
        <Row label={tr("m.trade.from")} value={shown.offer.counterparty} />
        {shown.lines.map((l) => (
          <Row key={l.label + l.value} label={l.label} value={l.value} />
        ))}
      </Card>
      {shown.balanceChanges.length > 0 && (
        <Card>
          <View accessibilityLabel={tr("m.trade.balanceChanges")} style={{ gap: 6 }}>
            {shown.balanceChanges.map((c) => (
              <T key={c.asset.key + c.delta}>{`${c.delta.startsWith("-") ? "−" : "+"}${formatUnits(c.delta.replace(/^-/, ""), c.asset.decimals)} ${c.asset.symbol}`}</T>
            ))}
          </View>
        </Card>
      )}
      <Warnings warnings={shown.warnings} />
      {shown.problem ? <ErrorNote message={shown.problem} /> : shown.steps.length > 1 ? <Steps label={tr("m.trade.whatYouApprove")} items={shown.steps} /> : null}
      <ErrorNote message={err} />
    </Screen>
  );
}
