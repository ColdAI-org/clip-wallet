// The backup service only ever stores the passkey-encrypted blob the vault made. It can't open it.
import { BackupClient } from "@clip-wallet/backup-client";

const backup = new BackupClient({ baseUrl: "https://backup.acme.example" }); // services.backupUrl

export async function uploadBackup(email: string, waitForLink: () => Promise<string>, blob: Uint8Array, credentialId: string) {
  const pending = await backup.startSignIn(email); // emails a one-time link; keep `pending` on this device
  await backup.completeSignIn(await waitForLink(), pending); // the pasted link (or its token)
  return backup.upload(blob, { credentialId, rpId: "wallet.acme.example" }); // → { id }
}

export async function restore() {
  const [latest] = await backup.list();
  if (!latest) return null;
  const { blob } = await backup.download(latest.id);
  return blob; // the vault decrypts it with the passkey's PRF output, on the device
}
