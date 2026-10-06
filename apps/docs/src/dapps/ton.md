# TON Connect

Clip Wallet exposes TON Connect's **injected JS bridge** at `window.clipwallet.tonconnect`, bridge key `clipwallet`.
Accounts are wallet v5r1 on TON testnet.

## TON Connect UI

`@tonconnect/ui` shows only wallets in the official wallets list. Until Clip is listed (the listing is drafted), add it
with `includeWallets`:

<<< @/snippets/dapps/ton-ui.ts

## TON Connect SDK

With the SDK you can talk to the injected bridge directly:

<<< @/snippets/dapps/ton-sdk.ts

`signData` (text, binary and cell payloads) and `ton_proof` are supported. The coin on testnet is shown as GRAM.

## Tested

- **Dapp matrix**, testnet: `@tonconnect/sdk` over the injected bridge connects, `signData` verifies per the TON Connect
  sign-data spec, and the approval shows the transfer decoded. The send level waits for testnet funds.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/ton.ts)
- **Picker matrix**: `@tonconnect/ui` 3.0.2 with the `includeWallets` entry lists Clip under "Installed", connects,
  reconnects and restores. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/ton.tsx)
