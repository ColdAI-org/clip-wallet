/**
 * Device errors in plain words. Raw status words never reach the user; they ride along as `cause`.
 */
import { ClipError } from "@clip-wallet/core";

export type LedgerAppName = "Ethereum" | "Solana" | "Bitcoin Test" | "Bitcoin" | "Hedera";

export const HardwareErrors = {
  noWebHid: () =>
    new ClipError("This browser can't talk to a Ledger over USB. Use Chrome, Edge or Brave on a computer.", "hw/no-webhid"),
  notPicked: (cause?: unknown) =>
    new ClipError("No Ledger was picked. Plug it in, unlock it, then try again and choose it in the list.", "hw/not-picked", cause),
  disconnected: (cause?: unknown) =>
    new ClipError("Your Ledger was disconnected. Plug it back in, unlock it and try again.", "hw/disconnected", cause),
  locked: (cause?: unknown) => new ClipError("Unlock your Ledger with your PIN, then try again.", "hw/locked", cause),
  openApp: (app: LedgerAppName, cause?: unknown) =>
    new ClipError(`Open the ${app} app on your Ledger, then try again.`, "hw/wrong-app", cause),
  rejected: (cause?: unknown) => new ClipError("You rejected this on your hardware wallet. Nothing was signed.", "hw/rejected", cause),
  busy: (cause?: unknown) =>
    new ClipError("Your Ledger is busy with another request. Finish or cancel it on the device, then try again.", "hw/busy", cause),
  blindSigning: (app: LedgerAppName, cause?: unknown) =>
    new ClipError(
      `Your Ledger can't show the details of this request. If you trust it, turn on "Blind signing" in the ${app} app's settings and try again.`,
      "hw/blind-signing-off",
      cause,
    ),
  updateApp: (app: LedgerAppName, cause?: unknown) =>
    new ClipError(`Update the ${app} app on your Ledger with Ledger Live, then try again.`, "hw/update-app", cause),
  tooBig: (cause?: unknown) =>
    new ClipError("This request is too big for your hardware wallet to show. Nothing was signed.", "hw/too-big", cause),
  unsupported: (what: string) => new ClipError(`Your hardware wallet can't sign ${what} yet. Nothing was signed.`, "hw/unsupported"),
  needsDeviceView: (what: string) =>
    new ClipError(`We can't send ${what} to your hardware wallet in a form it can show you, so we stopped. Nothing was signed.`, "hw/no-raw"),
  wrongDevice: (cause?: unknown) =>
    new ClipError(
      "This hardware wallet holds a different recovery phrase from the one this account came from. Connect the right one.",
      "hw/wrong-device",
      cause,
    ),
  badSignature: (cause?: unknown) =>
    new ClipError("The hardware wallet's signature didn't match this account, so nothing was sent.", "hw/bad-signature", cause),
  noApproval: () => new ClipError("This request wasn't approved, or the approval expired. Please try again.", "hw/no-approval"),
  unknownAccount: () => new ClipError("We couldn't find this hardware account. Connect your device again from Settings.", "hw/unknown-account"),
  notSynced: () =>
    new ClipError("Scan your Keystone's account QR code first (Settings → Hardware wallets → Keystone).", "hw/not-synced"),
  wrongQr: (expected: string, cause?: unknown) =>
    new ClipError(`That QR code isn't ${expected}. Scan the code your Keystone shows after you sign.`, "hw/wrong-qr", cause),
  wrongRequest: () =>
    new ClipError("That signature is for a different request. Scan the code for this request on your Keystone.", "hw/wrong-request"),
  noCamera: (cause?: unknown) =>
    new ClipError("We couldn't use your camera. Allow camera access for Clip Wallet and try again.", "hw/no-camera", cause),
  cancelled: () => new ClipError("Cancelled. Nothing was signed.", "hw/cancelled"),
  timedOut: () => new ClipError("Your hardware wallet didn't answer in time. Nothing was signed. Please try again.", "hw/timeout"),
} as const;

/** Ledger status words we map. https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledgerjs/packages/errors/src/index.ts */
export const SW = {
  OK: 0x9000,
  USER_REFUSED: 0x6985,
  USER_REFUSED_ALT: 0x5501,
  LOCKED: 0x5515,
  LOCKED_LEGACY: 0x6b0c,
  CLA_NOT_SUPPORTED: 0x6e00,
  INS_NOT_SUPPORTED: 0x6d00,
  APP_NOT_OPEN: 0x6e01,
  APP_NOT_OPEN_2: 0x6511,
  WRONG_APP: 0x6a83,
  INVALID_DATA: 0x6a80,
  WRONG_LENGTH: 0x6700,
  INCORRECT_P1P2: 0x6b00,
} as const;

interface LedgerishError {
  name?: string;
  statusCode?: number;
  message?: string;
}

/** Map anything a Ledger library throws to a ClipError the user can act on. */
export function ledgerError(e: unknown, app: LedgerAppName): ClipError {
  if (e instanceof ClipError) return e;
  const err = (e ?? {}) as LedgerishError;
  const name = err.name ?? "";
  const msg = err.message ?? "";
  const sw = typeof err.statusCode === "number" ? err.statusCode : undefined;

  if (name === "TransportOpenUserCancelled" || /no device selected|user cancelled|NotFoundError/i.test(msg)) return HardwareErrors.notPicked(e);
  if (name === "DisconnectedDevice" || name === "DisconnectedDeviceDuringOperation" || /disconnected/i.test(msg)) return HardwareErrors.disconnected(e);
  if (name === "TransportRaceCondition" || /race condition|pending action/i.test(msg)) return HardwareErrors.busy(e);
  if (name === "LockedDeviceError" || sw === SW.LOCKED || sw === SW.LOCKED_LEGACY) return HardwareErrors.locked(e);
  if (name === "UserRefusedOnDevice" || name === "UserRefusedAddress" || sw === SW.USER_REFUSED || sw === SW.USER_REFUSED_ALT || /denied by the user|rejected/i.test(msg))
    return HardwareErrors.rejected(e);
  if (sw === SW.CLA_NOT_SUPPORTED || sw === SW.INS_NOT_SUPPORTED || sw === SW.APP_NOT_OPEN || sw === SW.APP_NOT_OPEN_2 || sw === SW.WRONG_APP)
    return HardwareErrors.openApp(app, e);
  if (name === "EthAppPleaseEnableContractData" || /blind sign|enable contract data/i.test(msg)) return HardwareErrors.blindSigning(app, e);
  if (sw === SW.INVALID_DATA && app === "Ethereum") return HardwareErrors.blindSigning(app, e);
  if (sw === SW.WRONG_LENGTH) return HardwareErrors.tooBig(e);
  if (name === "TransportWebUSBGestureRequired" || name === "TransportInterfaceNotAvailable") return HardwareErrors.notPicked(e);
  return new ClipError("Your hardware wallet couldn't do that. Unplug it, plug it back in and try again.", "hw/device-error", e);
}
