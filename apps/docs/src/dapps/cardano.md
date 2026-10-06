# Cardano (CIP-30)

Clip Wallet installs a **CIP-30** wallet at `window.cardano.clipwallet` (a kit-built wallet uses its own key, such as
`window.cardano.acmewallet`). Every CIP-30 library reads that object: Mesh, Lucid, cardano-connect-with-wallet.

| | |
| --- | --- |
| `name`, `icon`, `apiVersion` | "Clip Wallet", the announced icon, `"1"` |
| Network | preprod and preview (`getNetworkId()` returns `0`) |
| Addresses | the CIP-1852 base address (payment key + stake key); change goes back to it |
| Methods | `getNetworkId`, `getUtxos`, `getBalance`, `getUsedAddresses`, `getUnusedAddresses`, `getChangeAddress`, `getRewardAddresses`, `signTx`, `signData` (CIP-8), `submitTx` |

## Plain CIP-30

<<< @/snippets/dapps/cardano.ts

## Mesh

Mesh's `CardanoWallet` lists every CIP-30 wallet:

<<< @/snippets/dapps/cardano-mesh.tsx

::: info cardano-connect-with-wallet
This library shows only the wallets in its own registry. Until Clip is listed there, add `"clipwallet"` to
`supportedWallets`; it then appears as "Clipwallet" (unlisted wallets are named by their `window.cardano` key).
:::

## Tested

- **Dapp matrix**, preprod: CIP-30 discovery connects, `signData` verifies with the Cardano Foundation's CIP-8
  verifier, a 1 ADA self-transfer built from `getUtxos` is signed, submitted and confirmed, and the approval says
  "Move your ADA between your own addresses". [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/cardano.ts)
- **Picker matrix**: Mesh's `CardanoWallet` lists Clip, connects, reconnects and restores.
  [Results](../testing/results/picker-matrix.md) · [test page](repo:apps/extension/e2e/pickers/dapps/src/mesh.tsx)
