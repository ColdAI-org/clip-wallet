# @clip-wallet/backup-client

Client for the optional Clip Wallet backup service (`services/backup`). It moves the opaque, passkey-encrypted blob the
vault produces and the sign-in session; it never sees keys or the phrase. Google and Apple sign-in only find your
backups; they can't open them. Off unless `services.backupUrl` is set in clip.config.ts.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/backup-client
```

## Example

```ts
import { BackupClient } from "@clip-wallet/backup-client";

const backup = new BackupClient({ baseUrl: "https://backup.example.com" });

export async function upload(email: string, pastedLink: () => Promise<string>, blob: Uint8Array, credentialId: string) {
  const pending = await backup.startSignIn(email); // emails a one-time link; keep `pending` on this device
  await backup.completeSignIn(await pastedLink(), pending);
  return backup.upload(blob, { credentialId, rpId: "wallet.example.com" }); // → { id }
}
```

## Documentation

- [Backup service](https://coldai.org/clip/docs/services/backup.html)
- [Vault cryptography](https://coldai.org/clip/docs/security/vault-crypto.html)
- [API reference](https://coldai.org/clip/docs/reference/api/backup-client.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
