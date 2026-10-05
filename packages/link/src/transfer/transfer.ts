/**
 * "Add this wallet to another device". After pairing with purpose "device-add" (both people compared the code
 * and tapped "They match", and key confirmation passed), the device that has the wallet asks for its password,
 * the vault encrypts the BIP-39 entropy under a key only these two pairing keys can derive, and the box crosses
 * the relay inside the encrypted session. The new device's vault opens it and imports it under a new password.
 *
 * Alternatively the source can send its passkey-backup ciphertext (already encrypted under the passkey's PRF);
 * the new device then restores it with that passkey. Nothing here logs anything.
 */
import { ClipError } from "@clip-wallet/core";
import { b64url, fromB64url } from "../bytes.js";
import type { LinkVault, SealedBoxLike } from "../keys.js";
import { nextFrame, type Channel } from "../pairing/channel.js";
import type { Paired } from "../pairing/pairing.js";
import { openSession, type SecureSession } from "../pairing/session.js";

type WalletMsg = { t: "wallet"; kind: "phrase"; box: SealedBoxLike } | { t: "wallet"; kind: "passkey-backup"; blob: string };

function firstMessage<T>(s: SecureSession, accept: (m: unknown) => m is T, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      offClose();
      reject(new ClipError("The other device stopped answering. Start again on both devices.", "link/transfer-timeout"));
    }, timeoutMs);
    const off = s.onMessage((m) => {
      if (accept(m)) {
        clearTimeout(t);
        off();
        offClose();
        resolve(m);
      }
    });
    const offClose = s.onClose(() => {
      clearTimeout(t);
      off();
      reject(new ClipError("The connection to the other device closed. Start again on both devices.", "link/transfer-closed"));
    });
  });
}

const isWallet = (m: unknown): m is WalletMsg => !!m && typeof m === "object" && (m as WalletMsg).t === "wallet";
const isAck = (m: unknown): m is { t: "received"; ok: boolean } => !!m && typeof m === "object" && (m as { t?: string }).t === "received";

/** Source side. Throws vault/wrong-password before anything is sent. */
export async function sendWallet(p: { channel: Channel; paired: Paired; vault: Pick<LinkVault, "exportToDevice">; password: string } | { channel: Channel; paired: Paired; passkeyBackup: Uint8Array }): Promise<void> {
  const box = "vault" in p ? await p.vault.exportToDevice(p.password, p.paired.pairingKeyId, p.paired.peerPublicKey, p.paired.transcriptHash) : undefined;
  const s = await openSession(p.channel, p.paired.linkSecret, p.paired.role, 120_000);
  try {
    s.send(box ? { t: "wallet", kind: "phrase", box } : { t: "wallet", kind: "passkey-backup", blob: b64url((p as { passkeyBackup: Uint8Array }).passkeyBackup) });
    const ack = await firstMessage(s, isAck, 120_000);
    if (!ack.ok) throw new ClipError("The other device couldn't add the wallet. Start again on both devices.", "link/transfer-failed");
  } finally {
    s.close("done");
  }
}

/**
 * New-device side. For a phrase transfer the wallet is imported here under `password`; for a passkey backup the
 * blob is returned so the app can run the passkey ceremony and call restorePasskeyBackup.
 */
export async function receiveWallet(p: { channel: Channel; paired: Paired; vault: Pick<LinkVault, "importFromDevice">; password: string }): Promise<{ kind: "phrase" } | { kind: "passkey-backup"; blob: Uint8Array }> {
  const s = await openSession(p.channel, p.paired.linkSecret, p.paired.role, 120_000);
  try {
    const m = await firstMessage(s, isWallet, 5 * 60_000);
    try {
      if (m.kind === "phrase") {
        await p.vault.importFromDevice(p.paired.pairingKeyId, p.paired.peerPublicKey, p.paired.transcriptHash, m.box, p.password);
        s.send({ t: "received", ok: true });
        return { kind: "phrase" };
      }
      const blob = fromB64url(m.blob);
      s.send({ t: "received", ok: true });
      return { kind: "passkey-backup", blob };
    } catch (e) {
      s.send({ t: "received", ok: false });
      throw e;
    }
  } finally {
    // Let the ack flush before closing.
    await new Promise((r) => setTimeout(r, 50));
    s.close("done");
  }
}

export { nextFrame };
