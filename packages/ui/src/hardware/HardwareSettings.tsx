/**
 * Settings → Hardware wallets: connected devices, their accounts, rename, forget, add more.
 */
import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
import { useUi } from "../context";
import { useUiT } from "../i18n";
import { FAMILY_WORDS, shortAddress, type HardwareAccountView, type HardwareClient } from "./types";

interface Device {
  key: string;
  kind: "ledger" | "keystone";
  fingerprint: string;
  name: string;
  accounts: HardwareAccountView[];
}

function devices(accounts: HardwareAccountView[]): Device[] {
  const by = new Map<string, Device>();
  for (const a of accounts) {
    // Ledger apps report different ids per app, so group Ledger accounts by device kind + name only.
    const key = a.hardware.kind === "keystone" ? `keystone:${a.hardware.fingerprint}` : `ledger:${a.hardware.deviceName ?? ""}`;
    const d = by.get(key) ?? {
      key,
      kind: a.hardware.kind,
      fingerprint: a.hardware.fingerprint,
      name: a.hardware.deviceName ?? (a.hardware.kind === "ledger" ? "Ledger" : "Keystone"),
      accounts: [],
    };
    d.accounts.push(a);
    by.set(key, d);
  }
  return [...by.values()];
}

export function HardwareSettings(props: { hardware: HardwareClient; onAdd: () => void }) {
  const t = useUiT();
  const { config } = useUi();
  const { data, error, reload } = useAsync(() => props.hardware.listAccounts(), [props.hardware]);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  return (
    <Screen back title={t("hardware.settings.title")}>
      <ErrorNote message={error ? userMessageOf(error) : err} />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Empty title={t("hardware.settings.none.title")}>{t("hardware.settings.none.body")}</Empty>
      ) : (
        devices(data).map((d) => (
          <Card key={d.key}>
            <h2 className="clip-h">{d.name}</h2>
            <ul className="clip-list" aria-label={t("hardware.settings.accountsOn", { device: d.name })}>
              {d.accounts.map((a) => (
                <li key={a.id} className="clip-row">
                  {editing === a.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setEditing(null);
                        void run(() => props.hardware.renameAccount(a.id, label.trim()));
                      }}
                    >
                      <Field label={t("hardware.settings.accountName")} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
                    </form>
                  ) : (
                    <>
                      <span className="clip-row__label">
                        {a.label ?? t("hardware.settings.familyAccount", { family: t(FAMILY_WORDS[a.family].title), n: a.index + 1 })}
                        {a.hardware.pathStyle !== "standard" && <span className="clip-row__hint">{t("hardware.settings.ledgerLive")}</span>}
                      </span>
                      <span className="clip-row__value">
                        <code className="clip-mono">{a.address ? shortAddress(a.address) : t("hardware.settings.noId")}</code>
                        {a.active ? (
                          <Chip tone="accent">{t("hardware.settings.inUse")}</Chip>
                        ) : (
                          <Button variant="secondary" onClick={() => void run(() => props.hardware.setActive(a.family, a.id))}>
                            {t("hardware.settings.use")}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditing(a.id);
                            setLabel(a.label ?? "");
                          }}
                        >
                          {t("hardware.settings.rename")}
                        </Button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <Button
              variant="danger"
              onClick={() => {
                if (globalThis.confirm?.(t("hardware.settings.removeConfirm", { device: d.name, name: config.name })) === false) return;
                void run(async () => {
                  for (const fp of new Set(d.accounts.map((a) => a.hardware.fingerprint))) await props.hardware.forgetDevice(d.kind, fp);
                });
              }}
            >
              {t("hardware.settings.remove", { device: d.name })}
            </Button>
          </Card>
        ))
      )}
      <Button block onClick={props.onAdd}>
        {t("hardware.connect.title")}
      </Button>
    </Screen>
  );
}
