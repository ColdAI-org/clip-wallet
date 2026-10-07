# Cosmos SDK chains (Keplr-compatible)

Clip Wallet answers the **Keplr API** at `window.clipwallet.cosmos` (a kit-built wallet uses its own global key). It
never sets `window.keplr`: a dapp written for Keplr works by passing this object where it used `window.keplr`, and
lists Clip under its own name. Method names, arguments and results follow Keplr's `Keplr` interface
(`@keplr-wallet/types` 0.13), including the cosmjs offline signers.

<<< @/snippets/dapps/cosmos.ts

| Supported | |
| --- | --- |
| `enable(chainIds)`, `disable()` | the connect approval, per chain |
| `getKey(chainId)` | `bech32Address`, `pubKey`, `algo` (`secp256k1`, or `ethsecp256k1` on Initia) |
| `signDirect`, `signAmino` | transactions, decoded into plain words before approval |
| `signArbitrary`, `verifyArbitrary` | ADR-36 messages |
| `sendTx(chainId, tx, mode)` | broadcast through the wallet's node |
| `getOfflineSigner`, `getOfflineSignerOnlyAmino`, `getOfflineSignerAuto` | cosmjs signers (`SigningStargateClient.connectWithSigner`) |
| `getChainInfosWithoutEndpoints`, `getChainInfoWithoutEndpoints` | the chains Clip ships |
| `on("keystorechange")` | account changes; also the window event `clipwallet_keystorechange` |
| Chains | Osmosis, dYdX, ZIGChain, Provenance, THORChain, Initia, and their testnets where one exists |

`experimentalSuggestChain` resolves for a chain Clip already ships and refuses any other: a website can't add chains
to the wallet. Each chain id maps to one wallet family (`cosmos`, `provenance`, `thorchain`, `initia`), so permissions
and accounts are per family. See [Networks](../reference/networks.md) for coin types and network ids.

## Tested

- **Dapp matrix**, osmo-test-5: cosmjs `SigningStargateClient` over `window.clipwallet.cosmos` connects and an ADR-36
  signature verifies with `@cosmjs/crypto`. The send and approval levels wait for testnet OSMO.
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/cosmos.ts)
