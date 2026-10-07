# Fuel (FuelConnector)

Clip Wallet announces a **FuelConnector** with the `FuelConnector` window event, the way Fuel Wallet does, so every
fuels-ts `Fuel` instance on the page adds it to its connectors under Clip's own name and icon. Because a `Fuel` created
later misses an early event, Clip announces on install, on `DOMContentLoaded` and on `load`, and is also at
`window.clipwallet.fuel` for `new Fuel({ connectors: [window.clipwallet.fuel] })`.

<<< @/snippets/dapps/fuel.ts

| Supported | |
| --- | --- |
| `connect`, `disconnect`, `isConnected`, `accounts`, `currentAccount` | the connect approval and accounts |
| `sendTransaction(address, request)` | a fuels-ts `TransactionRequest`, decoded before approval; returns the transaction id |
| `signTransaction`, `signMessage` | signing without sending |
| `currentNetwork`, `networks`, `selectNetwork` | Fuel Ignition and the testnet |
| Not supported | `addNetwork`, `addAsset(s)`: a website can't add networks or assets to the wallet |

The connector is dependency-free: fuels-ts never runs inside the wallet's page script, and transactions cross to the
wallet as the same JSON Fuel Wallet's connector sends.

## Tested

- **Dapp matrix**, testnet: fuels-ts `Fuel` lists Clip's connector and connects, and a signed message recovers the
  account with `Signer.recoverAddress(hashMessage(…))`. The send and approval levels wait for testnet ETH.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/fuel.ts)
