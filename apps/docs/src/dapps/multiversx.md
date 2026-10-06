# MultiversX (best effort)

::: warning Best effort, through an undocumented hook
MultiversX has no wallet-discovery standard for browser extensions. Clip Wallet adds itself to
`window.multiversx.providers`, which `@multiversx/sdk-dapp` 5 merges into its custom providers in `initApp`. sdk-dapp
documents that list as something the dapp sets, not as a channel for wallets, so it can change without notice, and it
works only on sdk-dapp dapps that don't replace `window.multiversx` (MultiversX's own template dapp does replace it).
:::

When it works, Clip appears in the dapp's login options under its own name and icon (type `clipwallet`), never as
"extension" or the MultiversX DeFi Wallet. Clip doesn't answer the DeFi Wallet's message protocol.

| Supported | |
| --- | --- |
| `login({ token })` | connect; with a native-auth token, also signs `address + token` (checked to be for this site) |
| `signTransaction(s)` | sdk-core `Transaction` objects, decoded before approval (EGLD, ESDT, staking calls) |
| `signMessage` | MultiversX messages, verifiable with sdk-dapp's `verifyMessage` |
| Networks | mainnet (`mvx:1`), devnet, testnet |

There is no MultiversX WalletConnect namespace in Clip yet, so the hook is the only way a dapp reaches it.

## Tested

- **Dapp matrix**, devnet: `@multiversx/sdk-dapp` 5.7.3 `initApp` + `ProviderFactory` finds Clip through the hook and
  connects, and a signed message verifies with `verifyMessage`. The send and approval levels wait for devnet EGLD.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/multiversx.ts)
