import { useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, Card, Empty, ErrorNote, Field, Row, Screen, Spinner } from "../components";
import { IconFingerprint } from "../components/icons";
import { passwordStrength } from "../lib/strength";
import { asPlatform, type BackupStatusView } from "../platform/client";
import { runCeremony } from "../platform/ceremony";

/**
 * Passkey backup (services/backup) and restore on a new device.
 *
 * What we tell people, plainly: the locked copy is stored with us; the passkey is the key; the passkey syncs
 * through their Apple / Google / password-manager account, so whoever controls that account (and can pass its
 * Face ID / PIN) can restore the wallet once they also get into the email. The recovery phrase stays the
 * primary backup.
 */

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** The plain-words explanation shown before anyone opts in. Exported for the restore screen and tests. */
export function PasskeyBackupExplainer() {
  return (
    <div className="clip-stack" data-testid="passkey-backup-explainer">
      <p className="clip-lede">Your passkey can lock a copy of your recovery phrase so you can get your wallet back on a new device.</p>
      <ul className="clip-bullets">
        <li>We store only the locked copy. We can't open it, and neither can anyone who breaks into our servers.</li>
        <li>To restore, you need your email (to fetch the copy) and the passkey (to unlock it), on the new device.</li>
        <li>
          <strong>Your passkey syncs through your Apple, Google or password-manager account.</strong> Whoever controls that account
          and can pass its Face ID, fingerprint or PIN could restore this wallet if they also get into your email. Protect both.
        </li>
        <li>Keep your recovery phrase written down too. It works even if this service or your passkey is gone.</li>
      </ul>
    </div>
  );
}

/** Email sign-in by one-time link. The link only works on the device that asked for it. */
export function BackupSignIn(props: { status: BackupStatusView; onSignedIn: () => void }) {
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
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="We'll email you a sign-in link. No password." />
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
          {busy ? "Sending…" : "Email me a link"}
        </Button>
      </div>
    );
  }
  return (
    <div className="clip-stack">
      <p className="clip-lede">
        We sent a link to <strong>{sentTo}</strong>. Open it on this device, or paste it here. It works once, for 15 minutes.
      </p>
      <Field label="Link from the email" autoComplete="off" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} />
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
        {busy ? "Checking…" : "Continue"}
      </Button>
      <Button block variant="ghost" disabled={busy} onClick={() => setSentTo(undefined)}>
        Use a different email
      </Button>
    </div>
  );
}

/** Settings → "Back up with your passkey". */
export function PasskeyBackup() {
  const { client, passkeys } = useUi();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const [understood, setUnderstood] = useState(false);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (status.loading && !status.data) return <Screen title="Passkey backup" back><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen title="Passkey backup" back><ErrorNote message={userMessageOf(status.error)} /></Screen>;
  if (!st.available) {
    return (
      <Screen title="Passkey backup" back>
        <Empty title="Passkey backup isn't available in this version">Your recovery phrase is your backup.</Empty>
      </Screen>
    );
  }

  const create = async () => {
    setErr(null);
    if (!passkeys) return setErr("Passkeys aren't available in this browser. Your recovery phrase is still your backup.");
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
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const showCreate = adding || st.backups.length === 0;
  return (
    <Screen title="Passkey backup" back>
      <div className="clip-onboard">
        <span className="clip-done-badge" aria-hidden>
          <IconFingerprint width={28} height={28} />
        </span>
        <h1 className="clip-h1">Back up with your passkey</h1>
        {done && (
          <div className="clip-notice clip-notice--info" role="status">
            <span>Backed up. You can restore on a new device with your email and this passkey.</span>
          </div>
        )}

        {st.backups.length > 0 && (
          <Card>
            <h2 className="clip-h2">Your backups</h2>
            {st.backups.map((b) => (
              <Row
                key={b.id}
                label={`Made ${fmtDate(b.createdAt)}`}
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
                    Delete
                  </Button>
                }
              />
            ))}
            {st.email && <p className="clip-hint">Signed in as {st.email}</p>}
          </Card>
        )}

        {showCreate ? (
          <>
            <PasskeyBackupExplainer />
            <label className="clip-check">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand who can restore my wallet
            </label>
            {understood && !st.signedIn && <BackupSignIn status={st} onSignedIn={() => status.reload()} />}
            {understood && st.signedIn && (
              <div className="clip-stack">
                <Field label="Your wallet password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <ErrorNote message={err} />
                <Button block onClick={create} disabled={busy || !password}>
                  <IconFingerprint /> {busy ? "Waiting for your device…" : "Create backup passkey"}
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="clip-stack">
            <ErrorNote message={err} />
            <Button block variant="secondary" onClick={() => setAdding(true)}>
              Add another backup
            </Button>
            <Button
              block
              variant="ghost"
              onClick={async () => {
                await p.backupSignOut().catch(() => undefined);
                status.reload();
              }}
            >
              Sign out of backups
            </Button>
          </div>
        )}
      </div>
    </Screen>
  );
}

/** New device: restore a wallet from a passkey backup. Reached from onboarding ("Restore with a passkey"). */
export function PasskeyRestore(props: { onDone: () => void }) {
  const { client, passkeys, refresh } = useUi();
  const p = asPlatform(client);
  const status = useAsync(() => p.backupStatus(), []);
  const [chosen, setChosen] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const strength = passwordStrength(password);

  if (status.loading && !status.data) return <Screen title="Restore" back><Spinner /></Screen>;
  const st = status.data;
  if (!st) return <Screen title="Restore" back><ErrorNote message={userMessageOf(status.error)} /></Screen>;

  const restore = async () => {
    setErr(null);
    if (!chosen) return;
    if (password !== confirm) return setErr("The passwords don't match.");
    if (!passkeys) return setErr("Passkeys aren't available in this browser. Use your recovery phrase instead.");
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
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Restore" back>
      <div className="clip-onboard">
        <h1 className="clip-h1">Restore with your passkey</h1>
        {!st.signedIn ? (
          <>
            <PasskeyBackupExplainer />
            <BackupSignIn status={st} onSignedIn={() => status.reload()} />
          </>
        ) : st.backups.length === 0 ? (
          <Empty title="No backups for this email">Use your recovery phrase instead, or sign in with another email.</Empty>
        ) : (
          <div className="clip-stack">
            <div className="clip-options" role="radiogroup" aria-label="Backups">
              {st.backups.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={chosen === b.id}
                  className={`clip-option ${chosen === b.id ? "is-selected" : ""}`}
                  onClick={() => setChosen(b.id)}
                >
                  <span className="clip-option__title">Backup from {fmtDate(b.createdAt)}</span>
                </button>
              ))}
            </div>
            {chosen && (
              <>
                <Field label="New password for this device" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint={password ? (strength.hint ?? strength.label) : "At least 8 characters."} />
                <Field label="Type it again" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                <ErrorNote message={err} />
                <Button block onClick={restore} disabled={busy || !strength.acceptable || !confirm}>
                  <IconFingerprint /> {busy ? "Waiting for your device…" : "Unlock with passkey"}
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
  const { client } = useUi();
  const { navigate } = useRouter();
  const res = useAsync(() => asPlatform(client).backupCompleteSignIn({ link: props.link }), [props.link]);
  return (
    <Screen title="Passkey backup">
      <div className="clip-onboard clip-onboard--welcome">
        {res.loading ? (
          <Spinner label="Signing in" />
        ) : res.error ? (
          <ErrorNote message={userMessageOf(res.error)} />
        ) : (
          <>
            <h1 className="clip-h1">You're signed in</h1>
            <Button block onClick={() => navigate("/backup/passkey", { replace: true })}>
              Continue
            </Button>
          </>
        )}
      </div>
    </Screen>
  );
}
