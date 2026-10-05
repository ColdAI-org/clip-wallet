/**
 * Settings → Security, the same three screens as the extension (packages/ui/src/security/Security.tsx) on the
 * engine's security service (wallet.security):
 *  - App permissions: every standing permission with its risk flags; risky ones are ticked; removing them queues
 *    one approval at a time on the normal approval sheet (the vault signs there).
 *  - Clean up: spam and empty accounts; the button says what one tap does ("Get back ~0.0041 SOL").
 *  - Scam protection: each source, whether it's on, when it was updated and exactly what it sees (Blockaid is off
 *    without a key, and says so).
 */
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { relativeTime, userMessageOf, type CleanupItemView, type CleanupSummaryView, type GrantView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, Empty, ErrorNote, MenuItem, Notice, Screen, Spinner, T } from "../ui/kit";
import { IconCheck } from "../ui/icons";
import { APP } from "../env";
import { useFormat, useMobileT, type MobileMessageId } from "../i18n";
import { cleanupLines, cleanupReason, grantTitle, noteText, partialText, privacyText, riskText, sourceName, sourceUnavailable } from "../lib/security-text";

/* ------------------------------------------------------------------ shared */

/** A card you tick: the whole card is the checkbox (big touch target), labelled for screen readers. */
function SelectCard(props: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string; children: React.ReactNode }) {
  const { theme } = useWallet();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.checked }}
      onPress={() => props.onChange(!props.checked)}
      testID={props.testID}
    >
      <Card style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, gap: 8 }}>{props.children}</View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            borderWidth: 2,
            borderColor: props.checked ? theme.c.accent : theme.c.border,
            backgroundColor: props.checked ? theme.c.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {props.checked ? <IconCheck color={theme.c.accentText} size={14} /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function useToggleSet(): [Set<string>, (id: string, on: boolean) => void, (s: Set<string>) => void] {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  return [picked, toggle, setPicked];
}

/* ------------------------------------------------------------------ menu */

const MENU: readonly { route: "security-permissions" | "security-cleanup" | "security-protection"; title: MobileMessageId; hint: MobileMessageId }[] = [
  { route: "security-permissions", title: "m.security.menu.permissions", hint: "m.security.menu.permissionsHint" },
  { route: "security-cleanup", title: "m.security.menu.cleanup", hint: "m.security.menu.cleanupHint" },
  { route: "security-protection", title: "m.security.menu.protection", hint: "m.security.menu.protectionHint" },
];

/** Settings → Security. */
export function SecurityHome() {
  const { navigate } = useWallet();
  const t = useMobileT();
  return (
    <Screen back title={t("m.security.title")}>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        {MENU.map((m) => (
          <MenuItem key={m.route} testID={`menu-${m.route}`} title={t(m.title)} hint={t(m.hint, { name: APP.config.name })} onPress={() => navigate({ name: m.route })} />
        ))}
      </Card>
    </Screen>
  );
}

/* ------------------------------------------------------------------ permissions */

const RISK_TONE = { danger: "accent", caution: "neutral", info: "muted" } as const;
const LEVEL_TEXT = { high: "m.security.level.high", medium: "m.security.level.medium", low: "m.security.level.low" } as const satisfies Record<string, MobileMessageId>;

/** Every standing permission across your accounts; remove the chosen ones, each confirmed on the approval sheet. */
export function Permissions() {
  const { wallet, state, showApproval } = useWallet();
  const t = useMobileT();
  const advanced = !!state?.prefs.advanced;
  const { data, error, reload, loading } = useAsync(() => wallet.security.approvalsScan(), [wallet]);
  const [picked, toggle, setPicked] = useToggleSet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Risky ones are ticked for you; anything that looks fine isn't.
  useEffect(() => {
    if (data) setPicked(new Set(data.grants.filter((g) => g.riskLevel !== "low").map((g) => g.id)));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function revoke() {
    setErr(null);
    setBusy(true);
    try {
      const r = await wallet.security.revoke({ ids: [...picked] });
      if (r.queued) showApproval(r.queued.approvalId);
      else reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      back
      title={t("m.security.menu.permissions")}
      footer={
        data && data.grants.length > 0 ? (
          <Button block variant="danger" testID="revoke" disabled={busy || picked.size === 0} onPress={() => void revoke()}>
            {picked.size === 0 ? t("m.security.perm.pick") : t("m.security.perm.remove", { count: picked.size })}
          </Button>
        ) : undefined
      }
    >
      <T v="lede">{t("m.security.perm.lede")}</T>
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {loading && !data && <Spinner />}
      {data?.partial.map((p) => (
        <Notice key={p.code + p.message} level="info">
          {partialText(p, t)}
        </Notice>
      ))}
      {data && data.grants.length === 0 && <Empty title={t("m.security.perm.none")}>{t("m.security.perm.noneHint")}</Empty>}
      <View accessibilityLabel={t("m.security.perm.list")} style={{ gap: 10 }}>
        {data?.grants.map((g: GrantView) => (
          <SelectCard key={g.id} testID="grant" checked={picked.has(g.id)} onChange={(v) => toggle(g.id, v)} label={t("m.security.perm.removeOne", { title: grantTitle(g, t) })}>
            <T style={{ fontWeight: "600" }}>{grantTitle(g, t)}</T>
            <T v="hint">{g.grantedAt ? t("m.security.perm.spenderSet", { spender: g.spender.name ?? g.spender.address, when: relativeTime(g.grantedAt) }) : (g.spender.name ?? g.spender.address)}</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Chip tone={g.riskLevel === "high" ? "accent" : "muted"}>{t(LEVEL_TEXT[g.riskLevel])}</Chip>
              {g.risks.map((r) => (
                <Chip key={r.code} tone={RISK_TONE[r.level]} testID={`risk-${r.code}`}>
                  {riskText(r, g, t)}
                </Chip>
              ))}
              {advanced && <Chip tone="muted">{g.networkId}</Chip>}
            </View>
          </SelectCard>
        ))}
      </View>
      {data?.notes.map((n, i) => (
        <T key={n} v="hint">
          {noteText(data.noteCodes?.[i], n, t)}
        </T>
      ))}
    </Screen>
  );
}

/* ------------------------------------------------------------------ cleanup */

const ACTION_TEXT: Record<CleanupItemView["action"], MobileMessageId> = {
  close: "m.security.action.close",
  "burn-close": "m.security.action.burnClose",
  dissociate: "m.security.action.dissociate",
  hide: "m.security.action.hide",
};

/** Spam and empty accounts, with a clear summary of what one tap does. */
export function Cleanup() {
  const { wallet, showApproval } = useWallet();
  const t = useMobileT();
  const { data, error, reload, loading } = useAsync(() => wallet.security.cleanupScan(), [wallet]);
  const [picked, toggle, setPicked] = useToggleSet();
  const [summary, setSummary] = useState<CleanupSummaryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (data) setPicked(new Set(data.items.filter((i) => i.preselected).map((i) => i.id)));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const ids = useMemo(() => [...picked], [picked]);
  useEffect(() => {
    let live = true;
    if (!ids.length) {
      setSummary(null);
      return;
    }
    wallet.security
      .cleanupPreview({ ids })
      .then((s) => live && setSummary(s))
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
  }, [wallet, ids]);

  async function run() {
    setErr(null);
    setBusy(true);
    try {
      const r = await wallet.security.cleanupRun({ ids });
      if (r.queued) showApproval(r.queued.approvalId);
      else {
        setDone(t("m.security.clean.hid", { count: r.hidden }));
        reload();
      }
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const lines = summary ? cleanupLines(summary, t) : null;
  return (
    <Screen
      back
      title={t("m.security.menu.cleanup")}
      footer={
        data && data.items.length > 0 ? (
          <Button block testID="cleanup-run" disabled={busy || ids.length === 0} onPress={() => void run()}>
            {lines ? lines.headline : t("m.security.clean.pick")}
          </Button>
        ) : undefined
      }
    >
      <ErrorNote message={err ?? (error ? userMessageOf(error) : null)} />
      {done && <Notice level="info">{done}</Notice>}
      {loading && !data && <Spinner />}
      {data?.partial.map((p) => (
        <Notice key={p.code + p.message} level="info">
          {partialText(p, t)}
        </Notice>
      ))}
      {data && data.items.length === 0 && <Empty title={t("m.security.clean.none")}>{t("m.security.clean.noneHint")}</Empty>}
      {summary && lines && (
        <Card>
          <View accessibilityLabel={t("m.security.clean.summary")} testID="cleanup-summary" style={{ gap: 6 }}>
            <T style={{ fontWeight: "700", fontSize: 17 }}>{lines.headline}</T>
            {lines.lines.map((l) => (
              <T key={l} v="lede">{`• ${l}`}</T>
            ))}
            {summary.approvals > 0 && <T v="hint">{t("m.security.clean.confirmations", { count: summary.approvals })}</T>}
          </View>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Button variant="ghost" onPress={() => setPicked(new Set(data.items.map((i) => i.id)))}>
            {t("m.security.clean.selectAll")}
          </Button>
          <Button variant="ghost" onPress={() => setPicked(new Set())}>
            {t("m.security.clean.selectNone")}
          </Button>
        </View>
      )}
      <View accessibilityLabel={t("m.security.clean.items")} style={{ gap: 10 }}>
        {data?.items.map((i) => (
          <SelectCard
            key={i.id}
            testID="cleanup-item"
            checked={picked.has(i.id)}
            onChange={(v) => toggle(i.id, v)}
            label={t("m.security.clean.itemLabel", { action: t(ACTION_TEXT[i.action]), symbol: i.symbol })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T style={{ fontWeight: "600" }}>{i.symbol}</T>
              <Chip tone={i.spam ? "accent" : "muted"}>{i.spam ? t("m.security.clean.spam") : i.action === "close" ? t("m.security.clean.empty") : t("m.security.clean.unused")}</Chip>
            </View>
            <T v="hint">{t("m.security.clean.itemLine", { action: t(ACTION_TEXT[i.action]), reason: cleanupReason(i, t) })}</T>
          </SelectCard>
        ))}
      </View>
      {data?.notes.map((n, i) => (
        <T key={n} v="hint">
          {noteText(data.noteCodes?.[i], n, t)}
        </T>
      ))}
    </Screen>
  );
}

/* ------------------------------------------------------------------ scam protection */

/** What the wallet checks, and exactly what each source sees. */
export function Protection() {
  const { wallet } = useWallet();
  const t = useMobileT();
  const f = useFormat();
  const { data, error, reload } = useAsync(() => wallet.security.threatStatus(), [wallet]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    try {
      await wallet.security.threatRefresh();
    } catch {
      /* the list below shows each source's own state */
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <Screen back title={t("m.security.menu.protection")}>
      <T v="lede">{t("m.security.protect.lede", { name: APP.config.name })}</T>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {!data && !error && <Spinner />}
      <View accessibilityLabel={t("m.security.protect.sources")} style={{ gap: 10 }}>
        {data?.map((p) => (
          <Card key={p.id}>
            <View testID={`threat-source-${p.id}`} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <T style={{ fontWeight: "600", flexShrink: 1 }}>{sourceName(p, t)}</T>
                <Chip tone={p.enabled ? "accent" : "muted"}>{p.enabled ? t("m.security.protect.on") : t("m.security.protect.off")}</Chip>
              </View>
              <T v="hint">{privacyText(p, t)}</T>
              {p.updatedAt ? (
                <T v="hint">
                  {p.entries
                    ? t("m.security.protect.updatedEntries", { when: relativeTime(p.updatedAt), entries: f.number(p.entries), count: p.entries })
                    : t("m.security.protect.updated", { when: relativeTime(p.updatedAt) })}
                </T>
              ) : null}
              {p.unavailable && <T v="hint">{sourceUnavailable(p.unavailable, t)}</T>}
            </View>
          </Card>
        ))}
      </View>
      <Button variant="secondary" block testID="threat-refresh" disabled={busy} onPress={() => void refresh()}>
        {t("m.security.protect.refresh")}
      </Button>
    </Screen>
  );
}
