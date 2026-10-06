# Hardware wallets

Clip Wallet supports **Ledger** (USB through WebHID in the extension and on desktop, Bluetooth on the phone) and
**Keystone** (air-gapped, animated QR codes). The key stays on the device: Clip stores public keys and paths, the device
signs, and every signature is checked before it is used.

## What protects a hardware signature

- **The device shows the real thing.** Chain modules attach the full transaction or message (`SignablePayload.raw`);
  the device shows and signs that, never a bare digest. Before the device sees it, the keyring checks that `raw` really
  produces the approved bytes.
- **The background keeps its own copy.** `HardwareKeyring.registerApproval()` stores the approved payloads. The page
  that drives the device (it needs WebHID or the camera) only names the job it answers; it can't change the payload.
- **One valid signature, once.** `acceptSignature()` verifies the signature over the approved bytes with the account's
  public key, then uses up the approval.
- **Wrong device, wrong app.** Every Ledger command first asks which app is open, and re-reads the account's public key
  before signing, so another Ledger or another passphrase fails as "wrong device", in plain words.
- **Separate ids.** Hardware accounts are `hw:<kind>:<fingerprint>:<family>:<index>`, which can never be routed to the
  vault.

| Format | Ledger | Keystone |
| --- | --- | --- |
| EVM transactions, `personal_sign`, EIP-712 | yes (clear signing where Ledger can) | yes |
| Solana transactions | yes | yes |
| Solana messages | refused (the app signs a different envelope than dapps expect) | yes |
| Bitcoin PSBTs (native segwit) | yes | yes |
| Bitcoin messages (BIP-137) | yes | not yet |
| Hedera transactions | yes (Ed25519) | no Hedera support |

Without `raw`, EVM and Bitcoin requests are refused rather than sent to the device as a digest. A Ledger Hedera account
uses the Hedera app's Ed25519 key, so it is a different account from the vault's ECDSA Hedera account for the same
phrase. Batches (EIP-5792) with a hardware account are refused for now.

The details per device, paths and the recordings the tests replay: [`packages/hardware/README.md`](repo:packages/hardware/README.md).
