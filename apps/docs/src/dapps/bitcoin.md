# Bitcoin

Clip Wallet registers a **Wallet Standard** wallet with `bitcoin:*` features (connect, sign a PSBT, sign and send, sign a
message) and a **sats-connect** provider (`sats-connect:`), on Bitcoin testnet4. Addresses are native segwit
(`tb1q…`); taproot is supported for signing.

<<< @/snippets/dapps/bitcoin.ts

sats-connect methods Clip implements: `getInfo`, `getAddresses`, `getAccounts`, `wallet_connect`,
`wallet_requestPermissions`, `wallet_disconnect`, `wallet_renouncePermissions`, `signMessage` (BIP-322 and BIP-137),
`signPsbt` (`{ psbt, signInputs, broadcast }`) and `sendTransfer`. Results come back in sats-connect's JSON-RPC
envelope; rejection is `-32000`. Not implemented: the legacy JWT methods, `window.btc_providers`, runes, inscriptions
and Stacks.

::: warning Collectibles on coins
Clip warns before spending a coin that holds an ordinal inscription, and refuses to sign when it would lose one by
accident.
:::

## Tested

- **Dapp matrix**, testnet4: Wallet Standard discovery and the sats-connect provider connect, a BIP-322 signature
  verifies with `bip322-js`, and an earlier funded run sent and confirmed a transfer.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/bitcoin.ts)
- **Picker matrix**: the stock sats-connect selector lists only its own built-in wallets, so Clip doesn't appear there
  until it is listed. Find it through the Wallet Standard as above. [Results](../testing/results/picker-matrix.md)
