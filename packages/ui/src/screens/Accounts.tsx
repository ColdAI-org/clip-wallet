import { useState } from "react";
import type { Family } from "@clip-wallet/core";
import { userMessageOf } from "../client";
import { useAsync, useUi } from "../context";
import { Button, Card, ErrorNote, Field, Screen, Spinner } from "../components";
import { FAMILY_LABEL, asPlatform, type AccountView, type ActiveAccounts } from "../platform/client";

/**
 * Settings → Accounts. Several accounts per kind (all from the same recovery phrase), a name for each, and
 * which one each app sees. Addresses are shown short; the network stays invisible.
 */

function short(a: string): string {
  return a.length > 16 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

function AccountRow(props: { account: AccountView; active: boolean; onRename: (label: string) => Promise<void>; onUse: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.account.label);
  const a = props.account;
  return (
    <li className="clip-asset-row" data-testid={`account-${a.id}`}>
      <div className="clip-asset-row__main">
        {editing ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await props.onRename(label.trim().slice(0, 32));
              setEditing(false);
            }}
          >
            <Field label={`Name for ${a.label}`} value={label} maxLength={32} autoFocus onChange={(e) => setLabel(e.target.value)} />
            <Button type="submit" disabled={!label.trim()}>
              Save
            </Button>
          </form>
        ) : (
          <>
            <span className="clip-asset-row__name">
              {a.label} {props.active && <span className="clip-chip clip-chip--accent">In use</span>}
            </span>
            <span className="clip-asset-row__symbol clip-mono" title={a.displayAddress ?? a.address}>
              {short(a.displayAddress ?? a.address)}
            </span>
          </>
        )}
      </div>
      {!editing && (
        <div className="clip-header__actions">
          <Button variant="ghost" onClick={() => setEditing(true)} aria-label={`Rename ${a.label}`}>
            Rename
          </Button>
          {!props.active && (
            <Button variant="secondary" onClick={() => void props.onUse()} aria-label={`Use ${a.label}`}>
              Use
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * `origin` set: choose which account that one app sees (per kind). Otherwise: the wallet-wide default.
 */
export function Accounts(props: { origin?: string }) {
  const { client } = useUi();
  const p = asPlatform(client);
  const data = useAsync(async () => {
    const [accounts, active] = await Promise.all([p.listAccounts(), p.getActiveAccounts(props.origin ? { origin: props.origin } : {})]);
    return { accounts, active };
  }, [props.origin]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Family | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      data.reload();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };

  if (data.loading && !data.data) return <Screen title="Accounts" back><Spinner /></Screen>;
  if (!data.data) return <Screen title="Accounts" back><ErrorNote message={userMessageOf(data.error)} /></Screen>;
  const { accounts, active } = data.data;
  const byFamily = new Map<Family, AccountView[]>();
  for (const a of accounts) byFamily.set(a.family, [...(byFamily.get(a.family) ?? []), a]);
  const activeId = (f: Family, a: ActiveAccounts) => a.forOrigin?.[f] ?? a.defaults[f] ?? byFamily.get(f)?.[0]?.id;
  const host = props.origin ? (() => { try { return new URL(props.origin).hostname; } catch { return props.origin; } })() : null;

  return (
    <Screen title={host ? `Accounts for ${host}` : "Accounts"} back>
      <div className="clip-stack">
        {host && <p className="clip-lede">Choose which account {host} sees. Other apps keep their own choice.</p>}
        <ErrorNote message={err} />
        {[...byFamily.entries()].map(([family, list]) => (
          <Card key={family}>
            <h2 className="clip-h2">{FAMILY_LABEL[family] ?? family}</h2>
            <ul className="clip-list" aria-label={FAMILY_LABEL[family] ?? family}>
              {list.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  active={activeId(family, active) === a.id}
                  onRename={(label) => act(() => p.renameAccount({ id: a.id, label }))}
                  onUse={() => act(() => p.setActiveAccount({ family, accountId: a.id, ...(props.origin ? { origin: props.origin } : {}) }))}
                />
              ))}
            </ul>
            {!host && (
              <Button
                variant="secondary"
                disabled={adding === family}
                onClick={() =>
                  act(async () => {
                    setAdding(family);
                    try {
                      await p.addAccount({ family });
                    } finally {
                      setAdding(null);
                    }
                  })
                }
              >
                {adding === family ? "Adding…" : "Add account"}
              </Button>
            )}
            {host && active.forOrigin?.[family] && (
              <Button variant="ghost" onClick={() => act(() => p.setActiveAccount({ family, accountId: null, origin: props.origin! }))}>
                Use my default account here
              </Button>
            )}
          </Card>
        ))}
      </div>
    </Screen>
  );
}
