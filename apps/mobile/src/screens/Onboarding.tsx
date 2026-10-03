/**
 * Onboarding: same flow and copy as the extension (packages/ui/src/screens/Onboarding.tsx): welcome →
 * password (strength meter) → phrase reveal → backup check → Face ID / Touch ID → done. Import goes
 * phrase → password → biometrics. The phrase lives only in this component's state, never stored.
 */
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, View } from "react-native";
import { passwordStrength, pickConfirmIndexes, userMessageOf } from "@clip-wallet/ui";
import { useWallet } from "../ui/context";
import { Button, ErrorNote, Field, Screen, T } from "../ui/kit";
import { IconFingerprint, IconShield } from "../ui/icons";
import { APP } from "../env";

type Step =
  | { s: "welcome" }
  | { s: "password"; flow: "create" | "import" }
  | { s: "phrase"; password: string; words: string[] }
  | { s: "confirm"; password: string; words: string[] }
  | { s: "import" }
  | { s: "biometrics"; password: string }
  | { s: "done" };

const ICON = require("../../assets/icon.png");

function StrengthMeter(props: { password: string }) {
  const { theme } = useWallet();
  const st = passwordStrength(props.password);
  const colors = ["", theme.c.dangerFg, theme.c.cautionFg, theme.c.positive, theme.c.positive];
  return (
    <View style={{ gap: 6 }} accessibilityLabel={`Password strength ${st.label || "empty"}`}>
      <View style={{ flexDirection: "row", gap: 4 }}>
        {[1, 2, 3, 4].map((i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: st.score >= i ? colors[st.score] : theme.c.border }} />
        ))}
      </View>
      {st.label ? <T v="hint" testID="strength">{`${st.label}${st.hint ? ` — ${st.hint}` : ""}`}</T> : null}
    </View>
  );
}

function Welcome(props: { onCreate: () => void; onImport: () => void }) {
  const { theme } = useWallet();
  return (
    <Screen
      footer={
        <>
          <Button block onPress={props.onCreate} testID="create">
            Create a new wallet
          </Button>
          <Button block variant="secondary" onPress={props.onImport} testID="import">
            I already have a recovery phrase
          </Button>
        </>
      }
    >
      <View style={{ alignItems: "center", gap: theme.s(4), paddingTop: 80 }}>
        <Image source={ICON} style={{ width: 72, height: 72, borderRadius: 18 }} accessibilityIgnoresInvertColors />
        <T v="display">{APP.config.name}</T>
        <T v="lede" style={{ textAlign: "center" }}>
          One place for your money, collectibles and apps. Test networks only for now.
        </T>
      </View>
    </Screen>
  );
}

function PasswordStep(props: { flow: "create" | "import"; onSubmit: (password: string) => Promise<void>; onBack: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const st = passwordStrength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const submit = async () => {
    if (!st.acceptable || pw !== pw2) return;
    setBusy(true);
    setErr(null);
    try {
      await props.onSubmit(pw);
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      back={props.onBack}
      footer={
        <Button block onPress={submit} disabled={!st.acceptable || pw !== pw2 || busy} testID="password-submit">
          {busy ? "Securing your wallet…" : props.flow === "create" ? "Create wallet" : "Import wallet"}
        </Button>
      }
    >
      <T v="h1">Choose a password</T>
      <T v="lede">It unlocks this wallet on this device. It can't be recovered, but your recovery phrase can always restore the wallet.</T>
      <Field label="Password" secureTextEntry textContentType="newPassword" autoComplete="new-password" value={pw} onChangeText={setPw} testID="password" autoFocus />
      <StrengthMeter password={pw} />
      <Field label="Type it again" secureTextEntry textContentType="newPassword" value={pw2} onChangeText={setPw2} testID="password2" error={mismatch ? "The passwords don't match." : null} onSubmitEditing={submit} />
      <ErrorNote message={err} />
    </Screen>
  );
}

function PhraseStep(props: { words: string[]; onNext: () => void }) {
  const { theme } = useWallet();
  const [shown, setShown] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <Screen
      footer={
        <Button block onPress={props.onNext} disabled={!shown || !saved} testID="phrase-continue">
          Continue
        </Button>
      }
    >
      <T v="h1">Your recovery phrase</T>
      <T v="lede">
        These {props.words.length} words are the only way to get your wallet back. Write them down in order and keep them offline. Anyone who has them can take everything.
      </T>
      <View accessibilityLabel="Recovery phrase" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, backgroundColor: theme.c.surface, borderRadius: theme.r.lg, padding: 12, borderWidth: 1, borderColor: theme.c.border }}>
        {props.words.map((w, i) => (
          <View key={i} style={{ width: "31%", flexDirection: "row", gap: 6, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: theme.c.surface2, borderRadius: theme.r.sm }}>
            <T v="hint">{i + 1}</T>
            <T testID={`word-${i}`} style={{ fontWeight: "600", fontSize: 15 }}>
              {shown ? w : "••••"}
            </T>
          </View>
        ))}
      </View>
      {!shown && (
        <Button block variant="secondary" onPress={() => setShown(true)} testID="reveal">
          Show my phrase
        </Button>
      )}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: saved, disabled: !shown }}
        disabled={!shown}
        onPress={() => setSaved((v) => !v)}
        testID="saved"
        style={{ flexDirection: "row", gap: 10, alignItems: "center", opacity: shown ? 1 : 0.5 }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: saved ? theme.c.accent : theme.c.border, backgroundColor: saved ? theme.c.accent : "transparent" }} />
        <T>I wrote these words down</T>
      </Pressable>
    </Screen>
  );
}

function ConfirmStep(props: { words: string[]; onConfirmed: () => void; onBack: () => void; indexes?: number[] }) {
  const indexes = useMemo(() => props.indexes ?? pickConfirmIndexes(props.words.length), [props.indexes, props.words.length]);
  const [answers, setAnswers] = useState<string[]>(indexes.map(() => ""));
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    const ok = indexes.every((idx, i) => answers[i]!.trim().toLowerCase() === props.words[idx]);
    if (ok) props.onConfirmed();
    else setErr("Those words don't match. Check your written copy and try again.");
  };
  return (
    <Screen
      back={props.onBack}
      footer={
        <Button block onPress={submit} disabled={answers.some((a) => !a.trim())} testID="confirm">
          Confirm
        </Button>
      }
    >
      <T v="h1">Check your backup</T>
      <T v="lede">Type the words at these positions.</T>
      {indexes.map((idx, i) => (
        <Field
          key={idx}
          label={`Word #${idx + 1}`}
          testID={`confirm-${i}`}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          value={answers[i]}
          onChangeText={(t) => setAnswers((a) => a.map((v, j) => (j === i ? t : v)))}
        />
      ))}
      <ErrorNote message={err} />
    </Screen>
  );
}

function ImportStep(props: { onNext: (phrase: string) => void; onBack: () => void }) {
  const [phrase, setPhrase] = useState("");
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const valid = [12, 15, 18, 21, 24].includes(words.length);
  return (
    <Screen
      back={props.onBack}
      footer={
        <Button block disabled={!valid} onPress={() => props.onNext(words.join(" "))} testID="import-continue">
          Continue
        </Button>
      }
    >
      <T v="h1">Import your wallet</T>
      <T v="lede">Enter your 12 or 24-word recovery phrase, separated by spaces.</T>
      <Field label="Recovery phrase" multiline numberOfLines={4} style={{ minHeight: 110, textAlignVertical: "top" }} autoCapitalize="none" autoComplete="off" spellCheck={false} secureTextEntry={false} value={phrase} onChangeText={setPhrase} testID="phrase-input" />
      <T v="hint">{words.length > 0 && !valid ? `${words.length} words so far` : " "}</T>
    </Screen>
  );
}

export function BiometricsStep(props: { password: string; onDone: () => void }) {
  const { wallet, theme } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("Face ID or Touch ID");
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void wallet.biometrics().then((b) => {
      setAvailable(b.available);
      if (b.available) setLabel(b.label);
      else setErr(b.reason ?? null);
    });
  }, [wallet]);
  return (
    <Screen
      footer={
        <>
          <Button
            block
            testID="biometrics-on"
            disabled={busy || available === false}
            onPress={async () => {
              setBusy(true);
              setErr(null);
              try {
                await wallet.enableBiometrics(props.password);
                props.onDone();
              } catch (e) {
                setErr(userMessageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {`Use ${label}`}
          </Button>
          <Button block variant="ghost" onPress={props.onDone} testID="biometrics-skip">
            Not now
          </Button>
        </>
      }
    >
      <View style={{ alignItems: "center", gap: theme.s(4), paddingTop: 48 }}>
        <View style={{ backgroundColor: theme.c.accentSoft, borderRadius: 40, padding: 18 }}>
          <IconFingerprint color={theme.c.accent} size={36} />
        </View>
        <T v="h1" style={{ textAlign: "center" }}>{`Unlock with ${label}?`}</T>
        <T v="lede" style={{ textAlign: "center" }}>
          Use your device instead of typing your password. Your password keeps working.
        </T>
      </View>
      <ErrorNote message={err} />
    </Screen>
  );
}

function Done(props: { onFinish: () => void }) {
  const { theme } = useWallet();
  return (
    <Screen
      footer={
        <Button block onPress={props.onFinish} testID="open-wallet">
          Open my wallet
        </Button>
      }
    >
      <View style={{ alignItems: "center", gap: theme.s(4), paddingTop: 80 }}>
        <View style={{ backgroundColor: theme.c.accentSoft, borderRadius: 40, padding: 18 }}>
          <IconShield color={theme.c.accent} size={36} />
        </View>
        <T v="h1">You're all set</T>
        <T v="lede" style={{ textAlign: "center" }}>{`${APP.config.name} is ready.`}</T>
      </View>
    </Screen>
  );
}

export function Onboarding(props: { onFinished: () => void; confirmIndexes?: number[] }) {
  const { client } = useWallet();
  const [step, setStep] = useState<Step>({ s: "welcome" });
  const [phraseForImport, setPhraseForImport] = useState("");

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
              setStep({ s: "biometrics", password });
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
          onConfirmed={() => setStep({ s: "biometrics", password: step.password })}
        />
      );
    case "biometrics":
      return <BiometricsStep password={step.password} onDone={() => setStep({ s: "done" })} />;
    case "done":
      return <Done onFinish={props.onFinished} />;
  }
}

export function Unlock(props: { onUnlocked: () => void }) {
  const { client, wallet, theme } = useWallet();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bio, setBio] = useState<{ label: string } | null>(null);
  const [passkey, setPasskey] = useState(false);
  useEffect(() => {
    void wallet.biometrics().then((b) => b.enrolled && setBio({ label: b.label }));
    void wallet.passkeys().then((p) => setPasskey(p.configured && p.enrolled));
  }, [wallet]);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      setPw("");
      props.onUnlocked();
    } catch (e) {
      setErr(userMessageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      footer={
        <>
          <Button block testID="unlock" disabled={!pw || busy} onPress={() => run(() => client.unlock(pw))}>
            Unlock
          </Button>
          {bio && (
            <Button block variant="secondary" testID="unlock-biometrics" disabled={busy} onPress={() => run(() => wallet.unlockWithBiometrics())}>
              <IconFingerprint color={theme.c.text} />
              <T>{`Unlock with ${bio.label}`}</T>
            </Button>
          )}
          {passkey && (
            <Button block variant="ghost" disabled={busy} onPress={() => run(() => wallet.unlockWithPasskey())}>
              Unlock with passkey
            </Button>
          )}
        </>
      }
    >
      <View style={{ alignItems: "center", gap: theme.s(4), paddingTop: 60 }}>
        <Image source={ICON} style={{ width: 60, height: 60, borderRadius: 15 }} />
        <T v="h1">Welcome back</T>
      </View>
      <Field label="Password" secureTextEntry textContentType="password" value={pw} onChangeText={setPw} testID="unlock-password" onSubmitEditing={() => pw && run(() => client.unlock(pw))} />
      <ErrorNote message={err} />
    </Screen>
  );
}
