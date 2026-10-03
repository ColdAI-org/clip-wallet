import { ClipError } from "@clip-wallet/core";

/** Error codes the vault throws. `userMessage` is safe to show; it never contains key material. */
export const VaultErrors = {
  locked: () => new ClipError("Your wallet is locked. Unlock it to continue.", "vault/locked"),
  empty: () => new ClipError("There is no wallet on this device yet. Create or import one.", "vault/empty"),
  exists: () =>
    new ClipError("A wallet already exists on this device. Remove it first if you want to replace it.", "vault/exists"),
  wrongPassword: () => new ClipError("That password didn't work. Check it and try again.", "vault/wrong-password"),
  invalidPhrase: (why: string) =>
    new ClipError("That recovery phrase isn't valid. Check each word and the word order.", "vault/invalid-phrase", why),
  weakPassword: () => new ClipError("Choose a password with at least 8 characters.", "vault/weak-password"),
  appDataUnreadable: (cause?: unknown) =>
    new ClipError("Some saved wallet data (like your contacts) couldn't be opened on this device.", "vault/app-data-unreadable", cause),
  corrupt: (cause?: unknown) =>
    new ClipError("The wallet data on this device looks damaged. Restore from your recovery phrase.", "vault/corrupt", cause),
  noApproval: () =>
    new ClipError("This signature wasn't approved, or the approval expired. Try the request again.", "vault/no-approval"),
  schemeMismatch: () =>
    new ClipError("This account can't sign this kind of request.", "vault/scheme-mismatch"),
  badPayload: (why: string) => new ClipError("The request couldn't be signed.", "vault/bad-payload", why),
  unknownAccount: () => new ClipError("That account isn't in this wallet.", "vault/unknown-account"),
  passkeyUnavailable: () =>
    new ClipError("Passkey unlock isn't set up on this device. Use your password.", "vault/passkey-unavailable"),
  backupMismatch: (cause?: unknown) =>
    new ClipError("That passkey can't unlock this backup. Try the passkey you used when you made it.", "vault/backup-mismatch", cause),
  passkeyFailed: (cause?: unknown) =>
    new ClipError("Passkey unlock didn't work. Use your password instead.", "vault/passkey-failed", cause),
} as const;
