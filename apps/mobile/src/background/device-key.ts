/**
 * Face ID / Touch ID / fingerprint unlock: the mobile equivalent of the extension's passkey unlock.
 *
 * A random 32-byte device secret is stored in the Keychain / Keystore with user authentication required
 * (expo-secure-store `requireAuthentication`: iOS SecAccessControl .biometryCurrentSet, enforced by the
 * Secure Enclave; Android Keystore key with setUserAuthenticationRequired). It never leaves the device, is
 * invalidated when the enrolled biometrics change, and is not in backups.
 *
 * It plugs into the vault's existing passkey slot as a PRF: output = HMAC-SHA256(secret, prfInput), which the
 * vault HKDFs into a key that wraps its vault key (same as WebAuthn PRF). The password keeps working.
 *
 * expo-local-authentication checks there is biometric hardware and an enrolment, names it ("Face ID"), and
 * prompts explicitly where the OS doesn't (simulators/emulators never enforce Keychain/Keystore biometrics).
 */
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import * as Device from "expo-device";
import { getRandomBytes } from "expo-crypto";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ClipError } from "@clip-wallet/core";
import type { PrfProvider } from "@clip-wallet/engine";

const SERVICE = "org.coldai.clipwallet.devicekey";

function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function unhex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export interface BiometricInfo {
  available: boolean;
  /** "Face ID", "Touch ID", "fingerprint", "face unlock", or a generic "biometrics". */
  label: string;
  reason?: string;
}

export async function biometricInfo(): Promise<BiometricInfo> {
  const [hw, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);
  const ios = Device.osName === "iOS" || Device.osName === "iPadOS";
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
  const label = face ? (ios ? "Face ID" : "face unlock") : finger ? (ios ? "Touch ID" : "fingerprint") : "biometrics";
  if (!hw) return { available: false, label, reason: "This device has no Face ID, Touch ID or fingerprint sensor." };
  if (!enrolled) return { available: false, label, reason: `Set up ${label} in your device settings first.` };
  if (!SecureStore.canUseBiometricAuthentication()) return { available: false, label, reason: "This build can't use biometrics." };
  return { available: true, label };
}

async function gate(label: string) {
  // Real devices: the Keychain/Keystore read below shows the system prompt itself. Simulators don't enforce
  // it, so ask explicitly there (Features → Face ID → Matching Face in the iOS Simulator).
  if (Device.isDevice) return;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: `Unlock with ${label}`, disableDeviceFallback: true, cancelLabel: "Use password" });
  if (!r.success) throw new ClipError(`${label} didn't match. Use your password instead.`, "biometric/failed");
}

/** PRF provider backed by the device key. One device key per enrolment (credential id = Keychain item name). */
export function deviceKeyPrf(label: string): PrfProvider {
  const opts = (prompt: string): SecureStore.SecureStoreOptions => ({
    keychainService: SERVICE,
    requireAuthentication: true,
    authenticationPrompt: prompt,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  });
  return {
    async enroll(prfInput) {
      const credentialId = getRandomBytes(16);
      const secret = getRandomBytes(32);
      const name = `dk.${hex(credentialId)}`;
      await SecureStore.setItemAsync(name, hex(secret), opts(`Turn on ${label} for Clip Wallet`));
      // Prove it reads back (and that the user can pass the check) before the vault relies on it.
      await gate(label);
      const back = await SecureStore.getItemAsync(name, opts(`Confirm ${label} for Clip Wallet`));
      if (back !== hex(secret)) throw new ClipError(`${label} couldn't be set up on this device.`, "biometric/store");
      const prfOutput = hmac(sha256, secret, prfInput);
      secret.fill(0);
      return { credentialId, prfOutput };
    },
    async evaluate(credentialId, prfInput) {
      await gate(label);
      let stored: string | null;
      try {
        stored = await SecureStore.getItemAsync(`dk.${hex(credentialId)}`, opts(`Unlock Clip Wallet`));
      } catch {
        throw new ClipError(`${label} was cancelled. Use your password instead.`, "biometric/cancelled");
      }
      if (!stored) {
        throw new ClipError(`${label} changed on this device, so it was switched off. Unlock with your password and turn it on again.`, "biometric/invalidated");
      }
      const secret = unhex(stored);
      try {
        return hmac(sha256, secret, prfInput);
      } finally {
        secret.fill(0);
      }
    },
  };
}

export async function forgetDeviceKey(credentialId: Uint8Array): Promise<void> {
  await SecureStore.deleteItemAsync(`dk.${hex(credentialId)}`, { keychainService: SERVICE }).catch(() => undefined);
}
