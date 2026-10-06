# Sui

Clip Wallet registers a **Wallet Standard** wallet for Sui with `sui:signTransaction`,
`sui:signAndExecuteTransaction` and `sui:signPersonalMessage`, on `sui:testnet`. `@mysten/dapp-kit` lists it next to
the other Sui wallets.

<<< @/snippets/dapps/sui.tsx

Without dapp-kit, find it the way dapp-kit does: `getWallets()` from `@mysten/wallet-standard`, filtered with
`isWalletWithRequiredFeatureSet(w, ["sui:signTransaction"])` and a `sui:` chain. Clip also registers Wallet Standard
wallets for Solana, Aptos and Bitcoin under the same name, so filter by features, not by name alone.

## Tested

- **Dapp matrix**, testnet: dapp-kit's detection connects, `sui:signPersonalMessage` verifies with
  `verifyPersonalMessageSignature`, a coin split to yourself is confirmed, and the approval names it.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/sui.ts)
- **Picker matrix**: dapp-kit's `ConnectButton` lists Clip, connects, reconnects and restores. Suiscan lists and
  connects Clip. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/sui.tsx)
