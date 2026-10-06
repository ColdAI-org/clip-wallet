# Algorand

Clip Wallet injects an ARC-1 provider at `window.clipwallet.algorand`. TxnLab's use-wallet v5 lists only the adapters a
dapp passes, so add Clip's: `clipWallet()` from `@clip-wallet/kit-modules/algorand` (wallet id `clip-wallet`).

```sh
npm i @clip-wallet/kit-modules @txnlab/use-wallet algosdk
```

<<< @/snippets/dapps/algorand.ts

- Transactions in a group that aren't from a connected account are sent with `signers: []` (ARC-1) and come back
  `null`.
- Message signing: use-wallet v5 and ARC-1 have none (ARC-60 is a draft), so the adapter doesn't offer it.
- Accounts are derived with ARC-52, like Pera's Universal Wallet; a 25-word Algorand mnemonic can't be imported.

## Tested

- **Dapp matrix**, TestNet: use-wallet v5 with the adapter connects, a 1-microAlgo payment is signed, sent to algod and
  confirmed, and the approval shows it decoded. [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/algorand.ts)
- **Picker matrix**: use-wallet-ui-react's `WalletButton` with the adapter lists Clip, connects, reconnects and
  restores. [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/algorand.tsx)
