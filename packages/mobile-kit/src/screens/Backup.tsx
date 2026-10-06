/**
 * Settings → Backup: the extension's BackupHub, RecoveryPhraseBackup and PasskeyBackup
 * (packages/ui/src/screens/{Backup,RecoveryPhrase,PasskeyBackup}.tsx) in React Native.
 *
 * Recovery phrase rules (same as the extension):
 *  - Fetched only after the password is typed again (the vault checks it). On a phone with Face ID / Touch ID /
 *    fingerprint set up, the OS check runs first as well.
 *  - While hidden, the words are not rendered at all (a fixed placeholder, never blurred text). They show only
 *    while the button is held, or after it's tapped, and hide again when the app leaves the foreground or
 *    after 60 s.
 *  - Copying is off by default (the words aren't selectable). "Allow copying" turns selection on for this view.
 *  - "I've written it down" asks for three words; the phrase is dropped from memory when this screen closes.
 *
 * Passkey backup appears only when this build has a backup service (clip.config services.backupUrl); otherwise
 * a plain note says the recovery phrase is the backup.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { asPlatform, quizPositions, runCeremony, userMessageOf, type BackupStatusView } from "@clip-wallet/ui";
import { useAsync, useWallet } from "../ui/context";
import { Button, Card, Checkbox, Empty, ErrorNote, Field, Notice, Row, Screen, Spinner, T, Toggle } from "../ui/kit";
import { IconFingerprint, IconShield } from "../ui/icons";
import { useMobileT } from "../i18n";

export const AUTO_HIDE_MS = 60_000;
export const HOLD_MS = 300;

export function BackupHub() {
  const { client, navigate, theme } = useWallet();
  const t = useMobileT();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), [client]);
  const st = status.data;
  return (
    <Screen back title={t("m.backup.title")}>
      <T v="lede">{t("m.backup.lede")}</T>
      <Card>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <IconShield color={theme.c.text} />
          <T v="h2">{t("m.backup.phrase")}</T>
        </View>
        <T v="hint">{t("m.backup.phraseHint")}</T>
        <Button block variant="secondary" testID="backup-phrase" onPress={() => navigate({ name: "backup-phrase" })}>
          {t("m.backup.phraseButton")}
        </Button>
      </Card>
      <Card>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <IconFingerprint color={theme.c.text} />
          <T v="h2">{t("m.backup.passkey")}</T>
        </View>
        {status.loading && !st ? (
          <Spinner />
        ) : !st ? (
          <ErrorNote message={userMessageOf(status.error)} />
        ) : !st.available ? (
          <T v="hint" testID="passkey-backup-unavailable">
            {t("m.backup.passkeyUnavailable")}
          </T>
        ) : (
          <>
            <T v="hint">
              {st.backups.length > 0 ? t("m.backup.stored", { count: st.backups.length }) : t("m.backup.passkeyHint")}
            </T>
            <Button block variant="secondary" testID="backup-passkey" onPress={() => navigate({ name: "backup-passkey" })}>
              {st.backups.length > 0 ? t("m.backup.manage") : t("m.backup.withPasskey")}
            </Button>
          </>
        )}
      </Card>
    </Screen>
  );
}

/* ------------------------------------------------------------------ recovery phrase */

function PhraseGrid(props: { words: string[] | null; count: number; allowCopy: boolean }) {
  const { theme } = useWallet();
  const t = useMobileT();
  return (
    <View
      testID="phrase-grid"
      accessibilityLabel={props.words ? t("m.backup.phrase") : t("m.backup.phraseHidden")}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: theme.c.surface, borderRadius: theme.r.lg, padding: 12, borderWidth: 1, borderColor: theme.c.border }}
    >
      {Array.from({ length: props.count }, (_, i) => (
        <View key={i} style={{ width: "31%", flexDirection: "row", gap: 6, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: theme.c.surface2, borderRadius: theme.r.sm }}>
          <T v="hint">{i + 1}</T>
          {/* Hidden: a fixed placeholder, so the words are never rendered while hidden. */}
          <T testID={`phrase-word-${i}`} selectable={props.allowCopy && !!props.words} style={{ fontWeight: "600", fontSize: 15 }}>
            {props.words ? props.words[i]! : "••••••"}
          </T>
        </View>
      ))}
    </View>
  );
}

function Quiz(props: { words: string[]; positions?: number[]; onPass: () => void; onBack: () => void }) {
  const positions = useMemo(() => props.positions ?? quizPositions(props.words.length), [props.positions, props.words.length]);
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  const t = useMobileT();
  const check = () => {
    const ok = positions.every((p, i) => answers[i]!.trim().toLowerCase() === props.words[p]);
    if (ok) props.onPass();
    else setErr(t("m.backup.quizMismatch"));
  };
  return (
    <>
      <T v="h1">{t("m.backup.quizTitle")}</T>
      <T v="lede">{t("m.backup.quizLede")}</T>
      {positions.map((p, i) => (
        <Field
          key={p}
          label={t("m.backup.quizWord", { n: p + 1 })}
          testID={`quiz-${i}`}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={answers[i]}
          onChangeText={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))}
        />
      ))}
      <ErrorNote message={err} />
      <Button block onPress={check} disabled={answers.some((a) => !a.trim())} testID="quiz-check">
        {t("m.backup.quizCheck")}
      </Button>
      <Button block variant="ghost" onPress={props.onBack}>
        {t("m.backup.showAgain")}
      </Button>
    </>
  );
}

export function RecoveryPhraseBackup(props: { quizPositions?: number[] }) {
  const { client, wallet, state, back } = useWallet();
  const t = useMobileT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The phrase lives in a ref (not state) so it isn't rendered unless shown. */
  const phrase = useRef<string[] | null>(null);
  const [count, setCount] = useState(0);
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const [step, setStep] = useState<"password" | "phrase" | "quiz" | "done">("password");
  const [allowCopy, setAllowCopy] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedAt = useRef(0);

  const hide = useCallback(() => {
    setShown(false);
    setHeld(false);
  }, []);

  // Hide when the app goes to the background (app switcher snapshot, lock screen); drop the phrase on close.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s !== "active" && hide());
    return () => {
      sub.remove();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      phrase.current = null;
    };
  }, [hide]);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (shown || held) hideTimer.current = setTimeout(hide, AUTO_HIDE_MS);
  }, [shown, held, hide]);

  const unlock = async () => {
    setErr(null);
    setBusy(true);
    try {
      await wallet.confirmPresence(t("m.backup.presenceReason"), t("m.common.cancel"));
      const p = await client.revealPhrase(password);
      phrase.current = p.trim().split(/\s+/);
      setCount(phrase.current.length);
      setPassword("");
      setStep("phrase");
    } catch (e) {
      setErr((e as { code?: string }).code === "presence/cancelled" ? t("m.backup.presenceCancelled") : userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "password") {
    return (
      <Screen
        back
        title={t("m.backup.phrase")}
        footer={
          <Button block onPress={() => void unlock()} disabled={busy || !password || state?.status !== "unlocked"} testID="phrase-unlock">
            {busy ? t("m.backup.checking") : t("m.common.continue")}
          </Button>
        }
      >
        <T v="h1">{t("m.backup.phraseTitle")}</T>
        <T v="lede">{t("m.backup.phraseLede")}</T>
        <Field label={t("m.backup.password")} secureTextEntry textContentType="password" testID="phrase-password" value={password} onChangeText={setPassword} onSubmitEditing={() => password && void unlock()} />
        <ErrorNote message={err} />
      </Screen>
    );
  }

  if (step === "quiz" && phrase.current) {
    return (
      <Screen back={() => setStep("phrase")} title={t("m.backup.phrase")}>
        <Quiz
          words={phrase.current}
          {...(props.quizPositions ? { positions: props.quizPositions } : {})}
          onBack={() => setStep("phrase")}
          onPass={async () => {
            phrase.current = null;
            setStep("done");
            await asPlatform(client).markPhraseBackedUp().catch(() => undefined);
          }}
        />
      </Screen>
    );
  }

  if (step === "done") {
    return (
      <Screen back title={t("m.backup.phrase")} footer={<Button block onPress={back} testID="phrase-done">{t("m.backup.done")}</Button>}>
        <T v="h1">{t("m.backup.doneTitle")}</T>
        <T v="lede">{t("m.backup.doneLede")}</T>
      </Screen>
    );
  }

  const visible = (shown || held) && phrase.current ? phrase.current : null;
  return (
    <Screen
      back
      title={t("m.backup.phrase")}
      footer={
        <Button block testID="phrase-written" onPress={() => (hide(), setStep("quiz"))}>
          {t("m.backup.written")}
        </Button>
      }
    >
      <T v="h1">{t("m.backup.yourPhrase")}</T>
      <T v="lede">{t("m.backup.revealLede")}</T>
      <PhraseGrid words={visible} count={count} allowCopy={allowCopy} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: shown }}
        testID="phrase-reveal"
        onPressIn={() => {
          pressedAt.current = Date.now();
          setHeld(true);
        }}
        onPressOut={() => setHeld(false)}
        onPress={() => {
          const wasHold = pressedAt.current && Date.now() - pressedAt.current > HOLD_MS;
          pressedAt.current = 0;
          if (!wasHold) setShown((v) => !v);
        }}
      >
        {({ pressed }) => <RevealLabel shown={shown} pressed={pressed} />}
      </Pressable>
      <Toggle testID="phrase-allow-copy" label={t("m.backup.allowCopy")} description={t("m.backup.allowCopyHint")} checked={allowCopy} onChange={setAllowCopy} />
    </Screen>
  );
}

function RevealLabel(props: { shown: boolean; pressed: boolean }) {
  const { theme } = useWallet();
  const t = useMobileT();
  return (
    <View style={{ backgroundColor: theme.c.surface2, borderRadius: theme.r.md, paddingVertical: 14, alignItems: "center", opacity: props.pressed ? 0.8 : 1 }}>
      <T style={{ fontWeight: "600" }}>{props.shown ? t("m.backup.hideWords") : t("m.backup.holdToShow")}</T>
    </View>
  );
}

/* ------------------------------------------------------------------ passkey backup */

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PasskeyBackupExplainer() {
  const t = useMobileT();
  return (
    <View testID="passkey-backup-explainer" style={{ gap: 8 }}>
      <T v="lede">{t("m.backup.explainer.lede")}</T>
      <T>{t("m.backup.explainer.stored")}</T>
      <T>{t("m.backup.explainer.restore")}</T>
      <T style={{ fontWeight: "600" }}>{t("m.backup.explainer.sync")}</T>
      <T>{t("m.backup.explainer.keepPhrase")}</T>
    </View>
  );
}

/**
 * "Continue with Google" / "Sign in with Apple" (an ASWebAuthenticationSession / Custom Tabs window, opened by the
 * engine). Shown only when the backup service has the provider on and this build has a return link.
 */
function SocialSignIn(props: { onSignedIn: () => void; busy: boolean; setBusy: (b: boolean) => void; setErr: (e: string | null) => void }) {
  const { client } = useWallet();
  const t = useMobileT();
  const p = asPlatform(client);
  const providers = useAsync(async () => (p.backupProviders ? p.backupProviders() : null), [client]);
  const pv = providers.data;
  if (!pv || !p.backupSocialSignIn || (!pv.google && !pv.apple)) return null;
  const go = async (provider: "google" | "apple") => {
    props.setErr(null);
    props.setBusy(true);
    try {
      await p.backupSocialSignIn!({ provider });
      props.onSignedIn();
    } catch (e) {
      props.setErr(userMessageOf(e));
    } finally {
      props.setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }} testID="backup-social-sign-in">
      {pv.google && (
        <Button block variant="secondary" disabled={props.busy} testID="backup-google" onPress={() => void go("google")}>
          {t("m.backup.social.google")}
        </Button>
      )}
      {pv.apple && (
        <Button block variant="secondary" disabled={props.busy} testID="backup-apple" onPress={() => void go("apple")}>
          {t("m.backup.social.apple")}
        </Button>
      )}
      <T v="hint">{t("m.backup.social.privacy")}</T>
      {pv.email && <T v="hint">{t("m.backup.social.orEmail")}</T>}
    </View>
  );
}

/** The engine labels a Google/Apple session in English ("your Google account"); say it in the user's language. */
function accountLabel(email: string, t: ReturnType<typeof useMobileT>): string {
  if (email === "your Google account") return t("m.backup.social.googleAccount");
  if (email === "your Apple Account") return t("m.backup.social.appleAccount");
  return email;
}

/** Email sign-in by one-time link. The link only works on the device that asked for it. */
function BackupSignIn(props: { status: BackupStatusView; onSignedIn: () => void }) {
  const { client } = useWallet();
  const t = useMobileT();
  const p = asPlatform(client);
  const [email, setEmail] = useState(props.status.pendingEmail ?? "");
  const [sentTo, setSentTo] = useState<string | undefined>(props.status.pendingEmail);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  if (!sentTo) {
    return (
      <View style={{ gap: 12 }}>
        <SocialSignIn onSignedIn={props.onSignedIn} busy={busy} setBusy={setBusy} setErr={setErr} />
        <Field label={t("m.backup.email")} keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" testID="backup-email" value={email} onChangeText={setEmail} hint={t("m.backup.emailHint")} />
        <ErrorNote message={err} />
        <Button block disabled={busy || !email.includes("@")} testID="backup-email-send" onPress={() => run(async () => (await p.backupStartSignIn({ email: email.trim() }), setSentTo(email.trim())))}>
          {busy ? t("m.backup.sending") : t("m.backup.emailMe")}
        </Button>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <T v="lede">{t("m.backup.sent", { email: sentTo })}</T>
      <Field label={t("m.backup.link")} autoCapitalize="none" spellCheck={false} testID="backup-link" value={link} onChangeText={setLink} />
      <ErrorNote message={err} />
      <Button block disabled={busy || !link.trim()} testID="backup-link-continue" onPress={() => run(async () => (await p.backupCompleteSignIn({ link: link.trim() }), props.onSignedIn()))}>
        {busy ? t("m.backup.checking") : t("m.common.continue")}
      </Button>
      <Button block variant="ghost" disabled={busy} onPress={() => setSentTo(undefined)}>
        {t("m.backup.differentEmail")}
      </Button>
    </View>
  );
}

export function PasskeyBackup() {
  const { client, wallet } = useWallet();
  const t = useMobileT();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), [client]);
  const [understood, setUnderstood] = useState(false);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (status.loading && !status.data) return <Screen back title={t("m.backup.passkey")}><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen back title={t("m.backup.passkey")}><ErrorNote message={userMessageOf(status.error)} /></Screen>;
  if (!st.available) {
    return (
      <Screen back title={t("m.backup.passkey")}>
        <Empty title={t("m.backup.passkeyOff")}>{t("m.backup.passkeyOffHint")}</Empty>
      </Screen>
    );
  }

  const create = async () => {
    setErr(null);
    if (!wallet.passkeyPrf) return setErr(t("m.backup.noPasskeys"));
    setBusy(true);
    try {
      await runCeremony(client, wallet.passkeyPrf, () => p.passkeyBackupBegin({ password }));
      setPassword("");
      setDone(true);
      setAdding(false);
      status.reload();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const showCreate = adding || st.backups.length === 0;
  return (
    <Screen back title={t("m.backup.passkey")}>
      <T v="h1">{t("m.backup.withPasskey")}</T>
      {done && <Notice level="info">{t("m.backup.backedUp")}</Notice>}
      {st.backups.length > 0 && (
        <Card>
          <T v="h2">{t("m.backup.yourBackups")}</T>
          {st.backups.map((b) => (
            <Row
              key={b.id}
              label={t("m.backup.made", { date: fmtDate(b.createdAt) })}
              value={
                <Button variant="ghost" style={{ flex: 0 }} onPress={() => void p.backupDelete({ id: b.id }).then(status.reload, (e: unknown) => setErr(userMessageOf(e)))}>
                  {t("m.backup.delete")}
                </Button>
              }
            />
          ))}
          {st.email ? <T v="hint">{t("m.backup.signedInAs", { email: accountLabel(st.email, t) })}</T> : null}
        </Card>
      )}
      {showCreate ? (
        <>
          <PasskeyBackupExplainer />
          {!wallet.passkeyPrf && <Notice level="info">{t("m.backup.noPasskeysPhone")}</Notice>}
          <Checkbox testID="backup-understood" label={t("m.backup.understood")} checked={understood} onChange={setUnderstood} />
          {understood && !st.signedIn && <BackupSignIn status={st} onSignedIn={() => status.reload()} />}
          {understood && st.signedIn && (
            <View style={{ gap: 12 }}>
              <Field label={t("m.backup.password")} secureTextEntry textContentType="password" testID="backup-password" value={password} onChangeText={setPassword} />
              <ErrorNote message={err} />
              <Button block onPress={() => void create()} disabled={busy || !password} testID="backup-create">
                {busy ? t("m.backup.waitingPasskey") : t("m.backup.create")}
              </Button>
            </View>
          )}
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <ErrorNote message={err} />
          <Button block variant="secondary" onPress={() => setAdding(true)}>
            {t("m.backup.addAnother")}
          </Button>
          <Button block variant="ghost" onPress={() => void p.backupSignOut().catch(() => undefined).then(status.reload)}>
            {t("m.backup.signOut")}
          </Button>
        </View>
      )}
    </Screen>
  );
}
