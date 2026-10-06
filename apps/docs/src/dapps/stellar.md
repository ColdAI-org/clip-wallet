# Stellar

Clip Wallet injects a **SEP-43** wallet at `window.clipwallet.stellar`. Stellar Wallets Kit lists only the modules a
dapp passes, so add Clip's: `ClipWalletModule` from `@clip-wallet/kit-modules/stellar`.

```sh
npm i @clip-wallet/kit-modules
```

<<< @/snippets/dapps/stellar.ts

The module implements the kit's module interface (`getAddress`, `getNetwork`, `signTransaction`, `signAuthEntry`,
`signMessage`), turning SEP-43 `{ error }` results into the errors the kit expects. Messages are signed per SEP-53.

::: info TypeScript
`ClipWalletModule` declares `moduleType` as a string rather than the kit's `ModuleType` enum, so TypeScript needs the
cast shown above. The values are the same at run time.
:::

## Tested

- **Dapp matrix**, testnet: the module connects, a SEP-53 message verifies with `Keypair.verify`, a 1-stroop payment is
  signed, submitted to Horizon and confirmed, and the approval names amount and recipient.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/stellar.ts)
- **Picker matrix**: Stellar Wallets Kit 2.7.0 with `defaultModules()` plus the module lists Clip, connects,
  reconnects and restores. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/stellar.tsx)
