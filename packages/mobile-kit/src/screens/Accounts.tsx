/**
 * Settings → Accounts: the extension's Accounts (packages/ui/src/screens/Accounts.tsx) in React Native.
 * Several accounts per kind (all from the same recovery phrase), a name for each, and which one each app sees
 * (`origin` set: choose for that one app, from Settings → Connected apps). Addresses are shown short; the
 * network stays invisible.
 */
import { useState } from "react";
import { View } from "react-native";
import type { Family } from "@clip-wallet/core";
import { asPlatform, userMessageOf, type AccountView, type ActiveAccounts } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Chip, ErrorNote, Field, Screen, Spinner, T } from "../ui/kit";
import { useMobileT } from "../i18n";
import { familyLabel } from "../lib/family-label";

function short(a: string): string {
  return a.length > 16 ? `${a.slice(0, a.startsWith("0x") ? 6 : 4)}…${a.slice(-4)}` : a;
}

function AccountRow(props: { account: AccountView; active: boolean; onRename: (label: string) => Promise<void>; onUse: () => Promise<void> }) {
  const t = useMobileT();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(props.account.label);
  const a = props.account;
  if (editing) {
    return (
      <View style={{ gap: 8 }} testID={`account-${a.id}`}>
        <Field label={t("m.accounts.nameFor", { account: a.label })} value={label} maxLength={32} autoFocus testID={`rename-${a.id}`} onChangeText={setLabel} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button variant="secondary" onPress={() => (setLabel(a.label), setEditing(false))}>
            {t("m.common.cancel")}
          </Button>
          <Button disabled={!label.trim()} testID={`save-${a.id}`} onPress={async () => (await props.onRename(label.trim().slice(0, 32)), setEditing(false))}>
            {t("m.accounts.save")}
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
          {props.active && <Chip tone="accent">{t("m.accounts.inUse")}</Chip>}
        </View>
        <T v="mono">{short(a.displayAddress ?? a.address)}</T>
      </View>
      <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 8 }} accessibilityLabel={t("m.accounts.renameAccount", { account: a.label })} onPress={() => setEditing(true)}>
        {t("m.accounts.rename")}
      </Button>
      {!props.active && (
        <Button variant="secondary" style={{ flex: 0, paddingHorizontal: 12 }} accessibilityLabel={t("m.accounts.useAccount", { account: a.label })} testID={`use-${a.id}`} onPress={() => void props.onUse()}>
          {t("m.accounts.use")}
        </Button>
      )}
    </View>
  );
}

export function Accounts(props: { origin?: string }) {
  const { client } = useWallet();
  const t = useMobileT();
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

  if (data.loading && !data.data) return <Screen back title={t("m.accounts.title")}><Spinner /></Screen>;
  if (!data.data) return <Screen back title={t("m.accounts.title")}><ErrorNote message={userMessageOf(data.error)} /></Screen>;
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
    <Screen back title={host ? t("m.accounts.titleFor", { site: host }) : t("m.accounts.title")}>
      {host && <T v="lede">{t("m.accounts.forSiteLede", { site: host })}</T>}
      <ErrorNote message={err} />
      {[...byFamily.entries()].map(([family, list]) => (
        <Card key={family}>
          <T v="h2">{familyLabel(family, t)}</T>
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
              {adding === family ? t("m.accounts.adding") : t("m.accounts.add")}
            </Button>
          )}
          {host && active.forOrigin?.[family] && (
            <Button variant="ghost" block onPress={() => act(() => p.setActiveAccount({ family, accountId: null, origin: props.origin! }))}>
              {t("m.accounts.useDefault")}
            </Button>
          )}
        </Card>
      ))}
    </Screen>
  );
}
