# Backup

`services/backup` stores the passkey-encrypted backup the vault makes, so a person can restore their wallet on a new
device with the passkey that synced there. It also hosts settings sync (`/v1/sync`) for [linked devices](../architecture/link.md).

**It can't open a backup.** It stores ciphertext the vault produced. Decrypting needs the PRF output of *that* passkey,
which never leaves the person's device.

## What it stores

| Data | Stored as |
| --- | --- |
| The backup | an R2 object: `"CLPB" ‖ 0x01 ‖ salt ‖ nonce ‖ XChaCha20-Poly1305(BIP-39 entropy)` |
| Email address | `HMAC-SHA256(EMAIL_PEPPER, email)` only; the address is never written to D1 or R2 |
| Google / Apple account | `HMAC-SHA256(EMAIL_PEPPER, "<provider>:<sub>")` only |
| Passkey credential id and rp id | public WebAuthn identifiers, next to the blob id, so a new device asks for the right passkey |
| Sign-in link, session, PKCE verifier | SHA-256 hashes only |
| Sync records | opaque 128-bit ids, sequence numbers and XChaCha20-Poly1305 ciphertext, filed under `SHA-256(sync public key)` |

**Who can restore:** whoever controls the account that syncs the passkey (iCloud Keychain, Google Password Manager, a
password manager) and can pass its user verification, once they also get the blob, which needs the email inbox or the
Google/Apple account. The wallet says this in plain words before the person opts in. The recovery phrase stays the
primary backup.

## API

All under `/v1`. Responses are JSON, `no-store`, `nosniff`, with a `default-src 'none'` CSP.

| Method and path | Auth | What |
| --- | --- | --- |
| `GET /v1/health` | none | `{ ok, emailSignIn, sync }` |
| `POST /v1/auth/start` | none | email a one-time sign-in link (`202` for any well-formed address; `503` when email isn't configured) |
| `POST /v1/auth/verify` | none | the link's token plus the device's PKCE verifier → a session |
| `GET /v1/auth/providers` | none | `{ email, google, apple }`: which sign-in methods are on |
| `POST /v1/auth/oidc/start` | none | begin Google or Apple sign-in |
| `GET` or `POST /v1/auth/oidc/callback` | none | the provider's redirect (Apple posts a form) |
| `POST /v1/auth/oidc/finish` | none | the one-time handoff plus the device's verifier → a session |
| `POST /v1/auth/sign-out` | session | end the session |
| `GET /v1/backups` | session | list this account's backups |
| `POST /v1/backups` | session | upload a blob with its passkey credential id |
| `GET /v1/backups/<id>`, `DELETE /v1/backups/<id>` | session | download or delete one |
| `DELETE /v1/account` | session | delete the account and every backup |
| `GET /v1/sync/changes?since=<seq>` | signed request | records changed since `seq` |
| `POST /v1/sync/push` | signed request | push records (compare-and-set; conflicts come back) |
| `DELETE /v1/sync` | signed request | delete everything stored for this sync key |

Wallets use it through `@clip-wallet/backup-client`:

<<< @/snippets/services/backup-client.ts

## Limits and protections

- Sign-in links are single-use, last 15 minutes, travel in the URL fragment, and are bound to the device that asked
  (PKCE S256): a forwarded link is useless. Five wrong verifiers burn the link.
- Only well-formed CLPB v1 blobs of the 12- or 24-word size are accepted, at most 10 per account (checked and
  inserted in one statement) and 20 uploads a day. Bodies are cut off at their size limit while streaming.
- Rate limits: sign-in 10 an hour per IP and 5 per email, verify 30 an hour per IP, API 120 an hour per account; sync
  2000 an hour per IP and 600 per key. `429` carries `Retry-After`.
- Sync requests are signed (method, path, timestamp, nonce, body hash); more than 5 minutes off, or a reused nonce, is
  refused. 16 KiB per record, 100 per push, 5000 records or 4 MiB per space.
- An hourly cron deletes expired links, sessions and rate-limit windows.

The full threat model, including what a breached server or a hijacked inbox can and can't do:
[`services/backup/README.md`](repo:services/backup/README.md). Deploying it: [Self-host on Cloudflare](./self-hosting.md#backup).
