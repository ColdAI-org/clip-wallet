/**
 * Settings → Accounts: the extension's Accounts (packages/ui/src/screens/Accounts.tsx) in React Native.
 * Several accounts per kind (all from the same recovery phrase), a name for each, and which one each app sees
 * (`origin` set: choose for that one app, from Settings → Connected apps). Addresses are shown short; the
 * network stays invisible.
 */
import { useState } from "react";
import { View } from "react-native";
import type { Family } from "@clip-wallet/core";
import { FAMILY_LABEL, asPlatform, userMessageOf, type AccountView, type ActiveAccounts } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, ErrorNote, Field, Screen, Spinner, T } from "../ui/kit";

function short(a: string): string {
  return a.length > 16 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

function AccountRow(props: { account: AccountView; active: boolean; onRename: (label: string) => Promise<void>; onUse: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.account.label);
  const a = props.account;
  if (editing) {
    return (
      <View style={{ gap: 8 }} testID={`account-${a.id}`}>
        <Field label={`Name for ${a.label}`} value={label} maxLength={32} autoFocus testID={`rename-${a.id}`} onChangeText={setLabel} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button variant="secondary" onPress={() => (setLabel(a.label), setEditing(false))}>
            Cancel
          </Button>
          <Button disabled={!label.trim()} testID={`save-${a.id}`} onPress={async () => (await props.onRename(label.trim().slice(0, 32)), setEditing(false))}>
            Save
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View testID={`account-${a.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <T style={{ fontWeight: "600" }}>{a.label}</T>
          {props.active && <Chip tone="accent">In use</Chip>}
        </View>
        <T v="mono">{short(a.displayAddress ?? a.address)}</T>
      </View>
      <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 8 }} accessibilityLabel={`Rename ${a.label}`} onPress={() => setEditing(true)}>
        Rename
      </Button>
      {!props.active && (
        <Button variant="secondary" style={{ flex: 0, paddingHorizontal: 12 }} accessibilityLabel={`Use ${a.label}`} testID={`use-${a.id}`} onPress={() => void props.onUse()}>
          Use
        </Button>
      )}
    </View>
  );
}

export function Accounts(props: { origin?: string }) {
  const { client } = useWallet();
  const p = asPlatform(client);
  const data = useAsync(async () => {
    const [accounts, active] = await Promise.all([p.listAccounts(), p.getActiveAccounts(props.origin ? { origin: props.origin } : {})]);
    return { accounts, active };
  }, [client, props.origin]);
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

  if (data.loading && !data.data) return <Screen back title="Accounts"><Spinner /></Screen>;
  if (!data.data) return <Screen back title="Accounts"><ErrorNote message={userMessageOf(data.error)} /></Screen>;
  const { accounts, active } = data.data;
  const byFamily = new Map<Family, AccountView[]>();
  for (const a of accounts) byFamily.set(a.family, [...(byFamily.get(a.family) ?? []), a]);
  const activeId = (f: Family, x: ActiveAccounts) => x.forOrigin?.[f] ?? x.defaults[f] ?? byFamily.get(f)?.[0]?.id;
  const host = props.origin
    ? (() => {
        try {
          return new URL(props.origin).hostname;
        } catch {
          return props.origin;
        }
      })()
    : null;

  return (
    <Screen back title={host ? `Accounts for ${host}` : "Accounts"}>
      {host && <T v="lede">{`Choose which account ${host} sees. Other apps keep their own choice.`}</T>}
      <ErrorNote message={err} />
      {[...byFamily.entries()].map(([family, list]) => (
        <Card key={family}>
          <T v="h2">{FAMILY_LABEL[family] ?? family}</T>
          <View style={{ gap: 0 }}>
            {list.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                active={activeId(family, active) === a.id}
                onRename={(label) => act(() => p.renameAccount({ id: a.id, label }))}
                onUse={() => act(() => p.setActiveAccount({ family, accountId: a.id, ...(props.origin ? { origin: props.origin } : {}) }))}
              />
            ))}
          </View>
          {!host && (
            <Button
              variant="secondary"
              block
              testID={`add-${family}`}
              disabled={adding === family}
              onPress={() =>
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
            <Button variant="ghost" block onPress={() => act(() => p.setActiveAccount({ family, accountId: null, origin: props.origin! }))}>
              Use my default account here
            </Button>
          )}
        </Card>
      ))}
    </Screen>
  );
}
