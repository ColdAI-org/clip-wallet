# NEAR

Clip Wallet supports both ways NEAR dapps connect:

- **NEAR Connect** (the connector the NEAR Infra Committee recommends): no module needed. Clip answers its
  `near-selector-ready` event with an injected wallet.
- **NEAR Wallet Selector** v10: add Clip's module, `setupClipWallet()` from `@clip-wallet/kit-modules/near`.

```sh
npm i @clip-wallet/kit-modules
```

<<< @/snippets/dapps/near.ts

| | |
| --- | --- |
| Provider | `window.clipwallet.near` (`window.<wallet key>.near` for kit-built wallets) |
| Accounts | implicit accounts (`hex(public key)`); they exist on chain once funded |
| `signIn` | never adds a function-call key: every transaction is approved in Clip |
| `signAndSendTransaction(s)` | yes |
| `signMessage` | NEP-413 |
| Refused | `signTransaction`, `signDelegateAction`, `createSignedTransaction` (Clip signs and sends in one approved step), `verifyOwner` (deprecated) |

The module shows the name and icon the installed wallet announces, so a kit-built wallet appears as itself; pass
`globalKey` if it injects under another key.

## Tested

- **Dapp matrix**, testnet: Wallet Selector v10 with the module connects and a NEP-413 signature verifies. The send
  level waits for testnet funds; until then the approval says "This account doesn't exist on NEAR yet. Receive some
  NEAR first". [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/near.ts)
- **Picker matrix**: Wallet Selector's modal UI with the module lists Clip, connects, reconnects and restores.
  [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/near.tsx)
