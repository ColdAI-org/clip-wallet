# Approval-bound signing

The vault signs only what the person approved, each thing once, for a short time. This holds even if a bug elsewhere
in the background tried to sign something else.

## How it works

1. The person approves a decoded request.
2. The chain module's `prepare()` returns the `SignablePayload`s.
3. The background registers the approval with the vault: `registerApproval(approvalId, hashes, ttlMs)`, one hash per
   payload, for two minutes.
4. `sign(payload)` hashes the payload again and signs only if every check below passes.

## What the hash covers

`hashSignablePayload(payload)` is SHA-256 over a domain tag, the account id, the scheme, the bytes, the taproot tweak
and, when present, the key sub-path, each length-prefixed. So an approval for `evm:0` can't be replayed for `evm:1`,
under another scheme, or with another key below the account (say, the Cardano stake key instead of the payment key).

## What `sign()` checks

| Check | Why |
| --- | --- |
| The approval is live (time-to-live capped at 10 minutes) | a stale approval can't be used later |
| The payload's hash is registered for it and **not yet used** | nothing unapproved, nothing twice |
| The scheme is allowed for the account's family | Substrate signs only sr25519, Starknet only stark-ecdsa, Schnorr only for Bitcoin |
| Any sub-path is valid for the family | Bitcoin change keys the vault handed out to this account; Cardano's payment, internal and stake keys |
| The payload is copied once before hashing | it can't change between being hashed and being signed |

Curve and payload checks run **before** the approval is used, so a malformed request doesn't burn it. An approval for
N payloads (a multi-input PSBT, say) allows exactly N signatures, then disappears. Locking clears every approval; a
failure anywhere revokes the approval.

## Around the vault

- **One Approve at a time.** A second click while the first is signing or broadcasting is refused, so a double click
  can't pay twice.
- **The account is pinned.** A request is signed with the account it was decoded for; if the site's account changed
  since, the request is refused.
- **Fees don't drift.** The EVM, Starknet and Tezos modules reuse the fee quote the person saw, show "Network fee at
  most", and refuse a rebuild that would cost more than what was shown.
- **What is sent is what was signed.** Modules assemble the transaction from the bytes they prepared for that request,
  and the [worked example](../extend/chain-module.md#_7-finalize) shows the pattern: check the signature against those
  bytes, then send.
- **Hardware wallets** get the same binding in `HardwareKeyring`: a device's signature is accepted only if it verifies
  over the approved bytes with the account's key, once. See [Hardware wallets](./hardware.md).

## Blind signing

A request the module couldn't decode is `blind`. Approve is refused (`approval/blind-blocked`) unless the person has
Advanced mode on and overrides it for that one request, after a warning. Plugins never see blind requests.
