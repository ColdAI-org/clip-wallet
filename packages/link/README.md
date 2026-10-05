# @clip-wallet/link — one wallet on every platform

Settings sync, a phone or Clip Desktop as the signer for the browser extension, moving a wallet to another device,
and "continue elsewhere". Used by the extension service worker (`packages/extension-kit/src/background/link.ts`), the mobile
app (`apps/mobile/src/background/link.ts`) and Clip Desktop (wiring: `docs/r1/integration/connect.md`).

**This package holds no seed and no private key.** X25519 and Ed25519 run in `@clip-wallet/vault`
(`packages/vault/src/link.ts`); this package receives only derived keys and handles through the vault API
(`LinkVault`: `syncKeys()`, `pairingKey()`, `exportToDevice()`, `importFromDevice()`). `pnpm harness` enforces it.

| Module | What |
|---|---|
| `sync/` | records with vector clocks (`records.ts`), wire protocol (`protocol.ts`), device client (`client.ts`), wallet-state adapters (`sources.ts`), storage-agnostic server (`server.ts`, run on D1 by `services/backup`) |
| `pairing/` | QR offer, commit-reveal X25519 + 6-digit SAS + key confirmation (`pairing.ts`), encrypted sessions (`session.ts`) |
| `relay/` | `services/link-relay` protocol and the WebSocket channel |
| `remote/` | remote-signer RPC: extension side (`client.ts`, `host.ts` wraps 1Mask's DappHost), key-holder side (`server.ts`) |
| `native/` | native-messaging framing, host manifests and install paths per browser/OS, the extension's port channel; `node.ts` = host program + desktop socket server (Node only, `@clip-wallet/link/node`) |
| `transfer/` | add this wallet to another device |
| `handoff/` | `clipwallet://browse?url=…&h=…` |
| `service/` | `LinkService` (all of the above for a host), bus messages (`LINK_REQUESTS`), views |

Tests: `pnpm --filter @clip-wallet/link test` (44, no keys: test doubles stand in for X25519/Ed25519), plus real
crypto end to end in `packages/vault/test/link.test.ts` (sync KAT on the public BIP-39 vector, X25519 pairing,
wallet transfer, MITM), `services/backup/test/sync.test.ts` (D1, offline-signed fixtures) and
`services/link-relay/test/relay.test.ts` (Durable Object in workerd, a pairing through it).

## Threat model

### Assets
The recovery phrase and private keys (must never leave the device that holds them, except a deliberate wallet
move), the ability to sign (must need approval on the key-holding device), and private settings (contacts,
connected apps, labels).

### Keys

| Key | Derived | Lives | Used for |
|---|---|---|---|
| Sync Ed25519 key | HKDF(seed, salt "clip-wallet/vault/sync", info "clip/sync/v1") → "auth-ed25519" | vault only (re-derived per signature) | signing sync requests (only messages starting `clip-sync-v1\n`) |
| Sync data key | same root → "data-xchacha20" | link package, in memory | XChaCha20-Poly1305 of each record and of the local replica |
| Record-id key | same root → "record-id" | link package | HMAC of (collection, id) → opaque 128-bit record id |
| Pairing key (X25519) | random per pairing | vault, ≤ 15 min | ECDH |
| Link secret | HKDF(X25519, salt = transcript hash, "clip/link/session/v1") | link package; stored for long-lived pairings | SAS, key confirmation, session keys, relay channel id |
| Transfer key | HKDF(X25519, transcript, "clip/link/transfer/v1") | vault only | encrypting the BIP-39 entropy for one wallet move |
| Session keys | HKDF(link secret, nI ‖ nR, "conn/i2r" / "conn/r2i") per connection | memory | frames on one connection |

### Settings sync
- **What the server sees:** `space = SHA-256(sync public key)`, opaque record ids, sequence numbers, ciphertext
  sizes, request times and IPs (rate limits, hashed). No account, no email, no names. Ciphertext is
  XChaCha20-Poly1305 with the record id in the associated data, so the server can't move a record to another id,
  and can't read or forge one. Tested: `sync.test.ts` "the server never sees plaintext" (requests, responses and
  storage contain none of the values or even the collection names).
- **What syncs:** contacts, account labels and counts, connected apps (origin, family, account ids, never
  session secrets), notification settings, language, display currency, hidden tokens, bookmarks. Never keys,
  phrases, passwords, approvals or Advanced-mode settings.
- **Auth:** each request is signed (method, path+query, timestamp, nonce, body hash). The server refuses
  timestamps more than 5 minutes off and any nonce it saw (stored 11 minutes) — no replay, no signed request
  reused for another path or method.
- **Conflicts:** per-record last-writer-wins with vector clocks: a write that saw another always wins; truly
  concurrent writes resolve by wall-clock time then device id. Merge is commutative/associative/idempotent
  (tested over all orders); pushes are compare-and-set so a concurrent write is merged, never overwritten.
- **A new device takes the server's settings first** (its defaults don't overwrite your other devices).
- **Malicious server:** can withhold, delete, roll back or replay old *valid* ciphertext for a record (a
  rollback is merged by clocks, so it can't undo a newer write a device already has). It can't read or alter.
- **Phrase compromise** = sync data compromise (same root). That's already total compromise of the wallet.
- **Delete:** "Delete synced data" (`DELETE /v1/sync`) removes every row for the space.

### Pairing (QR or one-time code) and the SAS
- The QR carries the initiator's X25519 public key, a relay channel id and a 16-byte secret. The responder
  **commits** to its key (`SHA-256(KR)`) before it learns the initiator's, then reveals it. Both derive the link
  secret in the vault over a transcript of (purpose, channel, QR secret, KI, KR), and show a 6-digit SAS.
- **MITM on the relay:** swapping keys gives the two screens different codes (the person taps "They don't
  match"); the commitment stops an attacker from grinding keys to force equal codes; and even if both people tap
  "match" without looking, **key confirmation** (HMAC of the transcript under a role key) fails and nothing is
  linked or sent. All three are tested (fake crypto in `pairing.test.ts`/`service.test.ts`, real X25519 in
  `packages/vault/test/link.test.ts`).
- **Desktop (no QR):** same protocol in-band over native messaging; the commitment and SAS carry the security.
- Residual: 1 in 10⁶ chance a MITM's codes match by luck (per attempt; each attempt needs the person to start
  pairing again).

### Phone or Clip Desktop as the signer
- **Approval happens in the app that holds the keys.** The extension forwards the dapp's request (origin from the
  browser, never the page) to the paired device, which decodes it with its own chain modules, shows its own
  approval ("app.example · via Chrome on Mac"), and signs only after approval there. The extension receives
  exactly what a dapp would (accounts, signatures, hashes), and may show the signer's decoded summary while it waits.
- The signer refuses requests from origins not connected on the signer, validates every message (zod), and
  namespaces request ids per pairing.
- Sessions: AEAD with per-connection keys and strictly increasing counters (no replay, reorder or splice; a
  tampered frame closes the session). The relay sees only ciphertext and frame sizes/timing.
- **Stored link secrets** (extension `chrome.storage.local`, phone AsyncStorage) let the holder *ask* the paired
  device; they can't sign. Anyone who steals one can send requests that the person must still approve on the
  phone/desktop, with the requesting browser's name shown. Unlink revokes (both sides forget the secret).
- Phone availability: the phone listens on the relay while Clip is in the foreground (no push in this release);
  the extension waits up to 2 minutes and says "Open Clip on your phone".

### Native messaging (extension ⇄ Clip Desktop)
- The browser launches the host only for extension ids in the manifest's `allowed_origins`/`allowed_extensions`
  (no wildcards); the host checks the origin argument again and the desktop app checks it a third time.
- The host is a dumb, size-checked pipe (≤ 1 MB to the browser) to a per-user socket: a 0700 directory and a 0600
  socket on macOS/Linux, a per-user named pipe on Windows. Frames after pairing are end-to-end encrypted between
  extension and desktop app, so the host and any local observer see only ciphertext.
- Residual (Windows): Node can't set a named pipe's DACL; another process of the same user could connect. It
  still can't pair without the person confirming the code in Clip Desktop, and can't decrypt existing sessions.

### Moving a wallet to another device
- Needs: pairing with purpose "device-add", both people confirming the SAS, key confirmation, **and the password
  re-entered on the source** (`vault.exportToDevice` checks it before anything is sent; tested). The vault
  encrypts the BIP-39 entropy under the transfer key (derivable only by these two pairing keys); the new device's
  vault opens and imports it under a new password. The phrase never crosses the vault API, never touches logs,
  storage or the link package in the clear. A MITM ends with SAS mismatch / failed key confirmation before
  `exportToDevice` is ever called (tested with real X25519).
- Alternative: send the passkey-backup ciphertext instead (`sendWallet({ passkeyBackup })`); the new device
  restores it with the synced passkey.

### Continue elsewhere
- `clipwallet://browse?url=<https URL>&h=<token>`; the token is sealed with a key derived from the sync data key,
  so only a device with the same wallet opens it, only for that URL's origin, within 10 minutes. A valid token
  lets the person tap "Continue" to restore the connection (never silent); otherwise the page just opens.

### Relay (services/link-relay)
Stores nothing but frames waiting for an absent peer (≤ 64 frames / 512 KiB, ≤ 10 minutes, then deleted with
the whole channel). Frames ≤ 64 KiB, ≤ 120 frames per 10 s per socket, ≤ 120 connections per hour per channel; a
reconnecting role replaces its old socket and its stale queued frames are dropped. No secrets, no logs
(observability off).

## Sources (checked 2026-10)
- Native messaging (framing, 1 MB limit, manifest, Chrome/Chromium paths): https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Edge paths and registry order: https://learn.microsoft.com/microsoft-edge/extensions/developer-guide/native-messaging
- Firefox manifest (`allowed_extensions`) and paths: https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
- Brave user data dir: https://community.brave.app/t/what-is-the-path-for-native-messaging-on-linux/616427
- `nativeMessaging` as an optional permission: https://developer.chrome.com/docs/extensions/reference/api/runtime (connectNative) and https://bugzilla.mozilla.org/show_bug.cgi?id=1630415
- Durable Objects WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- X25519 (RFC 7748), Ed25519 (RFC 8032), HKDF (RFC 5869), XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha); implementations: @noble/curves, @noble/hashes, @noble/ciphers.
- SAS / commitment design follows Bluetooth LE Secure Connections numeric comparison and ZRTP (RFC 6189 §4.4.1.1 hash commitment).
