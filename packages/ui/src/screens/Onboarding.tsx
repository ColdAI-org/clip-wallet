import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useAsync, useRouter, useUi } from "../context";
import { Button, ErrorNote, Field } from "../components";
import { IconFingerprint, IconShield } from "../components/icons";
import { passwordStrength } from "../lib/strength";
import { PasskeyEnroll } from "./Passkey";
import { passkeyErrorText, runPasskeyCeremony } from "../lib/passkey";
import { ConnectHardware } from "../hardware/ConnectHardware";
import { useHardwareOptional } from "../hardware/context";
import { useUiT } from "../i18n";
import { useLinkOptional } from "../link/context";

type Step =
  | { s: "welcome" }
  | { s: "password"; flow: "create" | "import" | "hardware"; phrase?: string }
  /** "Connect a hardware wallet": a phrase wallet is still created (back it up later in Settings → Backup). */
  | { s: "hardware" }
  | { s: "phrase"; password: string; words: string[] }
  | { s: "confirm"; password: string; words: string[] }
  | { s: "import" }
  /** The vault re-authenticates passkey enrolment with the password, so it is held until this step ends. */
  | { s: "passkey"; password: string }
  | { s: "done" };

/** Picks three distinct word positions (1-based) for the backup check. */
export function pickConfirmIndexes(count: number, rand: () => number = Math.random): number[] {
  const set = new Set<number>();
  while (set.size < Math.min(3, count)) set.add(Math.floor(rand() * count));
  return [...set].sort((a, b) => a - b);
}

function Welcome(props: { onCreate: () => void; onImport: () => void; onHardware?: () => void }) {
  const t = useUiT();
  const { config, options, client } = useUi();
  const { navigate } = useRouter();
  // Offered only when this build has a backup service (services/backup); otherwise there's nothing to restore from.
  const backup = useAsync(async () => (typeof client.backupStatus === "function" ? (await client.backupStatus()).available : false), [client]);
  const linkClient = useLinkOptional();
  return (
    <div className="clip-onboard clip-onboard--welcome">
      <img className="clip-brand-icon" src={options.iconUrl} alt="" width={64} height={64} />
      <h1 className="clip-display">{config.name}</h1>
      <p className="clip-lede">{t("onboarding.welcome.lede")}</p>
      <div className="clip-stack">
        <Button block onClick={props.onCreate}>
          {t("onboarding.welcome.create")}
        </Button>
        <Button block variant="secondary" onClick={props.onImport}>
          {t("onboarding.welcome.import")}
        </Button>
        {props.onHardware && (
          <Button block variant="ghost" onClick={props.onHardware}>
            {t("onboarding.welcome.hardware")}
          </Button>
        )}
        {linkClient && (
          <Button block variant="ghost" onClick={() => navigate("/link/receive")}>
            {t("link.action.receive")}
          </Button>
        )}
        {backup.data && (
          <Button block variant="ghost" onClick={() => navigate("/restore/passkey")}>
            {t("onboarding.welcome.restorePasskey")}
          </Button>
        )}
      </div>
    </div>
  );
}

function StrengthMeter(props: { password: string }) {
  const t = useUiT();
  const st = passwordStrength(props.password);
  const label = st.labelId ? t(st.labelId) : "";
  const hint = st.hintId ? t(st.hintId) : "";
  return (
    <div className="clip-strength" aria-live="polite">
      <div className="clip-strength__bar" role="meter" aria-label={t("onboarding.strength.meter")} aria-valuemin={0} aria-valuemax={4} aria-valuenow={st.score} aria-valuetext={label || t("onboarding.strength.empty")}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`clip-strength__seg ${st.score >= i ? `is-on s${st.score}` : ""}`} />
        ))}
      </div>
      {label && <span className="clip-strength__label">{hint ? t("onboarding.strength.labelWithHint", { label, hint }) : label}</span>}
    </div>
  );
}

function PasswordStep(props: { flow: "create" | "import" | "hardware"; onSubmit: (password: string) => Promise<void>; onBack: () => void }) {
  const t = useUiT();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const st = passwordStrength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <form
      className="clip-onboard"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!st.acceptable || pw !== pw2) return;
        setBusy(true);
        setErr(null);
        try {
          await props.onSubmit(pw);
        } catch (e2) {
          setErr(userMessageOf(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="clip-h1">{t("onboarding.password.title")}</h1>
      <p className="clip-lede">{t("onboarding.password.lede")}</p>
      <Field label={t("onboarding.password.label")} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <StrengthMeter password={pw} />
      <Field
        label={t("onboarding.password.again")}
        type="password"
        autoComplete="new-password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        error={mismatch ? t("onboarding.password.mismatch") : null}
      />
      <ErrorNote message={err} />
      <div className="clip-actions">
        <Button variant="secondary" onClick={props.onBack}>
          {t("common.back")}
        </Button>
        <Button type="submit" disabled={!st.acceptable || pw !== pw2 || busy}>
          {props.flow === "import" ? t("onboarding.password.importWallet") : t("onboarding.password.createWallet")}
        </Button>
      </div>
    </form>
  );
}

function PhraseStep(props: { words: string[]; onNext: () => void }) {
  const t = useUiT();
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="clip-onboard">
      <h1 className="clip-h1">{t("onboarding.phrase.title")}</h1>
      <p className="clip-lede">{t("onboarding.phrase.lede", { count: props.words.length })}</p>
      <div className={`clip-phrase ${shown ? "" : "is-hidden"}`}>
        <ol aria-hidden={!shown} aria-label={t("onboarding.phrase.listLabel")}>
          {props.words.map((w, i) => (
            <li key={i}>
              <span className="clip-phrase__n">{i + 1}</span>
              <span className="clip-phrase__w">{shown ? w : "••••"}</span>
            </li>
          ))}
        </ol>
        {!shown && (
          <Button variant="secondary" className="clip-phrase__reveal" onClick={() => setShown(true)}>
            {t("onboarding.phrase.show")}
          </Button>
        )}
      </div>
      <label className="clip-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={!shown} />
        <span>{t("onboarding.phrase.saved")}</span>
      </label>
      <Button block onClick={props.onNext} disabled={!shown || !saved}>
        {t("common.continue")}
      </Button>
    </div>
  );
}

function ConfirmStep(props: { words: string[]; onConfirmed: () => void; onBack: () => void; indexes?: number[] }) {
  const t = useUiT();
  const indexes = useMemo(() => props.indexes ?? pickConfirmIndexes(props.words.length), [props.indexes, props.words.length]);
  const [answers, setAnswers] = useState<string[]>(indexes.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="clip-onboard"
      onSubmit={(e) => {
        e.preventDefault();
        const ok = indexes.every((idx, i) => answers[i]!.trim().toLowerCase() === props.words[idx]);
        if (ok) props.onConfirmed();
        else setErr(t("onboarding.confirm.mismatch"));
      }}
    >
      <h1 className="clip-h1">{t("onboarding.confirm.title")}</h1>
      <p className="clip-lede">{t("onboarding.confirm.lede")}</p>
      {indexes.map((idx, i) => (
        <Field
          key={idx}
          label={t("onboarding.confirm.word", { n: idx + 1 })}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={answers[i]}
          onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
          autoFocus={i === 0}
        />
      ))}
      <ErrorNote message={err} />
      <div className="clip-actions">
        <Button variant="secondary" onClick={props.onBack}>
          {t("onboarding.confirm.showAgain")}
        </Button>
        <Button type="submit" disabled={answers.some((a) => !a.trim())}>
          {t("onboarding.confirm.submit")}
        </Button>
      </div>
    </form>
  );
}

function ImportStep(props: { onNext: (phrase: string) => void; onBack: () => void }) {
  const t = useUiT();
  const [phrase, setPhrase] = useState("");
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const valid = [12, 15, 18, 21, 24].includes(words.length);
  return (
    <form
      className="clip-onboard"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) props.onNext(words.join(" "));
      }}
    >
      <h1 className="clip-h1">{t("onboarding.import.title")}</h1>
      <p className="clip-lede">{t("onboarding.import.lede")}</p>
      <label className="clip-field">
        <span className="clip-field__label">{t("onboarding.import.label")}</span>
        <textarea
          className="clip-textarea"
          rows={4}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
      </label>
      <p className="clip-hint">{words.length > 0 && !valid ? t("onboarding.import.wordCount", { n: words.length }) : " "}</p>
      <div className="clip-actions">
        <Button variant="secondary" onClick={props.onBack}>
          {t("common.back")}
        </Button>
        <Button type="submit" disabled={!valid}>
          {t("common.continue")}
        </Button>
      </div>
    </form>
  );
}

function Done(props: { onFinish: () => void }) {
  const t = useUiT();
  const { config } = useUi();
  return (
    <div className="clip-onboard clip-onboard--welcome">
      <span className="clip-done-badge" aria-hidden>
        <IconShield width={32} height={32} />
      </span>
      <h1 className="clip-h1">{t("onboarding.done.title")}</h1>
      <p className="clip-lede">{t("onboarding.done.lede", { name: config.name })}</p>
      <Button block onClick={props.onFinish}>
        {t("onboarding.done.open")}
      </Button>
    </div>
  );
}

export function Onboarding(props: { onFinished: () => void; confirmIndexes?: number[] }) {
  const t = useUiT();
  const { client } = useUi();
  const hardware = useHardwareOptional();
  const [step, setStep] = useState<Step>({ s: "welcome" });
  const [phraseForImport, setPhraseForImport] = useState<string>("");

  switch (step.s) {
    case "welcome":
      return (
        <Welcome
          onCreate={() => setStep({ s: "password", flow: "create" })}
          onImport={() => setStep({ s: "import" })}
          {...(hardware ? { onHardware: () => setStep({ s: "password", flow: "hardware" }) } : {})}
        />
      );
    case "hardware":
      return hardware ? <ConnectHardware hardware={hardware} onDone={() => setStep({ s: "done" })} onBack={() => setStep({ s: "done" })} /> : <Done onFinish={props.onFinished} />;
    case "import":
      return (
        <ImportStep
          onBack={() => setStep({ s: "welcome" })}
          onNext={(p) => {
            setPhraseForImport(p);
            setStep({ s: "password", flow: "import" });
          }}
        />
      );
    case "password":
      return (
        <PasswordStep
          flow={step.flow}
          onBack={() => setStep(step.flow === "import" ? { s: "import" } : { s: "welcome" })}
          onSubmit={async (password) => {
            if (step.flow === "hardware") {
              await client.createWallet(password);
              setStep({ s: "hardware" });
            } else if (step.flow === "create") {
              await client.createWallet(password);
              const phrase = await client.revealPhrase(password);
              setStep({ s: "phrase", password, words: phrase.split(" ") });
            } else {
              await client.importWallet(phraseForImport, password);
              setPhraseForImport("");
              setStep({ s: "passkey", password });
            }
          }}
        />
      );
    case "phrase":
      return <PhraseStep words={step.words} onNext={() => setStep({ s: "confirm", password: step.password, words: step.words })} />;
    case "confirm":
      return (
        <ConfirmStep
          words={step.words}
          indexes={props.confirmIndexes}
          onBack={() => setStep({ s: "phrase", password: step.password, words: step.words })}
          // The phrase leaves component state here; it is never stored anywhere in the UI.
          onConfirmed={() => setStep({ s: "passkey", password: step.password })}
        />
      );
    case "passkey":
      return (
        <div className="clip-onboard">
          <span className="clip-done-badge" aria-hidden>
            <IconFingerprint width={32} height={32} />
          </span>
          <h1 className="clip-h1">{t("onboarding.passkeyOffer.title")}</h1>
          <p className="clip-lede">{t("onboarding.passkeyOffer.lede")}</p>
          <PasskeyEnroll password={step.password} onDone={() => setStep({ s: "done" })} skipLabel={t("onboarding.passkeyOffer.notNow")} />
        </div>
      );
    case "done":
      return <Done onFinish={props.onFinished} />;
  }
}

export function Unlock(props: { onUnlocked: () => void }) {
  const t = useUiT();
  const { client, options, state, passkeys } = useUi();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passkeyUnlock = async () => {
    setErr(null);
    if (!passkeys?.canRunHere) {
      await client.openFullTab("/passkey/unlock");
      window.close();
      return;
    }
    setBusy(true);
    try {
      await runPasskeyCeremony(client, passkeys, { op: "unlock" });
      props.onUnlocked();
    } catch (e) {
      setErr(passkeyErrorText(e, t, userMessageOf));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="clip-onboard clip-onboard--welcome"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await client.unlock(pw);
          setPw("");
          props.onUnlocked();
        } catch (e2) {
          setErr(userMessageOf(e2));
        } finally {
          setBusy(false);
        }
      }}
    >
      <img className="clip-brand-icon" src={options.iconUrl} alt="" width={56} height={56} />
      <h1 className="clip-h1">{t("onboarding.unlock.title")}</h1>
      <Field label={t("onboarding.password.label")} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <ErrorNote message={err} />
      <Button block type="submit" disabled={!pw || busy}>
        {t("onboarding.unlock.submit")}
      </Button>
      {state?.passkey.enrolled && (
        <Button block variant="secondary" onClick={passkeyUnlock} disabled={busy}>
          <IconFingerprint /> {t("onboarding.unlock.withPasskey")}
        </Button>
      )}
    </form>
  );
}
