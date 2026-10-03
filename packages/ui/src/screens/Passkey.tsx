import { useState } from "react";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Button, ErrorNote, Field, Screen } from "../components";
import { IconFingerprint } from "../components/icons";
import { passkeyErrorText, runPasskeyCeremony } from "../lib/passkey";
import { useUiT } from "../i18n";

/**
 * Enrols a passkey for unlock. The vault re-authenticates with the password. The WebAuthn ceremony needs
 * a page that keeps focus while the OS sheet is up: a full extension tab (or the web bridge), so in the
 * action popup we hand off to a tab.
 */
export function PasskeyEnroll(props: { password?: string; onDone: (enrolled: boolean) => void; skipLabel?: string }) {
  const t = useUiT();
  const { client, passkeys, refresh } = useUi();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const password = props.password ?? pw;

  const run = async () => {
    setErr(null);
    if (!passkeys) {
      setErr(t("onboarding.passkey.unavailable"));
      return;
    }
    if (!passkeys.canRunHere) {
      await client.openFullTab("/passkey/enroll");
      props.onDone(false);
      return;
    }
    setBusy(true);
    try {
      await runPasskeyCeremony(client, passkeys, { op: "enroll", password });
      setPw("");
      await refresh();
      props.onDone(true);
    } catch (e) {
      setErr(passkeyErrorText(e, t, userMessageOf));
    } finally {
      setBusy(false);
    }
  };

  const needsPassword = props.password === undefined && passkeys?.canRunHere;
  return (
    <div className="clip-stack">
      {needsPassword && (
        <Field label={t("onboarding.passkey.passwordLabel")} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      )}
      <ErrorNote message={err} />
      <Button block onClick={run} disabled={busy || (needsPassword && !pw)}>
        <IconFingerprint /> {busy ? t("onboarding.passkey.waiting") : t("onboarding.passkey.use")}
      </Button>
      <Button block variant="ghost" onClick={() => props.onDone(false)} disabled={busy}>
        {props.skipLabel ?? t("common.cancel")}
      </Button>
    </div>
  );
}

/** Full-tab route used when the popup hands a ceremony off (/passkey/enroll, /passkey/unlock). */
export function PasskeyPage(props: { mode: "enroll" | "unlock"; onDone: () => void }) {
  const t = useUiT();
  const { client, config, passkeys } = useUi();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  if (props.mode === "enroll") {
    return (
      <Screen title={t("onboarding.passkey.enrollScreen")}>
        <div className="clip-onboard">
          <h1 className="clip-h1">{t("onboarding.passkey.enrollTitle")}</h1>
          <p className="clip-lede">{t("onboarding.passkey.enrollLede", { name: config.name })}</p>
          <PasskeyEnroll onDone={() => props.onDone()} />
        </div>
      </Screen>
    );
  }

  const unlock = async () => {
    if (!passkeys) return;
    setBusy(true);
    setErr(null);
    try {
      await runPasskeyCeremony(client, passkeys, { op: "unlock" });
      setOk(true);
      props.onDone();
    } catch (e) {
      setErr(passkeyErrorText(e, t, userMessageOf));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t("onboarding.passkey.unlockScreen")}>
      <div className="clip-onboard clip-onboard--welcome">
        <span className="clip-done-badge" aria-hidden>
          <IconFingerprint width={32} height={32} />
        </span>
        <h1 className="clip-h1">{ok ? t("onboarding.passkey.unlocked") : t("onboarding.passkey.unlockTitle")}</h1>
        <ErrorNote message={err} />
        {!ok && (
          <Button block onClick={unlock} disabled={busy || !passkeys}>
            {busy ? t("onboarding.passkey.waiting") : t("common.continue")}
          </Button>
        )}
      </div>
    </Screen>
  );
}
