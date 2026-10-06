# Tezos (Beacon)

Tezos dapps reach wallets through **Beacon** (TZIP-10), directly or through Taquito's `BeaconWallet`. Clip Wallet
answers Beacon's postMessage ping and pairing, so Beacon finds it, and runs the wallet side of Beacon in the
background. Accounts are `tz1…` on shadownet.

<<< @/snippets/dapps/tezos.ts

## The listing caveat

Beacon's modal **lists** Clip, but in beacon-ui 4.8 clicking an unlisted Chromium extension does nothing: "Use
Extension" is offered only for wallets in Beacon's built-in list (or Firefox ids). The listing is drafted and waits for
the public release. Until then, a dapp can pair with Clip directly, the way that button does for listed wallets:

<<< @/snippets/dapps/tezos-pair.ts

Once Clip is in Beacon's list, the stock modal connects and the handler can go.

Supported requests: permissions, `sign_payload` (Micheline and raw), operations (transactions, delegation, staking).
`broadcast_request` is refused. Beacon v2 messages only.

## Tested

- **Dapp matrix**, shadownet: Beacon's `DAppClient` pairs (with the handler above), a Micheline sign-in message
  verifies with `@taquito/utils`, and a 1-mutez transfer is confirmed. [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/tezos.ts)
- **Picker matrix**: Beacon 4.8.1's modal lists Clip but can't connect it (the test fails if that ever changes, so the
  docs get updated). [Results](../testing/results/picker-matrix.md)
