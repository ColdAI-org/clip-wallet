# Integration: hardware signing out of the service worker (stream "size-hw", branch `p25/size-hw`)

Already applied on this branch (no extra wiring step). This note is for merging with streams that touch the same
shared files.

## What moved

Ledger (WebHID) and Keystone (QR, camera) code now runs only in extension pages; the background service worker
imports `@clip-wallet/hardware/core` alone (accounts, approvals, verification, errors, wire forms).

| | before | after |
|---|---|---|
| `background.js` (`wxt build`, chrome-mv3) | 9,999,949 B (10.00 MB) | 7,336,822 B (7.34 MB), -2.66 MB (-26.6%) |
| page entry (`mount` + its shared chunk, loaded by every page) | 836,448 B | 625,526 + 219,695 = 845,221 B (+9 KB) |
| lazy, only when a hardware account is connected or signs | | `src-*.js` 1.68 MB, `dist-*.js` 848 KB (Keystone SDK), `TransportWebHID-*.js` 17 KB |

(The Phase 2 estimate was 1.5 MB; the real figure is larger because the service worker inlined every `import()`
target, so the Keystone SDK and the Ledger apps were in it whether they were used or not.)

## Flow

1. `approve()` (service.ts) prepares the payloads and registers them with `HardwareKeyring.registerApproval`
   (TTL now `MAX_APPROVAL_TTL_MS`, 10 minutes, for device time). The background keeps its own copies.
2. `HardwareSignHost.sign()` (`apps/extension/src/background/hardware-host.ts`) opens a job and makes sure the
   approval window is open (`env.openApprovalWindow`).
3. The approval window's `SignAgent` (`apps/extension/src/pages/hardware/agent.ts`) reads `hwSignJobs`, lazy-loads
   the device code (`pages/hardware/devices.ts`), signs on the device and sends `hwSignResult` (or `hwSignFailed`).
4. `HardwareKeyring.acceptSignature(own payload copy, signature)` verifies over the approved bytes with the
   account's public key, then consumes the approval. Bad signature, other bytes, unknown job id and replays are
   rejected (`hw/bad-signature`, `hw/no-approval`); the approval fails and nothing is finalized.

The Keystone QR step is overlaid on the approval view in the approval window itself (`withDeviceSteps`), so
`hwKeystoneAnswer` no longer crosses the bus. Cancel (`hwCancel`) and lock end the job; the window then aborts
the device step.

## Bus changes (`apps/extension/src/shared/messages.ts`)

- Removed: `hwLedgerAccounts`, `hwKeystoneAccounts`, `hwKeystoneImport`, `hwKeystoneAnswer` (now page-local in
  `pages/hardware/client.ts`).
- Changed: `hwAddAccounts` takes `accounts` (full public records, strict zod schema) instead of `ids`. The keyring
  also rejects a record that disagrees with its id (kind, fingerprint, family, index, path style, curve, key shape).
- Added: `hwSignJobs`, `hwSignResult { id, jobId, signature }`, `hwSignFailed { id, jobId, code, message }`.

## Shared-file edits

- `background/wiring.ts`: `lazyHardware`, `LazyLedger`, `LazyKeystone`, `ledger`/`keystone` deps and the
  `onHardwareChange` option are gone; `hardware: new HardwareKeyring({ storage })`.
- `background/main.ts`: drops `onHardwareChange`.
- `background/service.ts`: hardware bus cases as above, `signOnDevice` calls `HardwareSignHost`, `lock()` cancels
  open jobs, `hwView` moved to `shared/hardware-job.ts`, a second Approve during a device step answers
  `hw/in-progress` instead of revoking the running approval.
- `pages/mount.tsx`: the approval window wraps its bus client with the agent; `shared/hardware-client.ts` moved
  to `pages/hardware/client.ts`.

## Mobile / engine

`packages/engine` doesn't use the hardware package. The trust model for hosts is in the package README:
`acceptSignature` for a host whose device runs elsewhere, `sign` (with `signers`) for one that drives it itself.

## Not covered

- An account record comes from the page that ran the device. The keyring checks it against its id and key shape,
  but can't prove the address belongs to that key without the chain module; a compromised page could already show
  any address on Receive, so this adds no new exposure.
- No e2e drives a real or emulated device in the browser; the extension unit tests run the window's agent against
  the background over the bus schema with recorded Ledger APDU sessions.
