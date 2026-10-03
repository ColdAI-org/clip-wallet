import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Button, Card, Empty, ErrorNote, Field, Screen, Spinner, Toggle } from "../components";
import { asPlugins, type PendingPluginView, type PluginsClient } from "./client";

/** Settings → Advanced → Plugins. Off by default; install needs an explicit yes after the permission prompt. */
export function PluginSettings() {
  const { client } = useUi();
  const plugins = asPlugins(client);
  if (!plugins) {
    return (
      <Screen title="Plugins" back>
        <Empty title="Plugins aren't available in this version" />
      </Screen>
    );
  }
  return <PluginSettingsInner plugins={plugins} />;
}

function PluginSettingsInner({ plugins }: { plugins: PluginsClient }) {
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
      <Screen title="Plugins" back>
        {status.error ? <ErrorNote message={userMessageOf(status.error)} /> : <Spinner />}
      </Screen>
    );
  }
  if (!st.advanced) {
    return (
      <Screen title="Plugins" back>
        <Empty title="Plugins are an Advanced feature">Turn on Advanced mode in Settings to use them.</Empty>
      </Screen>
    );
  }

  return (
    <Screen title="Plugins" back>
      <p className="clip-lede">Plugins add notes to requests you approve, look up names, or send you a notification.</p>
      <ul className="clip-bullets">
        <li>A plugin can never sign, move your funds, or see your recovery phrase or keys.</li>
        <li>What a plugin says is always marked with its name. Clip Wallet doesn't check it.</li>
        <li>Only install plugins from people you trust.</li>
      </ul>
      <Toggle label="Use plugins" description="Off stops every plugin." checked={st.enabled} disabled={busy} onChange={(v) => void run(() => plugins.pluginsSetEnabled({ enabled: v }))} />

      {st.enabled && !pending && (
        <div className="clip-stack">
          <Field label="npm package name" autoComplete="off" spellCheck={false} value={name} onChange={(e) => setName(e.target.value)} hint="For example clip-plugin-address-label" />
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
            {busy ? "Checking…" : "Look up plugin"}
          </Button>
        </div>
      )}

      {pending && (
        <Card>
          <div data-testid="plugin-permission-prompt" className="clip-stack">
            <h2 className="clip-h2">
              Install {pending.name} {pending.version}?
            </h2>
            <p className="clip-hint">
              By {pending.author} · npm package {pending.id}
            </p>
            <p>{pending.description}</p>
            <p>
              <strong>It will be able to:</strong>
            </p>
            <ul className="clip-bullets">
              {pending.permissions.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
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
              Install
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
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <ErrorNote message={err} />

      <h2 className="clip-h2">Installed</h2>
      {st.plugins.length === 0 && <p className="clip-hint">No plugins yet.</p>}
      {st.plugins.map((p) => (
        <Card key={p.id}>
          <Toggle
            label={`${p.name} ${p.version}`}
            description={`By ${p.author}. ${p.description}`}
            checked={p.enabled}
            disabled={busy || !st.enabled}
            onChange={(v) => void run(() => plugins.pluginsSetPluginEnabled({ id: p.id, enabled: v }))}
          />
          <ul className="clip-bullets">
            {p.permissions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <Button variant="ghost" disabled={busy} onClick={() => void run(() => plugins.pluginsRemove({ id: p.id }))}>
            Remove {p.name}
          </Button>
        </Card>
      ))}
    </Screen>
  );
}
