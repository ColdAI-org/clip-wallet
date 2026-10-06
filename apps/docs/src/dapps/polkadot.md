# Polkadot SDK chains (injectWeb3)

Clip Wallet installs itself in `window.injectedWeb3` as **`clip-wallet`** (a kit-built wallet uses its own name in
kebab-case), which is how `@polkadot/extension-dapp`, polkadot.js apps and most Polkadot SDK dapps find extensions.
Accounts are sr25519, shown with the generic SS58 prefix 42; dapps re-encode for their chain.

<<< @/snippets/dapps/polkadot.ts

| Supported | |
| --- | --- |
| `accounts.get()`, `accounts.subscribe()` | the accounts the person shared with the site |
| `signer.signPayload` | extrinsics, decoded with the chain's metadata before approval |
| `signer.signRaw` | messages (`type: "bytes"`, wrapped in `<Bytes>` as polkadot.js does) |
| Networks | Westend, Paseo and their Asset Hubs |

::: info Metadata
Clip reads chain metadata from the chain itself and doesn't accept metadata from dapps (`metadata.provide()` refuses
it), so polkadot.js apps keeps showing "1 extension that needs to be updated". It's harmless.
:::

`window.injectedWeb3` is writable, like every other extension's, so `@polkadot/extension-dapp` can add to it.

## Pickers

DOT Connect lists every `injectedWeb3` extension; it names Clip "clip-wallet" with a generic icon because the
Polkadot extension interface has no name or icon field. Talisman Connect shows a fixed list of wallets; until Clip is
listed, add an entry to `walletList`.

## Tested

- **Dapp matrix**, Westend: `@polkadot/extension-dapp` + `@polkadot/api` connect, `signRaw` verifies with
  `signatureVerify`, `transferKeepAlive` is included in a block, and the approval names amount and recipient.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/substrate.ts)
- **Picker and hosted dapps**: polkadot.js apps on Westend connects and signs (sr25519 verified); DOT Connect connects;
  Talisman Connect connects with a list entry. [Results](../testing/results/picker-matrix.md)
