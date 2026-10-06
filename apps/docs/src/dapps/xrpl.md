# XRP Ledger (XLS-72d)

Clip Wallet registers an **XLS-72d** wallet on the Wallet Standard, under its own name and icon (it never claims to be
GemWallet, Crossmark or Xaman). Dapps that discover XRPL wallets through `@wallet-standard/app` with the
`@xrpl-wallet-standard/app` feature filter list it like any other.

| Supported | |
| --- | --- |
| `standard:connect`, `standard:disconnect`, `standard:events` | connect approval, accounts, account changes |
| `xrpl:signTransaction` | sign a transaction the dapp built; returns the signed blob |
| `xrpl:signAndSubmitTransaction` | sign and submit; returns the transaction hash |
| Chains | `xrpl:0` (mainnet), `xrpl:1` (testnet), `xrpl:2` (devnet) |

XLS-72d has no message signing, so there is none to call. Every transaction is decoded into plain words before
approval ("Send 10 XRP to r…", "Change your account settings"), with memos shown.

## Tested

- **Dapp matrix**, testnet: Wallet Standard discovery with the XLS-72d feature filter connects, and a signed and
  submitted AccountSet with a memo validates on the testnet (rippled refuses a payment to yourself); the approval names
  it. [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/xrpl.ts)
