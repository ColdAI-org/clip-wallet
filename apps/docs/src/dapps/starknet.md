# Starknet

Clip Wallet injects a get-starknet v4 wallet at `window.starknet_clipwallet` (id `clipwallet`), implementing the
Starknet wallet API: `wallet_requestAccounts`, `wallet_requestChainId`, `wallet_signTypedData` (SNIP-12) and
`wallet_addInvokeTransaction`, on Starknet Sepolia. Accounts are OpenZeppelin accounts, deployed by their first
transaction.

## get-starknet

<<< @/snippets/dapps/starknet.ts

## starknetkit

starknetkit's default connector list is fixed. Until Clip is in it, add an `InjectedConnector` for its id; the name and
icon are read from the injected wallet:

<<< @/snippets/dapps/starknetkit.ts

## Tested

- **Dapp matrix**, Sepolia: get-starknet-core discovery connects, SNIP-12 typed data verifies with starknet.js, and an
  STRK transfer is confirmed (the first one also deployed the account). [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/starknet.ts)
- **Picker matrix**: starknetkit 3.4.3 with the connector above lists Clip with its icon, connects, reconnects and
  restores. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/starknetkit.tsx)
