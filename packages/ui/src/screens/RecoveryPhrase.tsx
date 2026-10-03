import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { userMessageOf } from "../client";
import { useUi } from "../context";
import { Button, ErrorNote, Field, Screen, Toggle } from "../components";
import { IconShield } from "../components/icons";
import { asPlatform } from "../platform/client";
import { useUiT } from "../i18n";

/**
 * Settings → "Recovery phrase". Rules:
 *  - The phrase is fetched only after the password is typed again (the vault checks it).
 *  - While hidden, the words are NOT in the DOM (not blurred text: absent). They appear only while the
 *    reveal button is held, or after it's clicked, and hide again on blur / tab switch / after 60 s.
 *  - Copying is off by default (no copy button, selection disabled, copy events cancelled). Advanced users
 *    can turn it on for this view, with a warning.
 *  - "I've written it down" asks for three words; the phrase is dropped from memory when this screen closes.
 */

const AUTO_HIDE_MS = 60_000;
const HOLD_MS = 300;

/** Picks `n` distinct positions (0-based), sorted. */
export function quizPositions(count: number, n = 3, rand: () => number = Math.random): number[] {
  const set = new Set<number>();
  while (set.size < Math.min(n, count)) set.add(Math.floor(rand() * count));
  return [...set].sort((a, b) => a - b);
}

function PhraseGrid(props: { words: string[] | null; count: number; allowCopy: boolean }) {
  const t = useUiT();
  const block = (e: ClipboardEvent) => {
    if (!props.allowCopy) e.preventDefault();
  };
  return (
    <div
      className={`clip-phrase ${props.words ? "" : "is-hidden"}`}
      data-testid="phrase-grid"
      onCopy={block}
      onCut={block}
      onContextMenu={(e) => !props.allowCopy && e.preventDefault()}
      style={props.allowCopy ? undefined : { userSelect: "none", WebkitUserSelect: "none" }}
    >
      <ol aria-label={t("backup.phrase.listLabel")} aria-hidden={!props.words}>
        {Array.from({ length: props.count }, (_, i) => (
          <li key={i}>
            <span className="clip-phrase__n">{i + 1}</span>
            {/* Hidden: a fixed placeholder, so the words are never in the page while hidden. */}
            <span className="clip-phrase__w">{props.words ? props.words[i] : "••••••"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Quiz(props: { words: string[]; positions?: number[]; onPass: () => void; onBack: () => void }) {
  const t = useUiT();
  const positions = useMemo(() => props.positions ?? quizPositions(props.words.length), [props.positions, props.words.length]);
  const [answers, setAnswers] = useState<string[]>(() => positions.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  const check = () => {
    const ok = positions.every((p, i) => answers[i]!.trim().toLowerCase() === props.words[p]);
    if (ok) props.onPass();
    else setErr(t("backup.phrase.quizMismatch"));
  };
  return (
    <div className="clip-stack">
      <h2 className="clip-h2">{t("backup.phrase.quizTitle")}</h2>
      <p className="clip-lede">{t("backup.phrase.quizLede")}</p>
      {positions.map((p, i) => (
        <Field
          key={p}
          label={t("backup.phrase.quizWord", { n: p + 1 })}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={answers[i]}
          onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <ErrorNote message={err} />
      <Button block onClick={check} disabled={answers.some((a) => !a.trim())}>
        {t("backup.phrase.quizCheck")}
      </Button>
      <Button block variant="ghost" onClick={props.onBack}>
        {t("backup.phrase.showAgain")}
      </Button>
    </div>
  );
}

export function RecoveryPhraseBackup(props: { onDone?: () => void; quizPositions?: number[] }) {
  const t = useUiT();
  const { client, state } = useUi();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** The phrase lives in a ref (not state) so it isn't rendered unless `shown`. */
  const phrase = useRef<string[] | null>(null);
  const [count, setCount] = useState(0);
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);
  const [step, setStep] = useState<"password" | "phrase" | "quiz" | "done">("password");
  const [allowCopy, setAllowCopy] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the pointer went down; a press longer than HOLD_MS is a hold, and its click is ignored. */
  const pressedAt = useRef(0);

  const hide = useCallback(() => {
    setShown(false);
    setHeld(false);
  }, []);

  // Hide on blur / tab switch; drop the phrase when the screen goes away.
  useEffect(() => {
    const onVis = () => document.visibilityState !== "visible" && hide();
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVis);
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

  const visible = (shown || held) && phrase.current ? phrase.current : null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setShown((s) => !s);
    }
  };

  if (step === "password") {
    return (
      <Screen title={t("backup.phrase.screen")} back>
        <div className="clip-onboard">
          <span className="clip-done-badge" aria-hidden>
            <IconShield width={28} height={28} />
          </span>
          <h1 className="clip-h1">{t("backup.phrase.introTitle")}</h1>
          <p className="clip-lede">{t("backup.phrase.introLede")}</p>
          <Field
            label={t("backup.passwordLabel")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && password && void unlock()}
          />
          <ErrorNote message={err} />
          <Button block onClick={unlock} disabled={busy || !password || state?.status !== "unlocked"}>
            {busy ? t("backup.phrase.checking") : t("common.continue")}
          </Button>
        </div>
      </Screen>
    );
  }

  if (step === "quiz" && phrase.current) {
    return (
      <Screen title={t("backup.phrase.screen")} back={() => setStep("phrase")}>
        <div className="clip-onboard">
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
        </div>
      </Screen>
    );
  }

  if (step === "done") {
    return (
      <Screen title={t("backup.phrase.screen")} back>
        <div className="clip-onboard clip-onboard--welcome">
          <h1 className="clip-h1">{t("backup.phrase.doneTitle")}</h1>
          <p className="clip-lede">{t("backup.phrase.doneLede")}</p>
          <Button block onClick={() => props.onDone?.()}>
            {t("common.done")}
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={t("backup.phrase.screen")} back>
      <div className="clip-onboard">
        <h1 className="clip-h1">{t("backup.phrase.title")}</h1>
        <p className="clip-lede">{t("backup.phrase.lede")}</p>
        <PhraseGrid words={visible} count={count} allowCopy={allowCopy} />
        <Button
          variant="secondary"
          block
          aria-pressed={shown}
          onPointerDown={() => {
            pressedAt.current = Date.now();
            setHeld(true);
          }}
          onPointerUp={() => setHeld(false)}
          onPointerLeave={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
          onClick={() => {
            const wasHold = pressedAt.current && Date.now() - pressedAt.current > HOLD_MS;
            pressedAt.current = 0;
            if (!wasHold) setShown((v) => !v);
          }}
          onKeyDown={onKey}
        >
          {shown ? t("backup.phrase.hide") : t("backup.phrase.reveal")}
        </Button>
        <Toggle
          label={t("backup.phrase.allowCopy")}
          description={t("backup.phrase.allowCopyHint")}
          checked={allowCopy}
          onChange={setAllowCopy}
        />
        <Button
          block
          onClick={() => {
            hide();
            setStep("quiz");
          }}
        >
          {t("backup.phrase.writtenDown")}
        </Button>
      </div>
    </Screen>
  );
}
