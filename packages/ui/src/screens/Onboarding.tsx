import { useMemo, useState } from "react";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Button, ErrorNote, Field } from "../components";
import { IconFingerprint, IconShield } from "../components/icons";
import { passwordStrength } from "../lib/strength";
import { PasskeyEnroll } from "./Passkey";
import { runPasskeyCeremony } from "../lib/passkey";

type Step =
  | { s: "welcome" }
  | { s: "password"; flow: "create" | "import"; phrase?: string }
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

function Welcome(props: { onCreate: () => void; onImport: () => void }) {
  const { config } = useUi();
  return (
    <div className="clip-onboard clip-onboard--welcome">
      <img className="clip-brand-icon" src={config.icon} alt="" width={64} height={64} />
      <h1 className="clip-display">{config.name}</h1>
      <p className="clip-lede">One place for your money, collectibles and apps. Test networks only for now.</p>
      <div className="clip-stack">
        <Button block onClick={props.onCreate}>
          Create a new wallet
        </Button>
        <Button block variant="secondary" onClick={props.onImport}>
          I already have a recovery phrase
        </Button>
      </div>
    </div>
  );
}

function StrengthMeter(props: { password: string }) {
  const st = passwordStrength(props.password);
  return (
    <div className="clip-strength" aria-live="polite">
      <div className="clip-strength__bar" role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={4} aria-valuenow={st.score} aria-valuetext={st.label || "empty"}>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`clip-strength__seg ${st.score >= i ? `is-on s${st.score}` : ""}`} />
        ))}
      </div>
      {st.label && (
        <span className="clip-strength__label">
          {st.label}
          {st.hint ? ` — ${st.hint}` : ""}
        </span>
      )}
    </div>
  );
}

function PasswordStep(props: { flow: "create" | "import"; onSubmit: (password: string) => Promise<void>; onBack: () => void }) {
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
      <h1 className="clip-h1">Choose a password</h1>
      <p className="clip-lede">It unlocks this wallet on this device. It can't be recovered, but your recovery phrase can always restore the wallet.</p>
      <Field label="Password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <StrengthMeter password={pw} />
      <Field
        label="Type it again"
        type="password"
        autoComplete="new-password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        error={mismatch ? "The passwords don't match." : null}
      />
      <ErrorNote message={err} />
      <div className="clip-actions">
        <Button variant="secondary" onClick={props.onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!st.acceptable || pw !== pw2 || busy}>
          {props.flow === "create" ? "Create wallet" : "Import wallet"}
        </Button>
      </div>
    </form>
  );
}

function PhraseStep(props: { words: string[]; onNext: () => void }) {
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="clip-onboard">
      <h1 className="clip-h1">Your recovery phrase</h1>
      <p className="clip-lede">
        These {props.words.length} words are the only way to get your wallet back. Write them down in order and keep them offline. Anyone who has them can take everything.
      </p>
      <div className={`clip-phrase ${shown ? "" : "is-hidden"}`}>
        <ol aria-hidden={!shown} aria-label="Recovery phrase">
          {props.words.map((w, i) => (
            <li key={i}>
              <span className="clip-phrase__n">{i + 1}</span>
              <span className="clip-phrase__w">{shown ? w : "••••"}</span>
            </li>
          ))}
        </ol>
        {!shown && (
          <Button variant="secondary" className="clip-phrase__reveal" onClick={() => setShown(true)}>
            Show my phrase
          </Button>
        )}
      </div>
      <label className="clip-check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} disabled={!shown} />
        <span>I wrote these words down</span>
      </label>
      <Button block onClick={props.onNext} disabled={!shown || !saved}>
        Continue
      </Button>
    </div>
  );
}

function ConfirmStep(props: { words: string[]; onConfirmed: () => void; onBack: () => void; indexes?: number[] }) {
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
        else setErr("Those words don't match. Check your written copy and try again.");
      }}
    >
      <h1 className="clip-h1">Check your backup</h1>
      <p className="clip-lede">Type the words at these positions.</p>
      {indexes.map((idx, i) => (
        <Field
          key={idx}
          label={`Word #${idx + 1}`}
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
          Show phrase again
        </Button>
        <Button type="submit" disabled={answers.some((a) => !a.trim())}>
          Confirm
        </Button>
      </div>
    </form>
  );
}

function ImportStep(props: { onNext: (phrase: string) => void; onBack: () => void }) {
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
      <h1 className="clip-h1">Import your wallet</h1>
      <p className="clip-lede">Enter your 12 or 24-word recovery phrase, separated by spaces.</p>
      <label className="clip-field">
        <span className="clip-field__label">Recovery phrase</span>
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
      <p className="clip-hint">{words.length > 0 && !valid ? `${words.length} words so far` : " "}</p>
      <div className="clip-actions">
        <Button variant="secondary" onClick={props.onBack}>
          Back
        </Button>
        <Button type="submit" disabled={!valid}>
          Continue
        </Button>
      </div>
    </form>
  );
}

function Done(props: { onFinish: () => void }) {
  const { config } = useUi();
  return (
    <div className="clip-onboard clip-onboard--welcome">
      <span className="clip-done-badge" aria-hidden>
        <IconShield width={32} height={32} />
      </span>
      <h1 className="clip-h1">You're all set</h1>
      <p className="clip-lede">{config.name} is ready. Open it from your browser toolbar any time.</p>
      <Button block onClick={props.onFinish}>
        Open my wallet
      </Button>
    </div>
  );
}

export function Onboarding(props: { onFinished: () => void; confirmIndexes?: number[] }) {
  const { client } = useUi();
  const [step, setStep] = useState<Step>({ s: "welcome" });
  const [phraseForImport, setPhraseForImport] = useState<string>("");

  switch (step.s) {
    case "welcome":
      return <Welcome onCreate={() => setStep({ s: "password", flow: "create" })} onImport={() => setStep({ s: "import" })} />;
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
          onBack={() => setStep(step.flow === "create" ? { s: "welcome" } : { s: "import" })}
          onSubmit={async (password) => {
            if (step.flow === "create") {
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
          <h1 className="clip-h1">Unlock with Face ID or Touch ID?</h1>
          <p className="clip-lede">Use your device's passkey instead of typing your password. Your password keeps working.</p>
          <PasskeyEnroll password={step.password} onDone={() => setStep({ s: "done" })} skipLabel="Not now" />
        </div>
      );
    case "done":
      return <Done onFinish={props.onFinished} />;
  }
}

export function Unlock(props: { onUnlocked: () => void }) {
  const { client, config, state, passkeys } = useUi();
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
      setErr(userMessageOf(e));
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
      <img className="clip-brand-icon" src={config.icon} alt="" width={56} height={56} />
      <h1 className="clip-h1">Welcome back</h1>
      <Field label="Password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <ErrorNote message={err} />
      <Button block type="submit" disabled={!pw || busy}>
        Unlock
      </Button>
      {state?.passkey.enrolled && (
        <Button block variant="secondary" onClick={passkeyUnlock} disabled={busy}>
          <IconFingerprint /> Unlock with passkey
        </Button>
      )}
    </form>
  );
}
