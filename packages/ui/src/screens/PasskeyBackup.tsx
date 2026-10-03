import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Empty, ErrorNote, Field, Row, Screen, Spinner } from "../components";
import { IconFingerprint } from "../components/icons";
import { passwordStrength } from "../lib/strength";
import { asPlatform, type BackupStatusView } from "../platform/client";
import { runCeremony } from "../platform/ceremony";
import { passkeyErrorText } from "../lib/passkey";
import { formatLocale } from "../lib/format";
import { rich, useUiT } from "../i18n";

/**
 * Passkey backup (services/backup) and restore on a new device.
 *
 * What we tell people, plainly: the locked copy is stored with us; the passkey is the key; the passkey syncs
 * through their Apple / Google / password-manager account, so whoever controls that account (and can pass its
 * Face ID / PIN) can restore the wallet once they also get into the email. The recovery phrase stays the
 * primary backup.
 */

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(formatLocale(), { year: "numeric", month: "short", day: "numeric" });
}

/** The plain-words explanation shown before anyone opts in. Exported for the restore screen and tests. */
export function PasskeyBackupExplainer() {
  const t = useUiT();
  return (
    <div className="clip-stack" data-testid="passkey-backup-explainer">
      <p className="clip-lede">{t("backup.explainer.lede")}</p>
      <ul className="clip-bullets">
        <li>{t("backup.explainer.stored")}</li>
        <li>{t("backup.explainer.restore")}</li>
        <li>{rich(t("backup.explainer.sync"), { b: (c) => <strong>{c}</strong> })}</li>
        <li>{t("backup.explainer.keepPhrase")}</li>
      </ul>
    </div>
  );
}

/** Email sign-in by one-time link. The link only works on the device that asked for it. */
export function BackupSignIn(props: { status: BackupStatusView; onSignedIn: () => void }) {
  const t = useUiT();
  const { client } = useUi();
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
      <div className="clip-stack">
        <Field label={t("backup.signIn.email")} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} hint={t("backup.signIn.emailHint")} />
        <ErrorNote message={err} />
        <Button
          block
          disabled={busy || !email.includes("@")}
          onClick={() =>
            run(async () => {
              await p.backupStartSignIn({ email });
              setSentTo(email.trim());
            })
          }
        >
          {busy ? t("backup.signIn.sending") : t("backup.signIn.send")}
        </Button>
      </div>
    );
  }
  return (
    <div className="clip-stack">
      <p className="clip-lede">{rich(t("backup.signIn.sent", { email: sentTo }), { b: (c) => <strong>{c}</strong> })}</p>
      <Field label={t("backup.signIn.link")} autoComplete="off" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} />
      <ErrorNote message={err} />
      <Button
        block
        disabled={busy || !link.trim()}
        onClick={() =>
          run(async () => {
            await p.backupCompleteSignIn({ link: link.trim() });
            props.onSignedIn();
          })
        }
      >
        {busy ? t("backup.signIn.checking") : t("common.continue")}
      </Button>
      <Button block variant="ghost" disabled={busy} onClick={() => setSentTo(undefined)}>
        {t("backup.signIn.otherEmail")}
      </Button>
    </div>
  );
}

/** Settings → "Back up with your passkey". */
export function PasskeyBackup() {
  const t = useUiT();
  const { client, passkeys } = useUi();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const [understood, setUnderstood] = useState(false);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (status.loading && !status.data) return <Screen title={t("backup.passkey.screen")} back><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen title={t("backup.passkey.screen")} back><ErrorNote message={userMessageOf(status.error)} /></Screen>;
  if (!st.available) {
    return (
      <Screen title={t("backup.passkey.screen")} back>
        <Empty title={t("backup.passkey.unavailableTitle")}>{t("backup.passkey.unavailableBody")}</Empty>
      </Screen>
    );
  }

  const create = async () => {
    setErr(null);
    if (!passkeys) return setErr(t("backup.passkey.noPasskeys"));
    if (!passkeys.canRunHere) {
      await client.openFullTab("/backup/passkey");
      return;
    }
    setBusy(true);
    try {
      await runCeremony(client, passkeys, () => p.passkeyBackupBegin({ password }));
      setPassword("");
      setDone(true);
      setAdding(false);
      status.reload();
    } catch (e) {
      setErr(passkeyErrorText(e, t, userMessageOf));
    } finally {
      setBusy(false);
    }
  };

  const showCreate = adding || st.backups.length === 0;
  return (
    <Screen title={t("backup.passkey.screen")} back>
      <div className="clip-onboard">
        <span className="clip-done-badge" aria-hidden>
          <IconFingerprint width={28} height={28} />
        </span>
        <h1 className="clip-h1">{t("backup.passkey.title")}</h1>
        {done && (
          <div className="clip-notice clip-notice--info" role="status">
            <span>{t("backup.passkey.backedUp")}</span>
          </div>
        )}

        {st.backups.length > 0 && (
          <Card>
            <h2 className="clip-h2">{t("backup.passkey.yourBackups")}</h2>
            {st.backups.map((b) => (
              <Row
                key={b.id}
                label={t("backup.passkey.made", { date: fmtDate(b.createdAt) })}
                value={
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await p.backupDelete({ id: b.id });
                        status.reload();
                      } catch (e) {
                        setErr(userMessageOf(e));
                      }
                    }}
                  >
                    {t("common.delete")}
                  </Button>
                }
              />
            ))}
            {st.email && <p className="clip-hint">{t("backup.passkey.signedInAs", { email: st.email })}</p>}
          </Card>
        )}

        {showCreate ? (
          <>
            <PasskeyBackupExplainer />
            <label className="clip-check">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> {t("backup.passkey.understand")}
            </label>
            {understood && !st.signedIn && <BackupSignIn status={st} onSignedIn={() => status.reload()} />}
            {understood && st.signedIn && (
              <div className="clip-stack">
                <Field label={t("backup.passwordLabel")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <ErrorNote message={err} />
                <Button block onClick={create} disabled={busy || !password}>
                  <IconFingerprint /> {busy ? t("backup.waiting") : t("backup.passkey.create")}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="clip-stack">
            <ErrorNote message={err} />
            <Button block variant="secondary" onClick={() => setAdding(true)}>
              {t("backup.passkey.addAnother")}
            </Button>
            <Button
              block
              variant="ghost"
              onClick={async () => {
                await p.backupSignOut().catch(() => undefined);
                status.reload();
              }}
            >
              {t("backup.passkey.signOut")}
            </Button>
          </div>
        )}
      </div>
    </Screen>
  );
}

/** New device: restore a wallet from a passkey backup. Reached from onboarding ("Restore with a passkey"). */
export function PasskeyRestore(props: { onDone: () => void }) {
  const t = useUiT();
  const { client, passkeys, refresh } = useUi();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const strength = passwordStrength(password);

  if (status.loading && !status.data) return <Screen title={t("backup.restore.screen")} back><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen title={t("backup.restore.screen")} back><ErrorNote message={userMessageOf(status.error)} /></Screen>;

  const restore = async () => {
    setErr(null);
    if (!chosen) return;
    if (password !== confirm) return setErr(t("backup.passwordMismatch"));
    if (!passkeys) return setErr(t("backup.restore.noPasskeys"));
    if (!passkeys.canRunHere) {
      await client.openFullTab("/restore/passkey");
      return;
    }
    setBusy(true);
    try {
      await runCeremony(client, passkeys, () => p.passkeyRestoreBegin({ backupId: chosen, password }));
      setPassword("");
      setConfirm("");
      await refresh();
      props.onDone();
    } catch (e) {
      setErr(passkeyErrorText(e, t, userMessageOf));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t("backup.restore.screen")} back>
      <div className="clip-onboard">
        <h1 className="clip-h1">{t("backup.restore.title")}</h1>
        {!st.signedIn ? (
          <>
            <PasskeyBackupExplainer />
            <BackupSignIn status={st} onSignedIn={() => status.reload()} />
          </>
        ) : st.backups.length === 0 ? (
          <Empty title={t("backup.restore.noBackupsTitle")}>{t("backup.restore.noBackupsBody")}</Empty>
        ) : (
          <div className="clip-stack">
            <div className="clip-options" role="radiogroup" aria-label={t("backup.restore.backupsLabel")}>
              {st.backups.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen === b.id}
                  className={`clip-option ${chosen === b.id ? "is-selected" : ""}`}
                  onClick={() => setChosen(b.id)}
                >
                  <span className="clip-option__title">{t("backup.restore.backupFrom", { date: fmtDate(b.createdAt) })}</span>
                </button>
              ))}
            </div>
            {chosen && (
              <>
                <Field
                  label={t("backup.restore.newPassword")}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  hint={password ? t((strength.hintId ?? strength.labelId)!) : t("backup.restore.passwordHint")}
                />
                <Field label={t("backup.restore.again")} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <ErrorNote message={err} />
                <Button block onClick={restore} disabled={busy || !strength.acceptable || !confirm}>
                  <IconFingerprint /> {busy ? t("backup.waiting") : t("backup.restore.unlock")}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Screen>
  );
}

/** Full-tab landing for the emailed link (`#/backup/sign-in?token=…`): finishes sign-in on this device. */
export function BackupLinkLanding(props: { link: string }) {
  const t = useUiT();
  const { client } = useUi();
  const { navigate } = useRouter();
  const res = useAsync(() => asPlatform(client).backupCompleteSignIn({ link: props.link }), [props.link]);
  return (
    <Screen title={t("backup.passkey.screen")}>
      <div className="clip-onboard clip-onboard--welcome">
        {res.loading ? (
          <Spinner label={t("backup.signIn.landingLoading")} />
        ) : res.error ? (
          <ErrorNote message={userMessageOf(res.error)} />
        ) : (
          <>
            <h1 className="clip-h1">{t("backup.signIn.landingDone")}</h1>
            <Button block onClick={() => navigate("/backup/passkey", { replace: true })}>
              {t("common.continue")}
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
