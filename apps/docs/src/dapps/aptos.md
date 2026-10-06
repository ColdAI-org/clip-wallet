# Aptos

Clip Wallet speaks **AIP-62**, the Aptos Wallet Standard: `aptos:connect`, `aptos:network`, `aptos:signMessage`,
`aptos:signTransaction` and `aptos:signAndSubmitTransaction`, on `aptos:testnet`. The Aptos wallet adapter finds it.

<<< @/snippets/dapps/aptos.tsx

Without React, `getAptosWallets()` from `@aptos-labs/wallet-standard` returns it, named "Clip Wallet".

Messages follow AIP-62's `fullMessage` format; verify signatures with `@aptos-labs/ts-sdk` against that full message.

## Tested

- **Dapp matrix**, testnet: `getAptosWallets` connects and `aptos:signMessage` verifies with the ts-sdk. The transfer
  and approval levels wait for testnet APT; until then the approval says plainly "You don't have enough APT to pay the
  network fee." [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/aptos.ts)
- **Picker matrix**: the ant-design `WalletSelector` lists Clip, connects, reconnects and restores; Aptos Explorer lists
  and connects Clip. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/aptos.tsx)
