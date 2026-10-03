# services/backup — passkey backup storage with email sign-in

A Cloudflare Worker (D1 + R2) that stores the opaque blobs produced by `vault.createPasskeyBackup` so a
user can restore their wallet on a new device with the passkey that synced there. Deployed for testnet builds
at `https://clip-backup.doyoka-platform.workers.dev` with email sign-in **off** (no provider key set); see
[docs/phase25/deploy.md](../../docs/phase25/deploy.md) for resources, rotation, teardown and how to switch sign-in on.

Client: [`@clip-wallet/backup-client`](../../packages/backup-client) (wire protocol in its `src/protocol.ts`).
UI: `packages/ui/src/screens/Backup*.tsx`; integration lines in `docs/phase2/integration/platform.md`.

## Threat model

**What the server sees**

| Data | When | Stored as |
|---|---|---|
| Email address | `POST /v1/auth/start` only, to send the link | `HMAC-SHA256(EMAIL_PEPPER, email)`; the address itself is never written to D1 or R2 |
| Backup blob | upload / download | R2 object `b/<random 128-bit id>`: `"CLPB" ‖ 0x01 ‖ salt ‖ nonce ‖ XChaCha20-Poly1305(BIP-39 entropy)` |
| Passkey credential id + rp id | upload | D1 row next to the blob id (public WebAuthn identifiers; they let a new device ask for the right passkey) |
| Sign-in link token, session token, PKCE verifier | sign-in | SHA-256 hashes only |
| Client IP, account hash | each request | SHA-256 inside rate-limit keys, dropped after the window |

**What the server never sees:** the recovery phrase, any private key, the passkey's PRF output, or the key
derived from it. The PRF output is produced by the authenticator inside the user's browser, handed to the
vault (in the extension's service worker) and wiped after HKDF; only the ciphertext leaves the device.

**Who can restore.** Decrypting a blob needs the PRF output of *that* passkey with the fixed backup PRF
input (`BACKUP_PRF_INPUT`). Passkeys sync through the platform account (iCloud Keychain, Google Password
Manager, a password manager). So **whoever controls the Apple/Google/password-manager account that syncs
the passkey, and can pass its user verification, can restore the wallet** — once they also get the blob,
which needs the email inbox (or a copy of the blob). The UI says this in plain words before the user opts in.

**Attacks and what stops them**

- *Server or database breach.* The attacker gets ciphertext, credential ids, email HMACs (useless without
  the pepper; with the pepper, emails can be confirmed by guessing, not listed). No blob can be decrypted
  without the passkey. Mitigation for the pepper: Worker secret, never in D1.
- *Email-inbox takeover.* The attacker can sign in and download blobs, but can't decrypt without the
  passkey. Email is only the locator, not a key.
- *Phished / forwarded sign-in link.* Links are bound to the device that asked (PKCE S256: the request
  carries `SHA-256(verifier)`, verify needs the verifier). A link someone else started is useless to the
  victim and vice versa; 5 wrong verifiers burn the link. Links are single-use and last 15 minutes. The
  token travels in the URL **fragment**, so it never reaches a web server's logs.
- *Account probing.* `auth/start` answers 202 for any well-formed address; there is no "user not found".
- *Abuse as free storage.* Only well-formed CLPB v1 blobs of exactly the 12- or 24-word size are accepted,
  at most 10 per account, 20 uploads per day.
- *Brute force / spam.* D1 fixed-window limits: sign-in 10/h per IP and 5/h per email; verify 30/h per IP;
  API 120/h per account (`src/ratelimit.ts`). 429 carries `Retry-After`.
- *Malicious server.* It could withhold or swap blobs (a swapped blob fails the AEAD tag, so the restore
  fails rather than restoring someone else's wallet), or log emails in transit. It can't steal funds. The
  recovery phrase remains the primary backup.
- *Browser-side.* CORS is limited to `ALLOWED_ORIGINS`; every response is `no-store`, `nosniff`, with a
  `default-src 'none'` CSP.

**Not covered:** traffic analysis by Cloudflare; deletion guarantees inside R2 replicas; an attacker who
controls both the passkey-sync account and the email inbox (they can restore — that is the design).

## Email

`EmailSender` (`src/email.ts`) is an interface. With no `RESEND_API_KEY` secret or no `EMAIL_FROM` var, the
deployed entry point uses `UnconfiguredEmailSender`: `auth/start` returns 503 before touching D1 (no link, no
rate-limit row) and `/v1/health` reports `"emailSignIn": false`. With both set, `src/index.ts` sends through
`ResendEmailSender` (Resend `POST /emails`). Other providers: pass a sender to `createApp()`.
`MemoryEmailSender` is for tests only.

## Operating

Done once for the current deployment (commands and ids in `docs/phase25/deploy.md`):

```
wrangler d1 create clip-backup-db                # id is in wrangler.jsonc
wrangler r2 bucket create clip-backup-blobs
wrangler d1 migrations apply clip-backup-db --remote
openssl rand -base64 32 | wrangler secret put EMAIL_PEPPER
wrangler deploy
```

Set `APP_URL` (where the link lands; the wallet reads `#/backup/sign-in?token=…`) and `ALLOWED_ORIGINS`
(`chrome-extension://<id>`). An hourly cron deletes expired links, sessions and rate-limit windows.

## Tests

`pnpm --filter @clip-wallet/service-backup test` runs inside workerd via `@cloudflare/vitest-pool-workers`
0.22 (Vitest 4, local Miniflare D1/R2; nothing remote). 24 tests, including the real
`@clip-wallet/backup-client` driving the Worker end to end.

Sources: Workers Vitest integration <https://developers.cloudflare.com/workers/testing/vitest-integration/>;
PKCE S256 RFC 7636 §4.2 (test vector in the client tests); WebAuthn credential id ≤ 1023 bytes
(W3C WebAuthn L3 §5.1 `rawId`/Credential ID).
