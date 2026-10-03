/** Namespace "backup": recovery-phrase backup, passkey backup / restore, the Backup hub, and platform client labels. */
export default {
  // Recovery phrase (screens/RecoveryPhrase.tsx)
  "backup.phrase.screen": "Recovery phrase",
  "backup.phrase.listLabel": "Recovery phrase",
  "backup.phrase.quizMismatch": "That doesn't match. Check what you wrote down, or look at the phrase again.",
  "backup.phrase.quizTitle": "Check your copy",
  "backup.phrase.quizLede": "Type these words from what you wrote down.",
  "backup.phrase.quizWord": "Word {n}",
  "backup.phrase.quizCheck": "Check",
  "backup.phrase.showAgain": "Show phrase again",
  "backup.phrase.introTitle": "Back up your recovery phrase",
  "backup.phrase.introLede":
    "These words are the only way to get your wallet back if you lose this device. Anyone who sees them can take everything. Write them on paper. Don't screenshot, photograph or paste them anywhere.",
  "backup.phrase.checking": "Checking…",
  "backup.phrase.doneTitle": "You're backed up",
  "backup.phrase.doneLede": "Keep the paper somewhere safe and private. We'll never ask you for these words.",
  "backup.phrase.title": "Your recovery phrase",
  "backup.phrase.lede": "Make sure nobody can see your screen. Hold the button to show the words, or click it to keep them shown.",
  "backup.phrase.hide": "Hide words",
  "backup.phrase.reveal": "Hold or click to show",
  "backup.phrase.allowCopy": "Allow copying",
  "backup.phrase.allowCopyHint": "Off by default. Anything you copy can be read by other apps and extensions.",
  "backup.phrase.writtenDown": "I've written it down",

  // Shared
  "backup.passwordLabel": "Your wallet password",
  "backup.waiting": "Waiting for your device…",
  "backup.passwordMismatch": "The passwords don't match.",

  // Passkey backup explainer
  "backup.explainer.lede": "Your passkey can lock a copy of your recovery phrase so you can get your wallet back on a new device.",
  "backup.explainer.stored": "We store only the locked copy. We can't open it, and neither can anyone who breaks into our servers.",
  "backup.explainer.restoreAny": "To restore, you need the email, Google or Apple account you signed in with (to fetch the copy) and the passkey (to unlock it), on the new device. That sign-in only finds your copy; it can't unlock it.",
  "backup.explainer.syncAny":
    "<b>Your passkey syncs through your Apple, Google or password-manager account.</b> Whoever controls that account and can pass its Face ID, fingerprint or PIN could restore this wallet if they also get into the email, Google or Apple account you back up with. Protect both.",
  "backup.explainer.keepPhrase": "Keep your recovery phrase written down too. It works even if this service or your passkey is gone.",

  // Email sign-in
  "backup.signIn.email": "Email",
  "backup.signIn.emailHint": "We'll email you a sign-in link. No password.",
  "backup.signIn.orEmail": "Or use your email:",
  "backup.social.google": "Continue with Google",
  "backup.social.apple": "Sign in with Apple",
  "backup.social.privacy": "Google or Apple only tells us which backups are yours. They never see your keys, and your backup stays locked with your passkey.",
  "backup.social.googleAccount": "your Google account",
  "backup.social.appleAccount": "your Apple Account",
  "backup.signIn.sending": "Sending…",
  "backup.signIn.send": "Email me a link",
  "backup.signIn.sent": "We sent a link to <b>{email}</b>. Open it on this device, or paste it here. It works once, for 15 minutes.",
  "backup.signIn.link": "Link from the email",
  "backup.signIn.checking": "Checking…",
  "backup.signIn.otherEmail": "Use a different email",
  "backup.signIn.landingLoading": "Signing in",
  "backup.signIn.landingDone": "You're signed in",

  // Passkey backup (settings)
  "backup.passkey.screen": "Passkey backup",
  "backup.passkey.unavailableTitle": "Passkey backup isn't available in this version",
  "backup.passkey.unavailableBody": "Your recovery phrase is your backup.",
  "backup.passkey.noPasskeys": "Passkeys aren't available in this browser. Your recovery phrase is still your backup.",
  "backup.passkey.title": "Back up with your passkey",
  "backup.passkey.backedUp": "Backed up. You can restore on a new device with your email and this passkey.",
  "backup.passkey.yourBackups": "Your backups",
  "backup.passkey.made": "Made {date}",
  "backup.passkey.signedInAs": "Signed in as {email}",
  "backup.passkey.understand": "I understand who can restore my wallet",
  "backup.passkey.create": "Create backup passkey",
  "backup.passkey.addAnother": "Add another backup",
  "backup.passkey.signOut": "Sign out of backups",

  // Restore
  "backup.restore.screen": "Restore",
  "backup.restore.noPasskeys": "Passkeys aren't available in this browser. Use your recovery phrase instead.",
  "backup.restore.title": "Restore with your passkey",
  "backup.restore.noBackupsTitle": "No backups for this email",
  "backup.restore.noBackupsBody": "Use your recovery phrase instead, or sign in with another email.",
  "backup.restore.backupsLabel": "Backups",
  "backup.restore.backupFrom": "Backup from {date}",
  "backup.restore.newPassword": "New password for this device",
  "backup.restore.passwordHint": "At least 8 characters.",
  "backup.restore.again": "Type it again",
  "backup.restore.unlock": "Unlock with passkey",

  // Backup hub (screens/Backup.tsx)
  "backup.hub.screen": "Backup",
  "backup.hub.lede": "If you lose this device, a backup is the only way back into your wallet.",
  "backup.hub.phraseTitle": "Recovery phrase",
  "backup.hub.phraseHint": "Write the 12 words on paper and keep them somewhere safe. They work in any compatible wallet, forever.",
  "backup.hub.phraseButton": "Back up recovery phrase",
  "backup.hub.passkeyTitle": "Passkey backup",
  "backup.hub.passkeyUnavailable": "Passkey backup isn't available in this version. Your recovery phrase is your backup.",
  "backup.hub.passkeyStored":
    "{count, plural, one {# locked copy is} other {# locked copies are}} stored. Your passkey unlocks it on a new device.",
  "backup.hub.passkeyPitch": "Lock a copy of your recovery phrase with a passkey, so you can restore on a new device with your email and that passkey.",
  "backup.hub.passkeyManage": "Manage passkey backup",
  "backup.hub.passkeyStart": "Back up with your passkey",

  // platform/ceremony.ts
  "backup.ceremony.unknownPasskey": "We couldn't tell which passkey made this backup.",

  // platform/client.ts: account family names (network names stay as they are)
  "backup.family.evm": "Ethereum-style (ETH, USDC, Base, Arbitrum…)",
  "backup.family.hedera": "Hedera (HBAR)",
  "backup.family.solana": "Solana (SOL)",
  "backup.family.bitcoin": "Bitcoin (BTC)",
} satisfies Record<`backup.${string}`, string>;
