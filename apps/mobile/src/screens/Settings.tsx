import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { isWalletConnectUri, relativeTime, userMessageOf, type Prefs } from "@clip-wallet/ui";
import { LOCALES, localeInfo, resolveLocale, type LocalePref } from "@clip-wallet/i18n";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, ErrorNote, Field, MenuItem, Notice, Row, Screen, T, Toggle } from "../ui/kit";
import { APP } from "../env";
import { useT } from "@clip-wallet/i18n/react";
import { PRIVACY_CATALOGS } from "@clip-wallet/ui";
import { useMobileT } from "../i18n";
import { deviceLanguages } from "../i18n/device";

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

/** Language: "Match device (Deutsch)" plus every shipped language, each in its own name. */
function LanguagePicker(props: { value: LocalePref; onChange: (v: LocalePref) => void }) {
  const { theme } = useWallet();
  const t = useMobileT();
  const device = localeInfo(resolveLocale("system", deviceLanguages()));
  const options: { value: LocalePref; label: string }[] = [
    { value: "system", label: t("m.settings.language.system", { language: device.nativeName }) },
    ...LOCALES.map((l) => ({ value: l.code, label: l.nativeName })),
  ];
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{t("m.settings.language")}</T>
      <View accessibilityRole="radiogroup" accessibilityLabel={t("m.settings.language")} style={{ backgroundColor: theme.c.surface2, borderRadius: theme.r.md, padding: 3, gap: 2 }}>
        {options.map((o) => {
          const on = o.value === props.value;
          return (
            <Pressable
              key={o.value}
              testID={`locale-${o.value}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              onPress={() => props.onChange(o.value)}
              style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: theme.r.sm, backgroundColor: on ? theme.c.surface : "transparent" }}
            >
              <T style={{ fontSize: 15, fontWeight: on ? "600" : "400" }}>{o.label}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Sessions() {
  const { client, state, navigate } = useWallet();
  const t = useMobileT();
  const { data, reload, error } = useAsync(() => client.listSessions(), [client]);
  return (
    <Section title={t("m.settings.sessions.title")}>
      <ErrorNote message={error ? userMessageOf(error) : null} />
      {data && data.length === 0 && <T v="hint">{t("m.settings.sessions.none")}</T>}
      {data?.map((s) => (
        <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T style={{ fontWeight: "600" }}>{s.dapp.name}</T>
            <T v="hint">{`${t("m.settings.sessions.meta", { domain: s.dapp.domain, via: s.via === "walletconnect" ? "WalletConnect" : t("m.settings.sessions.inApp"), when: relativeTime(s.connectedAt) })}${state?.prefs.advanced && s.networkIds.length ? ` · ${s.networkIds.join(", ")}` : ""}`}</T>
          </View>
          {s.via !== "walletconnect" && (
            <Button variant="ghost" style={{ flex: 0, paddingHorizontal: 8 }} accessibilityLabel={t("m.settings.sessions.accountsFor", { app: s.dapp.name })} onPress={() => navigate({ name: "accounts", origin: s.dapp.origin })}>
              {t("m.settings.sessions.accounts")}
            </Button>
          )}
          <Button variant="secondary" style={{ flex: 0 }} accessibilityLabel={t("m.settings.sessions.disconnectApp", { app: s.dapp.name })} onPress={async () => (await client.disconnect(s.id), reload())}>
            {t("m.settings.sessions.disconnect")}
          </Button>
        </View>
      ))}
    </Section>
  );
}

function WalletConnectPair() {
  const { client, wallet, navigate } = useWallet();
  const t = useMobileT();
  const [uri, setUri] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = isWalletConnectUri(uri);
  if (!wallet.walletConnectEnabled) {
    return (
      <Section title={t("m.settings.wc.title")}>
        <Notice level="info">{t("m.settings.wc.off")}</Notice>
      </Section>
    );
  }
  return (
    <Section title={t("m.settings.wc.title")}>
      <T v="hint">{t("m.settings.wc.intro")}</T>
      <Field label={t("m.settings.wc.code")} placeholder="wc:…" autoCapitalize="none" autoComplete="off" value={uri} onChangeText={(v) => (setUri(v), setErr(null), setMsg(null))} error={uri && !valid ? t("m.settings.wc.bad") : null} />
      <ErrorNote message={err} />
      {msg && <Notice level="info">{msg}</Notice>}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button variant="secondary" onPress={() => navigate({ name: "scan" })} testID="scan">
          {t("m.settings.wc.scan")}
        </Button>
        <Button
          disabled={!valid}
          onPress={async () => {
            try {
              await client.pairWalletConnect(uri.trim());
              setUri("");
              setMsg(t("m.settings.wc.started"));
            } catch (e) {
              setErr(userMessageOf(e));
            }
          }}
        >
          {t("m.settings.wc.connect")}
        </Button>
      </View>
    </Section>
  );
}

function Security(props: { onEnrol: () => void }) {
  const { client, wallet, refresh } = useWallet();
  const t = useMobileT();
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
        label={bio ? t("m.settings.unlockWith", { method: bio.label }) : t("m.settings.unlockBiometrics")}
        value={
          bio?.enrolled ? (
            <Button variant="secondary" style={{ flex: 0 }} onPress={async () => (await wallet.removeUnlockMethods(), setN((x) => x + 1), await refresh())}>
              {t("m.settings.turnOff")}
            </Button>
          ) : (
            <Button variant="secondary" style={{ flex: 0 }} disabled={!bio?.available} onPress={props.onEnrol}>
              {t("m.settings.setUp")}
            </Button>
          )
        }
        hint={bio && !bio.available ? bio.reason : undefined}
      />
      <Row label={t("m.settings.passkey")} value={<T v="hint">{pk?.configured ? (pk.enrolled ? t("m.settings.passkey.on") : t("m.settings.passkey.available")) : t("m.settings.passkey.notInBuild")}</T>} />
      <Button variant="secondary" block onPress={async () => (await client.lock(), await refresh())}>
        {t("m.settings.lockNow")}
      </Button>
    </>
  );
}

function EnrolBiometrics(props: { onDone: () => void }) {
  const { wallet } = useWallet();
  const t = useMobileT();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 10 }}>
      <Field label={t("m.settings.confirmPassword")} secureTextEntry value={pw} onChangeText={setPw} />
      <ErrorNote message={err} />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <Button variant="secondary" onPress={props.onDone}>
          {t("m.common.cancel")}
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
          {t("m.settings.turnOn")}
        </Button>
      </View>
    </View>
  );
}

function AdvancedNetworks(props: { prefs: Prefs; setPrefs: (p: Partial<Prefs>) => Promise<void> }) {
  const { client } = useWallet();
  const t = useMobileT();
  const { data } = useAsync(() => client.getPortfolio(), [client]);
  const [draft, setDraft] = useState<Record<string, string>>(props.prefs.rpcOverrides);
  return (
    <Section title={t("m.settings.networks")}>
      {data?.networks.map((n) => (
        <View key={n.id} style={{ gap: 4 }}>
          <Row label={n.name} value={<T v="mono">{n.id}</T>} hint={n.chainId !== undefined ? t("m.settings.networks.chainId", { id: n.chainId }) : undefined} />
          <Field
            label={t("m.settings.networks.rpc", { network: n.name })}
            placeholder={n.rpcUrl ?? "https://"}
            autoCapitalize="none"
            value={draft[n.id] ?? ""}
            onChangeText={(v) => setDraft((d) => ({ ...d, [n.id]: v }))}
            onBlur={() => {
              const v = (draft[n.id] ?? "").trim();
              const next = { ...props.prefs.rpcOverrides };
              if (v && /^https:\/\//.test(v)) next[n.id] = v;
              else delete next[n.id];
              void props.setPrefs({ rpcOverrides: next });
            }}
            error={draft[n.id] && !/^https:\/\//.test(draft[n.id]!) ? t("m.settings.networks.https") : null}
          />
        </View>
      ))}
    </Section>
  );
}

export function Settings() {
  const { client, state, refresh, wallet, navigate } = useWallet();
  const t = useMobileT();
  const tp = useT(PRIVACY_CATALOGS);
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
    <Screen nav title={t("m.settings.title")}>
      <ErrorNote message={err} />
      <Section title={t("m.settings.display")}>
        <Segmented label={t("m.settings.currency")} value={prefs.displayCurrency} onChange={(v) => setPrefs({ displayCurrency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Segmented
          label={t("m.settings.appearance")}
          value={prefs.theme}
          onChange={(v) => setPrefs({ theme: v })}
          options={[
            { value: "system", label: t("m.settings.theme.system") },
            { value: "light", label: t("m.settings.theme.light") },
            { value: "dark", label: t("m.settings.theme.dark") },
          ]}
        />
        <LanguagePicker value={prefs.locale ?? "system"} onChange={(v) => setPrefs({ locale: v })} />
      </Section>
      <View style={{ gap: 8 }}>
        <T v="h2">{t("m.settings.more")}</T>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <MenuItem title={t("m.explore.menu.stake")} testID="menu-stake" onPress={() => navigate({ name: "stake" })} />
          <MenuItem title={t("m.explore.menu.swap")} testID="menu-swap" onPress={() => navigate({ name: "swap" })} />
          <MenuItem title={t("m.explore.menu.buy")} testID="menu-buy" onPress={() => navigate({ name: "buy" })} />
          <MenuItem title={t("m.explore.menu.trade")} testID="menu-trade" onPress={() => navigate({ name: "trade" })} />
          <MenuItem title={t("m.settings.explore")} testID="explore" onPress={() => navigate({ name: "explore" })} />
        </Card>
      </View>
      <View style={{ gap: 8 }}>
        <T v="h2">{t("m.settings.backupAccounts")}</T>
        <Card style={{ gap: 0, paddingVertical: 4 }}>
          <MenuItem title={t("m.settings.menu.backup")} hint={t("m.settings.menu.backupHint")} testID="menu-backup" onPress={() => navigate({ name: "backup" })} />
          <MenuItem title={t("m.settings.menu.accounts")} hint={t("m.settings.menu.accountsHint")} testID="menu-accounts" onPress={() => navigate({ name: "accounts" })} />
          <MenuItem title={t("m.settings.menu.hardware")} hint={t("m.settings.menu.hardwareHint")} testID="menu-hardware" onPress={() => navigate({ name: "hardware" })} />
          <MenuItem title={tp("privacy.menu")} testID="menu-data-use" onPress={() => navigate({ name: "data-use" })} />
        </Card>
      </View>
      <Section title={t("m.settings.social")}>
        <Button variant="secondary" block onPress={() => navigate({ name: "contacts" })} testID="open-contacts">
          {t("m.settings.social.contacts")}
        </Button>
        <Button variant="secondary" block onPress={() => navigate({ name: "notifications" })} testID="open-notifications">
          {t("m.settings.social.notifications")}
        </Button>
      </Section>
      <Section title={t("m.settings.security")}>
        <Segmented label={t("m.settings.autoLock")} value={prefs.autoLockMinutes} onChange={(v) => setPrefs({ autoLockMinutes: v })} options={AUTO_LOCK.map((m) => ({ value: m, label: m === 60 ? t("m.settings.autoLock.hour") : t("m.settings.autoLock.minutes", { n: m }) }))} />
        {enrolling ? <EnrolBiometrics onDone={() => (setEnrolling(false), void refresh())} /> : <Security onEnrol={() => setEnrolling(true)} />}
      </Section>
      <Sessions />
      <WalletConnectPair />
      <Section title={t("m.settings.advanced")}>
        <Toggle
          testID="advanced"
          label={t("m.settings.advanced.toggle")}
          description={t("m.settings.advanced.hint")}
          checked={prefs.advanced}
          onChange={(v) => setPrefs({ advanced: v })}
        />
      </Section>
      {prefs.advanced && <AdvancedNetworks prefs={prefs} setPrefs={setPrefs} />}
      {prefs.advanced && (
        <Section title={t("m.settings.about")}>
          <Row label={t("m.settings.about.hashing")} value={wallet.argon2.kind === "native" ? t("m.settings.about.native") : t("m.settings.about.js")} />
          <Row label={t("m.settings.about.wc")} value={wallet.walletConnectEnabled ? t("m.settings.about.on") : t("m.settings.about.off")} />
        </Section>
      )}
      <T v="hint" style={{ textAlign: "center" }}>{t("m.settings.footer", { name: APP.config.name })}</T>
    </Screen>
  );
}
