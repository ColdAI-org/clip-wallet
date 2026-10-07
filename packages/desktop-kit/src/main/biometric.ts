/**
 * Touch ID unlock on macOS: the desktop equivalent of the extension's passkey unlock and the phone's Face ID
 * (apps/mobile/src/background/device-key.ts), plugged into the vault's existing passkey slot as a PRF.
 *
 *   enroll   Touch ID prompt (systemPreferences.promptTouchID) → a random 32-byte device secret is created and
 *            stored encrypted with Electron safeStorage (its key lives in the login Keychain as
 *            "<App> Safe Storage") → PRF output = HMAC-SHA256(secret, prfInput) → the vault HKDFs that into a key
 *            that wraps its vault key. The password keeps working.
 *   unlock   Touch ID prompt → decrypt the secret → same HMAC → the vault unwraps its key.
 *
 * Everything runs in the main process; the PRF output never reaches a renderer (the main process finishes the
 * ceremony itself, see host/wallet.ts `finishCeremony`).
 *
 * Honest limits (docs in apps/desktop/README.md): the Touch ID check is made by this app, not enforced by the
 * Keychain item's access control (Electron's safeStorage has no biometric ACL). Malware already running as the
 * user with access to the app's Keychain item could decrypt the device secret without a fingerprint. That is the
 * same bar as "stay logged in" on most desktop apps; the vault password is never stored.
 *
 * Windows Hello and Linux: no biometric unlock (Electron has no Windows Hello API; WebAuthn platform passkeys need an
 * https relying party, which the app's clip-app: origin isn't). Password unlock always works.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ClipError } from "@clip-wallet/core";
import type { KV } from "@clip-wallet/engine";
import type { SafeStorageLike } from "./storage";
import { protectionOf } from "./storage";

const KEY_PREFIX = "clip-desktop/device-key/";

export interface BiometricDeps {
  platform: NodeJS.Platform;
  /** systemPreferences.canPromptTouchID (macOS only). */
  canPromptTouchID(): boolean;
  /** systemPreferences.promptTouchID: resolves when the fingerprint matched, rejects when cancelled / failed. */
  promptTouchID(reason: string): Promise<void>;
  safe: SafeStorageLike;
  kv: KV;
  randomBytes(n: number): Uint8Array;
}

function hex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

export class TouchIdPrf {
  constructor(private readonly d: BiometricDeps) {}

  /** Touch ID needs macOS with an enrolled sensor and the Keychain-backed safeStorage. */
  get available(): boolean {
    return this.d.platform === "darwin" && protectionOf(this.d.safe, this.d.platform) === "keychain" && this.d.canPromptTouchID();
  }

  readonly label = "Touch ID";

  private async gate(reason: string) {
    if (!this.available) throw new ClipError("Touch ID isn't available on this Mac. Use your password.", "biometric/unavailable");
    try {
      await this.d.promptTouchID(reason);
    } catch {
      throw new ClipError("Touch ID was cancelled. Use your password instead.", "biometric/cancelled");
    }
  }

  async enroll(prfInput: Uint8Array, reason: string): Promise<{ credentialId: Uint8Array; prfOutput: Uint8Array }> {
    await this.gate(reason);
    const credentialId = this.d.randomBytes(16);
    const secret = this.d.randomBytes(32);
    try {
      const sealed = this.d.safe.encryptString(hex(secret)).toString("base64");
      await this.d.kv.set(KEY_PREFIX + hex(credentialId), sealed);
      return { credentialId, prfOutput: hmac(sha256, secret, prfInput) };
    } finally {
      secret.fill(0);
    }
  }

  async evaluate(credentialId: Uint8Array, prfInput: Uint8Array, reason: string): Promise<Uint8Array> {
    const sealed = await this.d.kv.get<string>(KEY_PREFIX + hex(credentialId));
    if (!sealed) throw new ClipError("Touch ID unlock isn't set up on this Mac. Use your password.", "biometric/not-enrolled");
    await this.gate(reason);
    let secret: Uint8Array;
    try {
      secret = Buffer.from(this.d.safe.decryptString(Buffer.from(sealed, "base64")), "hex");
    } catch {
      throw new ClipError("Touch ID unlock stopped working on this Mac. Unlock with your password and turn it on again.", "biometric/invalidated");
    }
    try {
      return hmac(sha256, secret, prfInput);
    } finally {
      secret.fill(0);
    }
  }

  async forget(credentialId: Uint8Array): Promise<void> {
    await this.d.kv.remove(KEY_PREFIX + hex(credentialId));
  }
}
