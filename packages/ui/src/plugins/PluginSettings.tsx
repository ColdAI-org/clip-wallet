import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Button, Card, Empty, ErrorNote, Field, Screen, Spinner, Toggle } from "../components";
import { asPlugins, type PendingPluginView, type PluginView, type PluginsClient } from "./client";
import { useUiT } from "../i18n";

/** Settings → Advanced → Plugins. Off by default; install needs an explicit yes after the permission prompt. */
export function PluginSettings() {
  const { client } = useUi();
  const t = useUiT();
  const plugins = asPlugins(client);
  if (!plugins) {
    return (
      <Screen title={t("plugins.title")} back>
        <Empty title={t("plugins.unavailable")} />
      </Screen>
    );
  }
  return <PluginSettingsInner plugins={plugins} />;
}

/** What a plugin may do, in the user's language (falls back to the background's English lines). */
function Permissions(props: { plugin: PluginView }) {
  const t = useUiT();
  const c = props.plugin.capabilities;
  const name = props.plugin.name;
  const lines = c
    ? [
        ...(c.transactionInsight ? [t("plugins.perm.insight", { plugin: name })] : []),
        ...(c.nameSuffixes ? [t("plugins.perm.names", { suffixes: c.nameSuffixes.join(", "), plugin: name })] : []),
        ...(c.notifications ? [t("plugins.perm.notifications")] : []),
        ...(c.networkHosts ? [t(c.transactionInsight || c.nameSuffixes ? "plugins.perm.networkSees" : "plugins.perm.network", { hosts: c.networkHosts.join(", ") })] : []),
        t("plugins.perm.never"),
      ]
    : props.plugin.permissions;
  return (
    <ul className="clip-bullets">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function PluginSettingsInner({ plugins }: { plugins: PluginsClient }) {
  const t = useUiT();
  const { config } = useUi();
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
      <Screen title={t("plugins.title")} back>
        {status.error ? <ErrorNote message={userMessageOf(status.error)} /> : <Spinner />}
      </Screen>
    );
  }
  if (!st.advanced) {
    return (
      <Screen title={t("plugins.title")} back>
        <Empty title={t("plugins.advancedOnly")}>{t("plugins.advancedOnlyHint")}</Empty>
      </Screen>
    );
  }

  return (
    <Screen title={t("plugins.title")} back>
      <p className="clip-lede">{t("plugins.lede")}</p>
      <ul className="clip-bullets">
        <li>{t("plugins.rule.never")}</li>
        <li>{t("plugins.rule.marked", { name: config.name })}</li>
        <li>{t("plugins.rule.trust")}</li>
      </ul>
      <Toggle label={t("plugins.use")} description={t("plugins.useHint")} checked={st.enabled} disabled={busy} onChange={(v) => void run(() => plugins.pluginsSetEnabled({ enabled: v }))} />

      {st.enabled && !pending && (
        <div className="clip-stack">
          <Field label={t("plugins.package")} autoComplete="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} hint={t("plugins.packageHint", { example: "clip-plugin-address-label" })} />
          <Button
            block
            variant="secondary"
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                setPending(await plugins.pluginsPrepareInstall({ name: name.trim() }));
              })
            }
          >
            {busy ? t("plugins.checking") : t("plugins.lookUp")}
          </Button>
        </div>
      )}

      {pending && (
        <Card>
          <div data-testid="plugin-permission-prompt" className="clip-stack">
            <h2 className="clip-h2">{t("plugins.install.title", { plugin: pending.name, version: pending.version })}</h2>
            <p className="clip-hint">{t("plugins.install.by", { author: pending.author, id: pending.id })}</p>
            <p>{pending.description}</p>
            <p>
              <strong>{t("plugins.install.able")}</strong>
            </p>
            <Permissions plugin={pending} />
            <Button
              block
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await plugins.pluginsConfirmInstall({ id: pending.id, version: pending.version });
                  setPending(null);
                  setName("");
                })
              }
            >
              {t("plugins.install.confirm")}
            </Button>
            <Button
              block
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await plugins.pluginsCancelInstall();
                  setPending(null);
                })
              }
            >
              {t("common.cancel")}
            </Button>
          </div>
        </Card>
      )}

      <ErrorNote message={err} />

      <h2 className="clip-h2">{t("plugins.installed")}</h2>
      {st.plugins.length === 0 && <p className="clip-hint">{t("plugins.none")}</p>}
      {st.plugins.map((p) => (
        <Card key={p.id}>
          <Toggle
            label={t("plugins.item.label", { plugin: p.name, version: p.version })}
            description={t("plugins.item.description", { author: p.author, description: p.description })}
            checked={p.enabled}
            disabled={busy || !st.enabled}
            onChange={(v) => void run(() => plugins.pluginsSetPluginEnabled({ id: p.id, enabled: v }))}
          />
          <Permissions plugin={p} />
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => plugins.pluginsRemove({ id: p.id }))}>
            {t("plugins.remove", { plugin: p.name })}
          </Button>
        </Card>
      ))}
    </Screen>
  );
}
