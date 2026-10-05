# r1/clip-connect: integration (EIP-5792, ERC-7682, Clip Connect)

Stream: the Wallet Call API (EIP-5792) with auxiliary funds (ERC-7682) in 1Mask and over WalletConnect, the
dapp-side SDK `@clip-wallet/connect` (Clip Connect), and a compatibility suite that proves dapps that don't know Clip
see no difference. Guarantees and suite: [docs/compat.md](../../compat.md). SDK: `packages/connect/README.md`.

## New

| Path | What |
|---|---|
| `packages/connect` | `@clip-wallet/connect`: `connect()`, `pay()`, `balances()`, `request()`, CAIP helpers. `./react`, `./wagmi` and `./solana` adapters. No `@clip-wallet/*` dependency (tested). |
| `packages/1mask/src/shared/calls.ts` | EIP-5792 / ERC-7682 wire types, error codes, `parseSendCalls`, `CallsHost` |
| `packages/1mask/src/background/eip5792.ts` | router dispatch for the four methods |
| `packages/engine/src/calls-batch.ts` (`@clip-wallet/engine/calls-batch`) | split / merge / plan for a batch, status store (24 h, per origin), sequential run |
| `packages/route/src/auxiliary-funds.ts` | `auxiliaryFundsFor()` and `settleSourceNetworks()`: the static ERC-7682 advertisement |
| `packages/extension-kit/src/background/calls.ts` | `BackgroundCalls`: the extension's `CallsHost` (receipts, Activity, wallet UI) |
| `apps/extension/e2e/compat.spec.ts`, `e2e/compat/*` | compat suite plus snapshots recorded on main 314ce30 |
| `apps/extension/e2e/calls.spec.ts`, `e2e/calls/dapp.ts` | `wallet_sendCalls` with auxiliary funds: fixture build (simulator, and a Clip Connect page) and real build |
| `templates/scaffold-hbar-clip-wallet/packages/nextjs/app/clip-connect/page.tsx` | the template's Clip Connect demo page |

## Shared files touched

All edits are additive.

- **`packages/core/src/index.ts`**: `DappRequest.batch?` (the call's place in a batch, and the earlier calls). Also
  new `bg.*` messages in `messages/en/*` and all 11 locales: `bg.req.batchSteps`, `bg.label.appSaysNeeds`,
  `bg.act.batch`, `bg.act.batchStopped` and `bg.err.batchHardware`.
- **`packages/1mask`**:
  - `router.ts`: the `calls?: CallsHost` option, and two guarded lines (allowlist and dispatch). Without `calls` the
    router is unchanged.
  - `walletconnect/wallet.ts`: the `calls?` option, `answerCalls()`, and `scopedProperties` on approve.
  - `namespaces.ts`: `extraMethods`.
  - `inpage/substrate.ts`: `window.injectedWeb3` is writable (a fix; see compat.md).
- **`packages/chains-evm`**: `simulate(ctx, tx, prior)` runs the earlier calls of a batch in the same
  `eth_simulateV1` block. `decode.ts` passes `req.batch.prior` to it.
- **`packages/extension-kit/src/background`**:
  - `service.ts`: `decodeRefined()` was extracted from `enqueueTransaction` with its body unchanged. Also added:
    - the batch branch in `enqueueTransaction`
    - `Pending.batch`
    - `approveBatch()` and `sendBatchCall()`
    - `readonly calls`
    - the settle replan keeps per-call steps
    - the `send-calls` dev simulator kind
  - `wiring.ts`:
    - the `DappHost.calls?` member
    - `Dependencies.auxiliaryFundsSources`
    - fixture builds use the real 1Mask router over the fixture networks (it was the mock connector), so e2e
      pages reach the fixture wallet through the real dapp path
  - `real.ts`: passes `host.calls` to the router and to WalletConnect.
  - `shared/messages.ts`: the `send-calls` simulator kind.
- **`packages/link/src/remote/host.ts`**: `remoteDappHost` passes `calls` through. While another device signs it
  reports `enabled() === false`, so the methods answer 4200. Before this change the wrapper silently dropped the
  member.
- **`packages/ui`**:
  - `ApprovalView.batch?`
  - the batch notice in `Approval.tsx` (`approval.batch.sequential`, 12 locales)
  - the `send-calls` simulator button
- **`tools/release`**:
  - `normalize-manifests.mjs`: the `@clip-wallet/connect` description, keywords and optional peers.
  - `sync-template.mjs`: also pins the template's `packages/nextjs` kit dependencies.
- **`apps/extension/package.json`**: dev dependencies for the compat suite (dapp-side libraries, esbuild) and
  `@clip-wallet/connect`.
- **`pnpm-workspace.yaml`**: `allowBuilds: '@reown/appkit': false` (its postinstall is only a version notice).

## Not wired (follow-ups)

- **Mobile engine** (`packages/engine/src/engine.ts`, `apps/mobile`). The shared module is ready
  (`@clip-wallet/engine/calls-batch`). Wiring takes the same ~60 lines as the extension's service: the batch branch
  in `enqueueTransaction`, `approveBatch`, a `CallsHost`, and passing `calls` to the engine's `OneMaskConnector` and
  `WalletConnectAdapter`. Until then, mobile WalletConnect sessions don't offer the methods, which is unchanged
  behaviour.
- **Clip Desktop** (`apps/desktop`, merged on main after this stream started). Its 1Mask relay gets the methods by
  passing `calls` the same way.
- **Hardware accounts.** A batch with a Ledger or Keystone account is refused with a plain message
  (`bg.err.batchHardware`). Signing call after call on a device after one approval needs a device UX.
- **EIP-7702.** EIP-7702 upgrades would let Clip report `atomic: ready` / `supported`. Today accounts are EOAs, so
  `atomic` is `unsupported`.
