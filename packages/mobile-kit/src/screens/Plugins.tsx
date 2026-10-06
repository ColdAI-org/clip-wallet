/**
 * Clip Plugins on the phone, the same flow and copy as the extension (packages/ui/src/plugins):
 *  - Settings → Advanced → Plugins: the Plugins switch (off by default, Advanced mode only), install from npm
 *    (the wallet downloads and checks npm's integrity, the manifest and the bundle hash, then shows what the plugin
 *    will be able to do; nothing is stored until "Install"), and the installed list.
 *  - PluginInsights: each plugin's notes on an approval in its own "From <plugin>" card, below the wallet's own
 *    lines and warnings, marked as not checked by the wallet. Plugins can add, never remove or edit.
 * Plugins run in hidden, network-less WebView sandboxes (src/plugins); nothing here talks to them directly.
 */
import { useState } from "react";
import { View } from "react-native";
import { userMessageOf, type PendingPluginView, type PluginInsightView, type PluginView, type PluginsClient } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, Empty, ErrorNote, Field, Notice, Screen, Spinner, T, Toggle } from "../ui/kit";
import { APP } from "../env";
import { useMobileT } from "../i18n";

/** What a plugin may do, in the user's language (falls back to the wallet's English lines). */
function PermissionList(props: { plugin: PluginView }) {
  const t = useMobileT();
  const c = props.plugin.capabilities;
  const name = props.plugin.name;
  const lines = c
    ? [
        ...(c.transactionInsight ? [t("m.plugins.perm.insight", { plugin: name })] : []),
        ...(c.nameSuffixes ? [t("m.plugins.perm.names", { suffixes: c.nameSuffixes.join(", "), plugin: name })] : []),
        ...(c.notifications ? [t("m.plugins.perm.notifications")] : []),
        ...(c.networkHosts ? [t(c.transactionInsight || c.nameSuffixes ? "m.plugins.perm.networkSees" : "m.plugins.perm.network", { hosts: c.networkHosts.join(", ") })] : []),
        t("m.plugins.perm.never"),
      ]
    : props.plugin.permissions;
  return (
    <View style={{ gap: 4 }} testID="plugin-permissions">
      {lines.map((l) => (
        <T key={l} v="lede">{`• ${l}`}</T>
      ))}
    </View>
  );
}

/** Settings → Advanced → Plugins. */
export function PluginSettings() {
  const { wallet } = useWallet();
  const t = useMobileT();
  if (!wallet.plugins) {
    return (
      <Screen back title={t("m.plugins.title")}>
        <Empty title={t("m.plugins.unavailable")} />
      </Screen>
    );
  }
  return <PluginSettingsInner plugins={wallet.plugins} />;
}

function PluginSettingsInner({ plugins }: { plugins: PluginsClient }) {
  const t = useMobileT();
  const status = useAsync(() => plugins.pluginsStatus(), [plugins]);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<PendingPluginView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      status.reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const st = status.data;
  if (!st) {
    return (
      <Screen back title={t("m.plugins.title")}>
        {status.error ? <ErrorNote message={userMessageOf(status.error)} /> : <Spinner />}
      </Screen>
    );
  }
  if (!st.advanced) {
    return (
      <Screen back title={t("m.plugins.title")}>
        <Empty title={t("m.plugins.advancedOnly")}>{t("m.plugins.advancedOnlyHint")}</Empty>
      </Screen>
    );
  }

  return (
    <Screen back title={t("m.plugins.title")}>
      <T v="lede">{t("m.plugins.lede")}</T>
      <View style={{ gap: 4 }}>
        <T v="lede">{`• ${t("m.plugins.rule.never")}`}</T>
        <T v="lede">{`• ${t("m.plugins.rule.marked", { name: APP.config.name })}`}</T>
        <T v="lede">{`• ${t("m.plugins.rule.trust")}`}</T>
      </View>
      <T v="hint">{t("m.plugins.sandbox", { name: APP.config.name })}</T>
      <Card>
        <Toggle testID="plugins-switch" label={t("m.plugins.use")} description={t("m.plugins.useHint")} checked={st.enabled} disabled={busy} onChange={(v) => void run(() => plugins.pluginsSetEnabled({ enabled: v }))} />
      </Card>

      {st.enabled && !pending && (
        <View style={{ gap: 10 }}>
          <Field
            testID="plugin-package"
            label={t("m.plugins.package")}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChangeText={setName}
            hint={t("m.plugins.packageHint", { example: "clip-plugin-address-label" })}
          />
          <Button
            block
            variant="secondary"
            testID="plugin-lookup"
            disabled={busy || !name.trim()}
            onPress={() =>
              void run(async () => {
                setPending(await plugins.pluginsPrepareInstall({ name: name.trim() }));
              })
            }
          >
            {busy ? t("m.plugins.checking") : t("m.plugins.lookUp")}
          </Button>
        </View>
      )}

      {pending && (
        <Card>
          <View testID="plugin-permission-prompt" style={{ gap: 10 }}>
            <T v="h1">{t("m.plugins.install.title", { plugin: pending.name, version: pending.version })}</T>
            <T v="hint">{t("m.plugins.install.by", { author: pending.author, id: pending.id })}</T>
            <T>{pending.description}</T>
            <T style={{ fontWeight: "600" }}>{t("m.plugins.install.able")}</T>
            <PermissionList plugin={pending} />
            <Button
              block
              testID="plugin-install"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await plugins.pluginsConfirmInstall({ id: pending.id, version: pending.version });
                  setPending(null);
                  setName("");
                })
              }
            >
              {t("m.plugins.install.confirm")}
            </Button>
            <Button
              block
              variant="ghost"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await plugins.pluginsCancelInstall();
                  setPending(null);
                })
              }
            >
              {t("m.common.cancel")}
            </Button>
          </View>
        </Card>
      )}

      <ErrorNote message={err} />

      <T v="h2">{t("m.plugins.installed")}</T>
      {st.plugins.length === 0 && <T v="hint">{t("m.plugins.none")}</T>}
      {st.plugins.map((p) => (
        <Card key={p.id}>
          <Toggle
            testID={`plugin-${p.id}`}
            label={t("m.plugins.item.label", { plugin: p.name, version: p.version })}
            description={t("m.plugins.item.description", { author: p.author, description: p.description })}
            checked={p.enabled}
            disabled={busy || !st.enabled}
            onChange={(v) => void run(() => plugins.pluginsSetPluginEnabled({ id: p.id, enabled: v }))}
          />
          <PermissionList plugin={p} />
          <Button variant="ghost" block disabled={busy} onPress={() => void run(() => plugins.pluginsRemove({ id: p.id }))}>
            {t("m.plugins.remove", { plugin: p.name })}
          </Button>
        </Card>
      ))}
    </Screen>
  );
}

/** Plugin notes on an approval: one "From <plugin>" card per plugin, apart from the wallet's own analysis. */
export function PluginInsights(props: { insights?: PluginInsightView[] }) {
  const t = useMobileT();
  const { theme } = useWallet();
  const list = props.insights ?? [];
  if (!list.length) return null;
  return (
    <View accessibilityLabel={t("m.plugins.insights.label")} testID="plugin-insights" style={{ gap: 10 }}>
      {list.map((i) => (
        <Card key={i.pluginId} style={{ borderStyle: "dashed", borderColor: theme.c.border, borderWidth: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <T style={{ fontWeight: "600", flexShrink: 1 }}>{t("m.plugins.insights.from", { plugin: i.pluginName })}</T>
            <Chip tone="muted">{t("m.plugins.insights.chip")}</Chip>
          </View>
          {i.warnings.map((w, k) => (
            <Notice key={`w${k}`} level={w.level}>
              {w.message}
            </Notice>
          ))}
          {i.lines.map((l, k) => (
            <View key={`l${k}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
              <T v="label">{l.label}</T>
              <T style={{ flexShrink: 1, textAlign: "right", fontSize: 15 }}>{l.value}</T>
            </View>
          ))}
          <T v="hint">{t("m.plugins.insights.footer", { plugin: i.pluginName, name: APP.config.name })}</T>
        </Card>
      ))}
    </View>
  );
}
