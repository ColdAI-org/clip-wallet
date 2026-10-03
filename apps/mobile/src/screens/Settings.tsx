import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { isWalletConnectUri, relativeTime, userMessageOf, type Prefs } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, MenuItem, Notice, Row, Screen, T, Toggle } from "../ui/kit";
import { APP } from "../env";

const AUTO_LOCK = [1, 5, 15, 30, 60];
const CURRENCIES = ["USD", "EUR", "GBP"];

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <T v="h2">{props.title}</T>
      <Card>{props.children}</Card>
    </View>
  );
}

function Segmented<T extends string | number>(props: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const { theme } = useWallet();
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{props.label}</T>
      <View accessibilityRole="radiogroup" accessibilityLabel={props.label} style={{ flexDirection: "row", backgroundColor: theme.c.surface2, borderRadius: theme.r.md, padding: 3 }}>
        {props.options.map((o) => (
          <Pressable key={String(o.value)} accessibilityRole="radio" accessibilityState={{ checked: o.value === props.value }} onPress={() => props.onChange(o.value)} style={{ flex: 1, paddingVertical: 8, borderRadius: theme.r.sm, alignItems: "center", backgroundColor: o.value === props.value ? theme.c.surface : "transparent" }}>
            <T style={{ fontSize: 13, fontWeight: o.value === props.value ? "600" : "400" }}>{o.label}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Sessions() {
  const { client, state, navigate } = useWallet();
  const { data, reload, error } = useAsync(() => client.listSessions(), [client]);
  return (
    <Section title="Connected apps">
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {data && data.length === 0 && <T v="hint">No apps are connected.</T>}
      {data?.map((s) => (
        <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "600" }}>{s.dapp.name}</T>
            <T v="hint">{`${s.dapp.domain} · ${s.via === "walletconnect" ? "WalletConnect" : "In-app browser"} · ${relativeTime(s.connectedAt)}${state?.prefs.advanced && s.networkIds.length ? ` · ${s.networkIds.join(", ")}` : ""}`}</T>
          </View>
          {s.via !== "walletconnect" && (
            <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 8 }} accessibilityLabel={`Accounts for ${s.dapp.name}`} onPress={() => navigate({ name: "accounts", origin: s.dapp.origin })}>
              Accounts
            </Button>
          )}
          <Button variant="secondary" style={{ flex: 0 }} accessibilityLabel={`Disconnect ${s.dapp.name}`} onPress={async () => (await client.disconnect(s.id), reload())}>
            Disconnect
          </Button>
        </View>
      ))}
    </Section>
  );
}

function WalletConnectPair() {
  const { client, wallet, navigate } = useWallet();
  const [uri, setUri] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = isWalletConnectUri(uri);
  if (!wallet.walletConnectEnabled) {
    return (
      <Section title="Connect with a code">
        <Notice level="info">Connecting with a code (WalletConnect) isn't switched on in this build yet. Apps in the Browse tab still work.</Notice>
      </Section>
    );
  }
  return (
    <Section title="Connect with a code">
      <T v="hint">For apps on another device: scan their WalletConnect QR code, or paste the code (it starts with "wc:").</T>
      <Field label="Connection code" placeholder="wc:…" autoCapitalize="none" autoComplete="off" value={uri} onChangeText={(t) => (setUri(t), setErr(null), setMsg(null))} error={uri && !valid ? "That doesn't look like a WalletConnect code." : null} />
      <ErrorNote message={err} />
      {msg && <Notice level="info">{msg}</Notice>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button variant="secondary" onPress={() => navigate({ name: "scan" })} testID="scan">
          Scan QR code
        </Button>
        <Button
          disabled={!valid}
          onPress={async () => {
            try {
              await client.pairWalletConnect(uri.trim());
              setUri("");
              setMsg("Pairing started. The app will ask you to connect.");
            } catch (e) {
              setErr(userMessageOf(e));
            }
          }}
        >
          Connect
        </Button>
      </View>
    </Section>
  );
}

function Security(props: { onEnrol: () => void }) {
  const { client, wallet, refresh } = useWallet();
  const [bio, setBio] = useState<{ available: boolean; label: string; enrolled: boolean; reason?: string } | null>(null);
  const [pk, setPk] = useState<{ configured: boolean; enrolled: boolean } | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    void wallet.biometrics().then(setBio);
    void wallet.passkeys().then(setPk);
  }, [wallet, n]);
  return (
    <>
      <Row
        label={bio ? `Unlock with ${bio.label}` : "Unlock with biometrics"}
        value={
          bio?.enrolled ? (
            <Button variant="secondary" style={{ flex: 0 }} onPress={async () => (await wallet.removeUnlockMethods(), setN((x) => x + 1), await refresh())}>
              Turn off
            </Button>
          ) : (
            <Button variant="secondary" style={{ flex: 0 }} disabled={!bio?.available} onPress={props.onEnrol}>
              Set up
            </Button>
          )
        }
        hint={bio && !bio.available ? bio.reason : undefined}
      />
      <Row label="Passkey (synced)" value={<T v="hint">{pk?.configured ? (pk.enrolled ? "On" : "Available") : "Not in this build"}</T>} />
      <Button variant="secondary" block onPress={async () => (await client.lock(), await refresh())}>
        Lock now
      </Button>
    </>
  );
}

function EnrolBiometrics(props: { onDone: () => void }) {
  const { wallet } = useWallet();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 10 }}>
      <Field label="Confirm your password" secureTextEntry value={pw} onChangeText={setPw} />
      <ErrorNote message={err} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button variant="secondary" onPress={props.onDone}>
          Cancel
        </Button>
        <Button
          disabled={!pw}
          onPress={async () => {
            try {
              await wallet.enableBiometrics(pw);
              props.onDone();
            } catch (e) {
              setErr(userMessageOf(e));
            }
          }}
        >
          Turn on
        </Button>
      </View>
    </View>
  );
}

function AdvancedNetworks(props: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => Promise<void> }) {
  const { client } = useWallet();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const [draft, setDraft] = useState<Record<string, string>>(props.prefs.rpcOverrides);
  return (
    <Section title="Networks">
      {data?.networks.map((n) => (
        <View key={n.id} style={{ gap: 4 }}>
          <Row label={n.name} value={<T v="mono">{n.id}</T>} hint={n.chainId !== undefined ? `chain id ${n.chainId}` : undefined} />
          <Field
            label={`RPC override for ${n.name}`}
            placeholder={n.rpcUrl ?? "https://"}
            autoCapitalize="none"
            value={draft[n.id] ?? ""}
            onChangeText={(t) => setDraft((d) => ({ ...d, [n.id]: t }))}
            onBlur={() => {
              const v = (draft[n.id] ?? "").trim();
              const next = { ...props.prefs.rpcOverrides };
              if (v && /^https:\/\//.test(v)) next[n.id] = v;
              else delete next[n.id];
              void props.setPrefs({ rpcOverrides: next });
            }}
            error={draft[n.id] && !/^https:\/\//.test(draft[n.id]!) ? "Use an https:// URL." : null}
          />
        </View>
      ))}
    </Section>
  );
}

export function Settings() {
  const { client, state, refresh, wallet, navigate } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  if (!state) return null;
  const prefs = state.prefs;
  const setPrefs = async (p: Partial<Prefs>) => {
    try {
      await client.setPrefs(p);
      await refresh();
    } catch (e) {
      setErr(userMessageOf(e));
    }
  };
  return (
    <Screen nav title="Settings">
      <ErrorNote message={err} />
      <Section title="Display">
        <Segmented label="Currency" value={prefs.displayCurrency} onChange={(v) => setPrefs({ displayCurrency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Segmented
          label="Appearance"
          value={prefs.theme}
          onChange={(v) => setPrefs({ theme: v })}
          options={[
            { value: "system", label: "Match system" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Section>
      <View style={{ gap: 8 }}>
        <T v="h2">More</T>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <MenuItem title="Stake" testID="menu-stake" onPress={() => navigate({ name: "stake" })} />
          <MenuItem title="Swap" testID="menu-swap" onPress={() => navigate({ name: "swap" })} />
          <MenuItem title="Buy" testID="menu-buy" onPress={() => navigate({ name: "buy" })} />
          <MenuItem title="Secure Trade" testID="menu-trade" onPress={() => navigate({ name: "trade" })} />
          <MenuItem title="Explore apps" testID="explore" onPress={() => navigate({ name: "explore" })} />
        </Card>
      </View>
      <View style={{ gap: 8 }}>
        <T v="h2">Backup and accounts</T>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <MenuItem title="Backup" hint="Recovery phrase and passkey backup" testID="menu-backup" onPress={() => navigate({ name: "backup" })} />
          <MenuItem title="Accounts" hint="Add, rename and choose accounts" testID="menu-accounts" onPress={() => navigate({ name: "accounts" })} />
          <MenuItem title="Hardware wallets" hint="Ledger and Keystone" testID="menu-hardware" onPress={() => navigate({ name: "hardware" })} />
        </Card>
      </View>
      <Section title="Security">
        <Segmented label="Lock automatically after" value={prefs.autoLockMinutes} onChange={(v) => setPrefs({ autoLockMinutes: v })} options={AUTO_LOCK.map((m) => ({ value: m, label: m === 60 ? "1 h" : `${m} min` }))} />
        {enrolling ? <EnrolBiometrics onDone={() => (setEnrolling(false), void refresh())} /> : <Security onEnrol={() => setEnrolling(true)} />}
      </Section>
      <Sessions />
      <WalletConnectPair />
      <Section title="Advanced">
        <Toggle
          testID="advanced"
          label="Advanced mode"
          description="Shows network names, chain ids, RPC settings and raw requests. Also lets you override blocked unreadable requests, one at a time."
          checked={prefs.advanced}
          onChange={(v) => setPrefs({ advanced: v })}
        />
      </Section>
      {prefs.advanced && <AdvancedNetworks prefs={prefs} setPrefs={setPrefs} />}
      {prefs.advanced && (
        <Section title="About this device">
          <Row label="Password hashing" value={wallet.argon2.kind === "native" ? "Argon2id (native)" : "Argon2id (JavaScript, slower)"} />
          <Row label="WalletConnect" value={wallet.walletConnectEnabled ? "On" : "Off in this build"} />
        </Section>
      )}
      <T v="hint" style={{ textAlign: "center" }}>{`${APP.config.name} · test networks only`}</T>
    </Screen>
  );
}
