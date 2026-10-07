# TRON (TIP-1193 and TIP-6963)

Clip Wallet's TRON provider follows **TIP-1193** and is announced with **TIP-6963** under the wallet's own name, icon
and rdns. It never sets `isTronLink` and never touches `window.tronLink` or `window.tronWeb`. It is also at
`window.clipwallet.tron`.

<<< @/snippets/dapps/tron.ts

| Supported | |
| --- | --- |
| `eth_requestAccounts` | TIP-1102: the connect approval, then `[address]` |
| `eth_chainId`, `wallet_switchEthereumChain` | TRON chain ids (`0x2b6653dc` mainnet, `0xcd8690dc` Nile, `0x94a9059e` Shasta); TIP-3326 |
| `tronWeb.trx.sign(transaction)` | transactions your TronWeb built, decoded before approval |
| `tronWeb.trx.signMessageV2(message)` | messages |
| Events | `accountsChanged`, `chainChanged`, `connect`, `disconnect` (TIP-1193) |

TIP-1193 defines no signing methods: it says a provider carries a TronWeb as `tron.tronWeb`. Clip doesn't ship TronWeb
into the page; `tronWeb` is only the subset dapps sign through (`defaultAddress`, `trx.sign`, `trx.signMessageV2`).
Build transactions and read the chain with your own TronWeb. Legacy `trx.sign(hexString)` message signing,
`multiSign` and `_signTypedData` are refused with `4200`.

## Pickers

The TRON wallet adapters (`@tronweb3/tronwallet-adapters`) list a fixed set of wallets and don't yet accept a
third-party TIP-6963 wallet, so find Clip with TIP-6963 discovery as above.

## Tested

- **Dapp matrix**, Nile: raw TIP-6963 discovery and TIP-1193 connect, and `signMessageV2` verifies with TronWeb's
  `Trx.verifyMessageV2`. The send and approval levels wait for testnet TRX.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/tron.ts)
