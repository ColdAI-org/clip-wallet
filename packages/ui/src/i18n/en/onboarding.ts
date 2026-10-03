/** Namespace "onboarding": first run (Onboarding), Unlock, passkey unlock (Passkey) and the password strength meter. */
export default {
  // Welcome
  "onboarding.welcome.lede": "One place for your money, collectibles and apps. Test networks only for now.",
  "onboarding.welcome.create": "Create a new wallet",
  "onboarding.welcome.import": "I already have a recovery phrase",
  "onboarding.welcome.hardware": "Connect a hardware wallet",
  "onboarding.welcome.restorePasskey": "Restore with a passkey backup",

  // Password strength (lib/strength.ts)
  "onboarding.strength.meter": "Password strength",
  "onboarding.strength.empty": "empty",
  "onboarding.strength.labelWithHint": "{label} — {hint}",
  "onboarding.strength.tooCommon": "Too common",
  "onboarding.strength.tooCommonHint": "Avoid well-known words and number runs.",
  "onboarding.strength.tooShort": "Too short",
  "onboarding.strength.tooShortHint": "Use at least 8 characters.",
  "onboarding.strength.okay": "Okay",
  "onboarding.strength.okayHint": "Longer is better — try a few unrelated words.",
  "onboarding.strength.good": "Good",
  "onboarding.strength.strong": "Strong",

  // Choose a password
  "onboarding.password.title": "Choose a password",
  "onboarding.password.lede": "It unlocks this wallet on this device. It can't be recovered, but your recovery phrase can always restore the wallet.",
  "onboarding.password.label": "Password",
  "onboarding.password.again": "Type it again",
  "onboarding.password.mismatch": "The passwords don't match.",
  "onboarding.password.importWallet": "Import wallet",
  "onboarding.password.createWallet": "Create wallet",

  // Recovery phrase shown at creation
  "onboarding.phrase.title": "Your recovery phrase",
  "onboarding.phrase.lede":
    "These {count} words are the only way to get your wallet back. Write them down in order and keep them offline. Anyone who has them can take everything.",
  "onboarding.phrase.listLabel": "Recovery phrase",
  "onboarding.phrase.show": "Show my phrase",
  "onboarding.phrase.saved": "I wrote these words down",

  // Backup check
  "onboarding.confirm.title": "Check your backup",
  "onboarding.confirm.lede": "Type the words at these positions.",
  "onboarding.confirm.word": "Word #{n}",
  "onboarding.confirm.mismatch": "Those words don't match. Check your written copy and try again.",
  "onboarding.confirm.showAgain": "Show phrase again",
  "onboarding.confirm.submit": "Confirm",

  // Import
  "onboarding.import.title": "Import your wallet",
  "onboarding.import.lede": "Enter your 12 or 24-word recovery phrase, separated by spaces.",
  "onboarding.import.label": "Recovery phrase",
  "onboarding.import.wordCount": "{n, plural, one {# word so far} other {# words so far}}",

  // Passkey offer during onboarding
  "onboarding.passkeyOffer.title": "Unlock with Face ID or Touch ID?",
  "onboarding.passkeyOffer.lede": "Use your device's passkey instead of typing your password. Your password keeps working.",
  "onboarding.passkeyOffer.notNow": "Not now",

  // Done
  "onboarding.done.title": "You're all set",
  "onboarding.done.lede": "{name} is ready. Open it from your browser toolbar any time.",
  "onboarding.done.open": "Open my wallet",

  // Unlock
  "onboarding.unlock.title": "Welcome back",
  "onboarding.unlock.submit": "Unlock",
  "onboarding.unlock.withPasskey": "Unlock with passkey",

  // Passkey enrol / unlock (screens/Passkey.tsx)
  "onboarding.passkey.unavailable": "Passkeys aren't available in this browser. Your password still works.",
  "onboarding.passkey.passwordLabel": "Your wallet password",
  "onboarding.passkey.waiting": "Waiting for your device…",
  "onboarding.passkey.use": "Use a passkey",
  "onboarding.passkey.enrollScreen": "Passkey unlock",
  "onboarding.passkey.enrollTitle": "Unlock with Face ID or Touch ID",
  "onboarding.passkey.enrollLede": "Confirm your password, then your device will ask you to create a passkey for {name}.",
  "onboarding.passkey.unlockScreen": "Unlock",
  "onboarding.passkey.unlocked": "Unlocked",
  "onboarding.passkey.unlockTitle": "Unlock with your passkey",

  // Passkey errors raised in the page (lib/passkey.ts)
  "onboarding.passkeyError.cancelled": "Passkey request was cancelled. You can try again or use your password.",
  "onboarding.passkeyError.cancelledShort": "Passkey request was cancelled.",
  "onboarding.passkeyError.unsupported": "This browser can't use a passkey here. Your password still works.",
  "onboarding.passkeyError.failed": "The passkey didn't respond. Your password still works.",
  "onboarding.passkeyError.noPrf": "This passkey can't unlock a wallet (no PRF support). Your password still works.",
  "onboarding.passkeyError.notSetUp": "Passkey unlock isn't set up on this device. Use your password.",
} satisfies Record<`onboarding.${string}`, string>;
