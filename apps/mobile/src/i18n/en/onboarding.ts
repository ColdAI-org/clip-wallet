/** Namespace "m.onboarding" (mobile): create / import / unlock. */
export default {
  /** Accessibility label of the strength meter; {level} is one of the strength words below, or m.onboarding.strength.empty. */
  "m.onboarding.strength.a11y": "Password strength {level}",
  "m.onboarding.strength.empty": "empty",
  "m.onboarding.strength.tooCommon": "Too common",
  "m.onboarding.strength.tooCommon.hint": "Avoid well-known words and number runs.",
  "m.onboarding.strength.tooShort": "Too short",
  "m.onboarding.strength.tooShort.hint": "Use at least 8 characters.",
  "m.onboarding.strength.okay": "Okay",
  "m.onboarding.strength.okay.hint": "Longer is better — try a few unrelated words.",
  "m.onboarding.strength.good": "Good",
  "m.onboarding.strength.strong": "Strong",
  "m.onboarding.strength.withHint": "{label} — {hint}",

  "m.onboarding.welcome.lede": "One place for your money, collectibles and apps. Test networks only for now.",
  "m.onboarding.welcome.create": "Create a new wallet",
  "m.onboarding.welcome.import": "I already have a recovery phrase",

  "m.onboarding.password.title": "Choose a password",
  "m.onboarding.password.lede": "It unlocks this wallet on this device. It can't be recovered, but your recovery phrase can always restore the wallet.",
  "m.onboarding.password.label": "Password",
  "m.onboarding.password.again": "Type it again",
  "m.onboarding.password.mismatch": "The passwords don't match.",
  "m.onboarding.password.busy": "Securing your wallet…",
  "m.onboarding.password.create": "Create wallet",
  "m.onboarding.password.import": "Import wallet",

  "m.onboarding.phrase.title": "Your recovery phrase",
  "m.onboarding.phrase.lede":
    "{n, plural, one {This word is the only way to get your wallet back. Write it down and keep it offline. Anyone who has it can take everything.} other {These # words are the only way to get your wallet back. Write them down in order and keep them offline. Anyone who has them can take everything.}}",
  "m.onboarding.phrase.a11y": "Recovery phrase",
  "m.onboarding.phrase.reveal": "Show my phrase",
  "m.onboarding.phrase.saved": "I wrote these words down",

  "m.onboarding.confirm.title": "Check your backup",
  "m.onboarding.confirm.lede": "Type the words at these positions.",
  "m.onboarding.confirm.word": "Word #{n}",
  "m.onboarding.confirm.button": "Confirm",
  "m.onboarding.confirm.mismatch": "Those words don't match. Check your written copy and try again.",

  "m.onboarding.import.title": "Import your wallet",
  "m.onboarding.import.lede": "Enter your 12 or 24-word recovery phrase, separated by spaces.",
  "m.onboarding.import.label": "Recovery phrase",
  "m.onboarding.import.count": "{n, plural, one {# word so far} other {# words so far}}",

  /** Shown before the OS reports its biometric name; {face} and {touch} are "Face ID" and "Touch ID" (not translated). */
  "m.onboarding.biometrics.either": "{face} or {touch}",
  /** {label} is the OS biometric name, e.g. "Face ID". */
  "m.onboarding.biometrics.use": "Use {label}",
  "m.onboarding.biometrics.notNow": "Not now",
  "m.onboarding.biometrics.title": "Unlock with {label}?",
  "m.onboarding.biometrics.lede": "Use your device instead of typing your password. Your password keeps working.",

  "m.onboarding.done.title": "You're all set",
  "m.onboarding.done.lede": "{name} is ready.",
  "m.onboarding.done.open": "Open my wallet",

  "m.onboarding.unlock.title": "Welcome back",
  "m.onboarding.unlock.button": "Unlock",
  "m.onboarding.unlock.biometrics": "Unlock with {label}",
  "m.onboarding.unlock.passkey": "Unlock with passkey",
} satisfies Record<`m.onboarding.${string}`, string>;
