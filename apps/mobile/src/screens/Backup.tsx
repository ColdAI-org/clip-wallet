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

export const AUTO_HIDE_MS = 60_000;
export const HOLD_MS = 300;

export function BackupHub() {
  const { client, navigate, theme } = useWallet();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), [client]);
  const st = status.data;
  return (
    <Screen back title="Backup">
      <T v="lede">If you lose this phone, a backup is the only way back into your wallet.</T>
      <Card>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <IconShield color={theme.c.text} />
          <T v="h2">Recovery phrase</T>
        </View>
        <T v="hint">Write the 12 words on paper and keep them somewhere safe. They work in any compatible wallet, forever.</T>
        <Button block variant="secondary" testID="backup-phrase" onPress={() => navigate({ name: "backup-phrase" })}>
          Back up recovery phrase
        </Button>
      </Card>
      <Card>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <IconFingerprint color={theme.c.text} />
          <T v="h2">Passkey backup</T>
        </View>
        {status.loading && !st ? (
          <Spinner />
        ) : !st ? (
          <ErrorNote message={userMessageOf(status.error)} />
        ) : !st.available ? (
          <T v="hint" testID="passkey-backup-unavailable">
            Passkey backup isn't available in this version. Your recovery phrase is your backup.
          </T>
        ) : (
          <>
            <T v="hint">
              {st.backups.length > 0
                ? `${st.backups.length === 1 ? "1 locked copy is" : `${st.backups.length} locked copies are`} stored. Your passkey unlocks it on a new device.`
                : "Lock a copy of your recovery phrase with a passkey, so you can restore on a new device with your email and that passkey."}
            </T>
            <Button block variant="secondary" testID="backup-passkey" onPress={() => navigate({ name: "backup-passkey" })}>
              {st.backups.length > 0 ? "Manage passkey backup" : "Back up with your passkey"}
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
  return (
    <View
      testID="phrase-grid"
      accessibilityLabel={props.words ? "Recovery phrase" : "Recovery phrase, hidden"}
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
  const check = () => {
    const ok = positions.every((p, i) => answers[i]!.trim().toLowerCase() === props.words[p]);
    if (ok) props.onPass();
    else setErr("That doesn't match. Check what you wrote down, or look at the phrase again.");
  };
  return (
    <>
      <T v="h1">Check your copy</T>
      <T v="lede">Type these words from what you wrote down.</T>
      {positions.map((p, i) => (
        <Field
          key={p}
          label={`Word ${p + 1}`}
          testID={`quiz-${i}`}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={answers[i]}
          onChangeText={(t) => setAnswers((a) => a.map((x, j) => (j === i ? t : x)))}
        />
      ))}
      <ErrorNote message={err} />
      <Button block onPress={check} disabled={answers.some((a) => !a.trim())} testID="quiz-check">
        Check
      </Button>
      <Button block variant="ghost" onPress={props.onBack}>
        Show phrase again
      </Button>
    </>
  );
}

export function RecoveryPhraseBackup(props: { quizPositions?: number[] }) {
  const { client, wallet, state, back } = useWallet();
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
      await wallet.confirmPresence("Show your recovery phrase");
      const p = await client.revealPhrase(password);
      phrase.current = p.trim().split(/\s+/);
      setCount(phrase.current.length);
      setPassword("");
      setStep("phrase");
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === "password") {
    return (
      <Screen
        back
        title="Recovery phrase"
        footer={
          <Button block onPress={() => void unlock()} disabled={busy || !password || state?.status !== "unlocked"} testID="phrase-unlock">
            {busy ? "Checking…" : "Continue"}
          </Button>
        }
      >
        <T v="h1">Back up your recovery phrase</T>
        <T v="lede">
          These words are the only way to get your wallet back if you lose this phone. Anyone who sees them can take everything. Write them on paper. Don't screenshot, photograph or paste them anywhere.
        </T>
        <Field label="Your wallet password" secureTextEntry textContentType="password" testID="phrase-password" value={password} onChangeText={setPassword} onSubmitEditing={() => password && void unlock()} />
        <ErrorNote message={err} />
      </Screen>
    );
  }

  if (step === "quiz" && phrase.current) {
    return (
      <Screen back={() => setStep("phrase")} title="Recovery phrase">
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
      <Screen back title="Recovery phrase" footer={<Button block onPress={back} testID="phrase-done">Done</Button>}>
        <T v="h1">You're backed up</T>
        <T v="lede">Keep the paper somewhere safe and private. We'll never ask you for these words.</T>
      </Screen>
    );
  }

  const visible = (shown || held) && phrase.current ? phrase.current : null;
  return (
    <Screen
      back
      title="Recovery phrase"
      footer={
        <Button block testID="phrase-written" onPress={() => (hide(), setStep("quiz"))}>
          I've written it down
        </Button>
      }
    >
      <T v="h1">Your recovery phrase</T>
      <T v="lede">Make sure nobody can see your screen. Hold the button to show the words, or tap it to keep them shown.</T>
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
      <Toggle testID="phrase-allow-copy" label="Allow copying" description="Off by default. Anything you copy can be read by other apps." checked={allowCopy} onChange={setAllowCopy} />
    </Screen>
  );
}

function RevealLabel(props: { shown: boolean; pressed: boolean }) {
  const { theme } = useWallet();
  return (
    <View style={{ backgroundColor: theme.c.surface2, borderRadius: theme.r.md, paddingVertical: 14, alignItems: "center", opacity: props.pressed ? 0.8 : 1 }}>
      <T style={{ fontWeight: "600" }}>{props.shown ? "Hide words" : "Hold or tap to show"}</T>
    </View>
  );
}

/* ------------------------------------------------------------------ passkey backup */

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PasskeyBackupExplainer() {
  return (
    <View testID="passkey-backup-explainer" style={{ gap: 8 }}>
      <T v="lede">Your passkey can lock a copy of your recovery phrase so you can get your wallet back on a new device.</T>
      <T>• We store only the locked copy. We can't open it, and neither can anyone who breaks into our servers.</T>
      <T>• To restore, you need your email (to fetch the copy) and the passkey (to unlock it), on the new device.</T>
      <T style={{ fontWeight: "600" }}>
        • Your passkey syncs through your Apple, Google or password-manager account. Whoever controls that account and can pass its Face ID, fingerprint or PIN could restore this wallet if they also get into your email. Protect both.
      </T>
      <T>• Keep your recovery phrase written down too. It works even if this service or your passkey is gone.</T>
    </View>
  );
}

/** Email sign-in by one-time link. The link only works on the device that asked for it. */
function BackupSignIn(props: { status: BackupStatusView; onSignedIn: () => void }) {
  const { client } = useWallet();
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
        <Field label="Email" keyboardType="email-address" autoCapitalize="none" textContentType="emailAddress" testID="backup-email" value={email} onChangeText={setEmail} hint="We'll email you a sign-in link. No password." />
        <ErrorNote message={err} />
        <Button block disabled={busy || !email.includes("@")} testID="backup-email-send" onPress={() => run(async () => (await p.backupStartSignIn({ email: email.trim() }), setSentTo(email.trim())))}>
          {busy ? "Sending…" : "Email me a link"}
        </Button>
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <T v="lede">{`We sent a link to ${sentTo}. Paste it here. It works once, for 15 minutes.`}</T>
      <Field label="Link from the email" autoCapitalize="none" spellCheck={false} testID="backup-link" value={link} onChangeText={setLink} />
      <ErrorNote message={err} />
      <Button block disabled={busy || !link.trim()} testID="backup-link-continue" onPress={() => run(async () => (await p.backupCompleteSignIn({ link: link.trim() }), props.onSignedIn()))}>
        {busy ? "Checking…" : "Continue"}
      </Button>
      <Button block variant="ghost" disabled={busy} onPress={() => setSentTo(undefined)}>
        Use a different email
      </Button>
    </View>
  );
}

export function PasskeyBackup() {
  const { client, wallet } = useWallet();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), [client]);
  const [understood, setUnderstood] = useState(false);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (status.loading && !status.data) return <Screen back title="Passkey backup"><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen back title="Passkey backup"><ErrorNote message={userMessageOf(status.error)} /></Screen>;
  if (!st.available) {
    return (
      <Screen back title="Passkey backup">
        <Empty title="Passkey backup isn't available in this version">Your recovery phrase is your backup.</Empty>
      </Screen>
    );
  }

  const create = async () => {
    setErr(null);
    if (!wallet.passkeyPrf) return setErr("Passkeys aren't set up in this build. Your recovery phrase is still your backup.");
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
    <Screen back title="Passkey backup">
      <T v="h1">Back up with your passkey</T>
      {done && <Notice level="info">Backed up. You can restore on a new device with your email and this passkey.</Notice>}
      {st.backups.length > 0 && (
        <Card>
          <T v="h2">Your backups</T>
          {st.backups.map((b) => (
            <Row
              key={b.id}
              label={`Made ${fmtDate(b.createdAt)}`}
              value={
                <Button variant="ghost" style={{ flex: 0 }} onPress={() => void p.backupDelete({ id: b.id }).then(status.reload, (e: unknown) => setErr(userMessageOf(e)))}>
                  Delete
                </Button>
              }
            />
          ))}
          {st.email ? <T v="hint">{`Signed in as ${st.email}`}</T> : null}
        </Card>
      )}
      {showCreate ? (
        <>
          <PasskeyBackupExplainer />
          {!wallet.passkeyPrf && <Notice level="info">Passkeys aren't set up in this build, so a passkey backup can't be made on this phone yet.</Notice>}
          <Checkbox testID="backup-understood" label="I understand who can restore my wallet" checked={understood} onChange={setUnderstood} />
          {understood && !st.signedIn && <BackupSignIn status={st} onSignedIn={() => status.reload()} />}
          {understood && st.signedIn && (
            <View style={{ gap: 12 }}>
              <Field label="Your wallet password" secureTextEntry textContentType="password" testID="backup-password" value={password} onChangeText={setPassword} />
              <ErrorNote message={err} />
              <Button block onPress={() => void create()} disabled={busy || !password} testID="backup-create">
                {busy ? "Waiting for your passkey…" : "Create backup passkey"}
              </Button>
            </View>
          )}
        </>
      ) : (
        <View style={{ gap: 12 }}>
          <ErrorNote message={err} />
          <Button block variant="secondary" onPress={() => setAdding(true)}>
            Add another backup
          </Button>
          <Button block variant="ghost" onPress={() => void p.backupSignOut().catch(() => undefined).then(status.reload)}>
            Sign out of backups
          </Button>
        </View>
      )}
    </Screen>
  );
}
