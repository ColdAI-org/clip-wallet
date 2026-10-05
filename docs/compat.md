# Compatibility guarantees

Dapps that don't know Clip Wallet, and never use Clip Connect (`@clip-wallet/connect`), must keep working exactly as
before. Every new dapp-facing capability is additive and opt-in.

## What is guaranteed

For every connector 1Mask ships, a change must not alter:

- method results
- events
- error codes
- timing that a dapp library can observe

The connectors are:

- EIP-1193 + EIP-6963 (EVM)
- the Wallet Standard wallets for Solana, Sui, Aptos and Bitcoin
- CIP-30 (Cardano)
- `injectedWeb3` (Polkadot SDK)
- get-starknet
- TON Connect
- the NEAR, Stellar and Algorand providers
- Beacon (Tezos)
- WalletConnect

In practice:

- **New methods are additive.** `wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus` and
  `wallet_showCallsStatus` (EIP-5792, with ERC-7682 `auxiliaryFunds`) used to answer 4200 "unsupported". Now they
  answer only when a site calls them. Nothing else in the EVM provider changed: not the provider state, not
  `eth_chainId` or `eth_accounts`, not permissions or events. A dapp that never calls the new methods sees no
  difference. The compat suite below checks this.
- **Opt-in at every layer.**
  - The 1Mask router serves the methods only when its host passes `calls` (`createOneMaskRouter({ calls })`).
  - The WalletConnect wallet does the same (`createWalletConnectWallet({ calls })`).
  - Without `calls`, both answer exactly as before; `packages/1mask/test/eip5792.test.ts` checks this.
  - A WalletConnect session gets the methods only if the app asked for them in its proposal. Otherwise the session's
    namespaces are byte-for-byte what they were.
- **No behaviour switches for unknown dapps.**
  - Clip doesn't detect libraries.
  - Clip doesn't switch modes per site.
  - Clip doesn't claim `window.ethereum` (it never has: the EVM provider is announced via EIP-6963 only).
  - The batch approval appears only for `wallet_sendCalls`.
- **One deliberate fix.** `window.injectedWeb3` was defined read-only, so `@polkadot/extension-dapp` threw on import
  in every Polkadot dapp with Clip installed. Its own strict-mode `win.injectedWeb3 = win.injectedWeb3 || {}` was
  the line that failed. It is writable now, like every other extension's. The compat suite found this bug. The
  Polkadot snapshot was recorded on the fixed build; every other snapshot was recorded on main before any change.

## The compat suite

`apps/extension/e2e/compat.spec.ts` runs real, unmodified dapp-side libraries against the built extension, with no
Clip SDK anywhere:

| Dapp library | What it does |
| --- | --- |
| wagmi / viem (`@wagmi/core`) | EIP-6963 discovery (wagmi's mipd store), connect, `signMessage` verified with viem, `sendTransaction` (declined in the wallet → 4001) |
| `@solana/wallet-adapter` (`StandardWalletAdapter` over `@wallet-standard/app`) | Wallet Standard detection, connect, `signMessage` |
| Sui `@mysten/wallet-standard` (dapp-kit's detection) | `isWalletWithRequiredFeatureSet`, `standard:connect` |
| Cardano CIP-30 | `window.cardano` detection, `enable()`, `getNetworkId()` |
| `@polkadot/extension-dapp` | `web3Enable`, `web3Accounts` |
| Reown AppKit (wagmi adapter) | lists the wallet from EIP-6963; the injected path needs no project id (all Reown traffic is blocked in the test) |
| plain `window.ethereum` dapp | with another wallet owning `window.ethereum` (Clip leaves it alone) and with none |

Each scenario records two things:

- **What the library saw.** Step results such as the account count, the chain id, signature validity and error codes.
- **What crossed 1Mask's wire.** Every page ↔ content-script request with the shape of its result or its error
  code, and every event (`e2e/compat/wire.ts`). Addresses, signatures, ids and times are reduced to shapes, and
  concurrent requests are compared as a set.

The suite compares both against `e2e/compat/snapshots/compat.json`, which was recorded against the build before
EIP-5792 and Clip Connect. Passing means "identical before and after".

```bash
pnpm --filter @clip-wallet/extension build     # NODE_OPTIONS=--conditions=development is in the script
pnpm --filter @clip-wallet/extension exec playwright test e2e/compat.spec.ts
# against another build (e.g. a checkout of main):
COMPAT_EXTENSION=/path/to/other/.output/chrome-mv3 pnpm --filter @clip-wallet/extension exec playwright test e2e/compat.spec.ts
# re-record, only for a deliberate change, and document it in this file:
COMPAT_UPDATE=1 pnpm --filter @clip-wallet/extension exec playwright test e2e/compat.spec.ts
```

The suite is part of `pnpm --filter @clip-wallet/extension e2e`. It uses the default (real wiring) build and no
funds: a transaction is declined in the approval window. The dapp bundles are built with esbuild in the test
(`apps/extension/.output-compat-dapps`, gitignored).

## When a change must alter wire behaviour

1. Say why in the change and here, under "One deliberate fix" or a new entry.
2. Make it opt-in if it can be: a new method, a capability, a new connector option.
3. Re-record with `COMPAT_UPDATE=1`, and review the snapshot diff line by line in the PR.

## Related

- `packages/connect/README.md`: Clip Connect, its capability table and what `pay()` does with each kind of wallet.
- `packages/1mask/src/shared/calls.ts`: the EIP-5792 / ERC-7682 wire shapes and validation, with sources.
- `apps/extension/e2e/calls.spec.ts`: `wallet_sendCalls` with auxiliary funds. It covers the fixture build (the dev
  simulator and a real page using Clip Connect) and the real build (capabilities, and a declined two-call batch).
