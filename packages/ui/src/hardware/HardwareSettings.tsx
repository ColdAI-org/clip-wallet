/**
 * Settings → Hardware wallets: connected devices, their accounts, rename, forget, add more.
 */
import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync } from "../context";
import { Button, Card, Chip, Empty, ErrorNote, Field, Screen, Spinner } from "../components";
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
    <Screen back title="Hardware wallets">
      <ErrorNote message={error ? userMessageOf(error) : err} />
      {!data ? (
        <Spinner />
      ) : data.length === 0 ? (
        <Empty title="No hardware wallet yet">Connect a Ledger or Keystone to keep your keys off this computer.</Empty>
      ) : (
        devices(data).map((d) => (
          <Card key={d.key}>
            <h2 className="clip-h">{d.name}</h2>
            <ul className="clip-list" aria-label={`Accounts on ${d.name}`}>
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
                      <Field label="Account name" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
                    </form>
                  ) : (
                    <>
                      <span className="clip-row__label">
                        {a.label ?? `${FAMILY_WORDS[a.family].title} · Account ${a.index + 1}`}
                        {a.hardware.pathStyle !== "standard" && <span className="clip-row__hint"> (Ledger Live)</span>}
                      </span>
                      <span className="clip-row__value">
                        <code className="clip-mono">{a.address ? shortAddress(a.address) : "No account id yet"}</code>
                        {a.active ? (
                          <Chip tone="accent">In use</Chip>
                        ) : (
                          <Button variant="secondary" onClick={() => void run(() => props.hardware.setActive(a.family, a.id))}>
                            Use this account
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditing(a.id);
                            setLabel(a.label ?? "");
                          }}
                        >
                          Rename
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
                if (globalThis.confirm?.(`Remove ${d.name} from Clip Wallet? Your funds stay on the device; you can connect it again any time.`) === false) return;
                void run(async () => {
                  for (const fp of new Set(d.accounts.map((a) => a.hardware.fingerprint))) await props.hardware.forgetDevice(d.kind, fp);
                });
              }}
            >
              Remove {d.name}
            </Button>
          </Card>
        ))
      )}
      <Button block onClick={props.onAdd}>
        Connect a hardware wallet
      </Button>
    </Screen>
  );
}
