# @clip-wallet/backup-client

Client for the optional Clip Wallet backup service (`services/backup`). It moves the opaque, passkey-encrypted blob the
vault produces and the sign-in session; it never sees keys or the phrase.

```ts
import { BackupClient } from "@clip-wallet/backup-client";
const c = new BackupClient({ baseUrl: "https://backup.example.com" });
const pending = await c.startSignIn("me@example.com");      // emailed link; keep `pending` on this device
await c.completeSignIn(pastedLink, pending);
const { id } = await c.upload(blob, { credentialId, rpId });
```

Google and Apple sign-in (`startSocialSignIn`) only find your backups; they cannot open them. Off unless
`services.backupUrl` is set in clip.config.ts.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
