/**
 * Real passkeys (WebAuthn PRF) through react-native-passkey, as a PRF provider for the vault's passkey slot.
 * Only the PRF output is used: there is no server, the challenge is random and no assertion is verified.
 *
 * What works where (react-native-passkey 3.6 README, "PRF"):
 *   - iOS 18+: platform passkeys (iCloud Keychain) return PRF results; iOS 15–17 create passkeys but no PRF.
 *   - Android 9+ with Google Password Manager / Credential Manager: PRF supported.
 *   - Both need the relying-party domain associated with the app: iOS `webcredentials:<rpId>` + an
 *     apple-app-site-association file; Android Digital Asset Links. Set EXPO_PUBLIC_PASSKEY_RP_ID and
 *     CLIP_ASSOCIATED_DOMAIN at build time. Without them the app offers the device key (device-key.ts) only.
 * A synced passkey means the PRF secret follows the user's iCloud/Google account to their other devices.
 */
import { Passkey } from "react-native-passkey";
import { getRandomBytes } from "expo-crypto";
import { ClipError } from "@clip-wallet/core";
import { b64url, fromB64url, type PrfProvider } from "@clip-wallet/engine";

/** react-native-passkey returns PRF results as base64 or base64url depending on platform. */
export function decodeB64Any(s: string): Uint8Array {
  return fromB64url(s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

export function passkeysConfigured(rpId: string | undefined): rpId is string {
  return !!rpId && Passkey.isSupported();
}

export function nativePasskeyPrf(rpId: string, rpName: string): PrfProvider {
  const challenge = () => b64url(getRandomBytes(32));
  const provider = {
    async enroll(prfInput: Uint8Array) {
      const created = await Passkey.createPlatformKey({
        challenge: challenge(),
        rp: { id: rpId, name: rpName },
        user: { id: b64url(getRandomBytes(16)), name: rpName, displayName: rpName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "required", userVerification: "required" },
        attestation: "none",
        extensions: { prf: { eval: { first: b64url(prfInput) } } },
      }).catch((e: unknown) => {
        throw new ClipError("Passkey setup was cancelled. Your password still works.", "passkey/cancelled", e);
      });
      const credentialId = decodeB64Any(created.rawId);
      let first = created.clientExtensionResults?.prf?.results?.first;
      if (!first) {
        if (created.clientExtensionResults?.prf?.enabled === false) {
          throw new ClipError("This passkey provider can't unlock wallets (no PRF support). Use Face ID / Touch ID instead.", "passkey/no-prf");
        }
        // Some authenticators only evaluate PRF on assertion: ask once more with the same input.
        first = ((await this.evaluateRaw(credentialId, prfInput)) ?? undefined) as typeof first;
      }
      if (!first) throw new ClipError("This passkey provider can't unlock wallets (no PRF support). Use Face ID / Touch ID instead.", "passkey/no-prf");
      return { credentialId, prfOutput: typeof first === "string" ? decodeB64Any(first) : new Uint8Array(first as ArrayBuffer) };
    },
    async evaluate(credentialId: Uint8Array, prfInput: Uint8Array) {
      const first = await this.evaluateRaw(credentialId, prfInput);
      if (!first) throw new ClipError("That passkey didn't unlock the wallet. Use your password instead.", "passkey/no-prf");
      return typeof first === "string" ? decodeB64Any(first) : new Uint8Array(first as ArrayBuffer);
    },
    async evaluateRaw(credentialId: Uint8Array, prfInput: Uint8Array) {
      const got = await Passkey.getPlatformKey({
        challenge: challenge(),
        rpId,
        userVerification: "required",
        allowCredentials: [{ type: "public-key", id: b64url(credentialId) }],
        extensions: { prf: { eval: { first: b64url(prfInput) } } },
      }).catch((e: unknown) => {
        throw new ClipError("Passkey unlock was cancelled. Use your password instead.", "passkey/cancelled", e);
      });
      return got.clientExtensionResults?.prf?.results?.first;
    },
  };
  return provider satisfies PrfProvider;
}
