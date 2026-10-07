# Dapp and picker matrices

Two suites prove that Clip works with real dapps, on public testnets, with the real extension build and nothing
Clip-specific on the dapp side.

## The dapp matrix

For each family with a dapp standard, that ecosystem's own dapp library in a local page talks to the real public testnet.

| Level | Passes when |
| --- | --- |
| **L1 connect** | the dapp finds Clip through the ecosystem's standard discovery and gets the matrix account, which the family's module re-derives from the vault's public key |
| **L2 sign** | the dapp signs a message and the ecosystem's own verify function accepts it |
| **L3 send** | the dapp signs and broadcasts the smallest self-transfer and the testnet's public RPC or explorer confirms it |
| **L4 approval** | the approval shows the decoded request (amount, symbol, recipient), not blind, with no overflowing rows; a screenshot is taken |

L3 skips while the account holds less than its minimum, and L4 then declines the same request in the wallet.

```sh
pnpm --filter @clip-wallet/extension matrix                  # builds, then runs every family
pnpm --filter @clip-wallet/extension matrix -- -g cardano    # one family
node scripts/dapp-matrix-balances.mjs --watch                # watch faucet funds land
```

The local pages are in [`apps/extension/e2e/matrix/dapps`](repo:apps/extension/e2e/matrix/dapps), one per family, and
are the best copy-paste reference for each ecosystem. The latest results:
[Dapp matrix results](./results/dapp-matrix.md).

## The picker matrix

Does Clip show up, look right and connect in the wallet pickers dapps actually ship?

- **Part 1:** each ecosystem's stock connect UI, unmodified, in a local page per origin: listed (with the announced
  name), icon right, connects, disconnects and reconnects, restores after a reload. Pickers that show only their own
  registry are recorded as "not listed (expected)" and tested again with the one module or entry a dapp adds.
- **Part 2:** real hosted testnet dapps loaded by URL (polkadot.js apps, the Solana wallet-adapter example, Aptos
  Explorer, Suiscan, HashScan, Reown AppKit Lab…), with one free, reversible signed action where there is one.

```sh
pnpm --filter @clip-wallet/extension pickers                              # both parts
pnpm --filter @clip-wallet/extension pickers -- -g "ton|near"             # some pickers
pnpm --filter @clip-wallet/extension pickers -- e2e/hosted-dapps.spec.ts  # part 2 only
```

The picker pages are in [`apps/extension/e2e/pickers/dapps/src`](repo:apps/extension/e2e/pickers/dapps/src). The latest
results, the pickers that need a listing and the open findings: [Picker matrix results](./results/picker-matrix.md).

## What they need

- A **dedicated test wallet**, funded on each testnet: see [Fund a test wallet](./test-wallet.md).
- Optionally a **WalletConnect project id** (`WALLETCONNECT_PROJECT_ID` in the same env file) for the Hedera
  WalletConnect rows; without it they skip with that reason.
- Network access to the public testnets.

Both suites turn tracing, failure screenshots and video off for the whole run, so the wallet's phrase can never land in
a test artifact.
