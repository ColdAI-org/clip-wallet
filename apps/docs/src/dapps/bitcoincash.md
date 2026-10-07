# Bitcoin Cash (WalletConnect)

Bitcoin Cash has no injected-provider standard. Dapps reach wallets over **WalletConnect v2** with the community
specification **wc2-bch-bcr** (used by Cashonize, Paytaca and Zapit, and apps such as TapSwap), and that is what Clip
Wallet answers. It needs a build with a WalletConnect project id (`CLIP_WALLETCONNECT_PROJECT_ID`).

| | |
| --- | --- |
| Namespace | `bch` |
| Chains | `bch:bitcoincash` (mainnet), `bch:bchtest` (chipnet, where BCH upgrades are tested) |
| Methods | `bch_getAddresses`, `bch_signTransaction`, `bch_signMessage` |
| Events | `addressesChanged` |

Pair from the dapp's WalletConnect QR code or link as with any other chain: see [WalletConnect](./walletconnect.md).
Every transaction is decoded into plain words before approval.

## Tested

- Unit tests run the wc2-bch-bcr session and requests against the wallet's WalletConnect host
  ([`packages/1mask/test/walletconnect-bch.test.ts`](repo:packages/1mask/test/walletconnect-bch.test.ts)). There is no
  dapp matrix row: it needs a WalletConnect project id and testnet BCH.
