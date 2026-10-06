# Stacks (SIP-030 and WBIP-004)

Clip Wallet's Stacks provider implements **SIP-030** at `window.clipwallet.stacks` and registers on
`window.wbip_providers` (**WBIP-004**), which is where `@stacks/connect` 8 finds wallets for its picker. As SIP-030
asks, it never sets a shared global (`window.StacksProvider`, `window.LeatherProvider` or `window.XverseProviders`).

<<< @/snippets/dapps/stacks.ts

With `@stacks/connect`, nothing extra is needed: its `request()` lists Clip under its own name and resolves the
provider from its WBIP-004 id (`clipwallet.stacks`).

| Supported | |
| --- | --- |
| `stx_getAddresses` (and `getAddresses`) | the connect approval, then `{ addresses }` |
| `stx_getNetworks` | the networks Clip ships |
| `stx_transferStx`, `stx_transferSip10Ft`, `stx_transferSip9Nft` | transfers |
| `stx_callContract`, `stx_deployContract`, `stx_signTransaction` | contract calls, deployments, signing a built transaction |
| `stx_signMessage`, `stx_signStructuredMessage` | messages (SIP-018 for structured data) |
| Errors | SIP-030 JSON-RPC codes: `-32000` user rejection, `-32002` access denied, `-32601`, `-32602` |
| Networks | `"mainnet"`, `"testnet"` or the CAIP-2 id in the `network` param |

## Tested

- **Dapp matrix**, testnet: `@stacks/connect` 8 `request()` through WBIP-004 connects, a signed message verifies with
  `verifyMessageSignatureRsv`, an STX transfer confirms on the testnet, and the approval reads "Send 0.000001 STX to …".
  [Results](../testing/results/dapp-matrix.md) · [test page](repo:apps/extension/e2e/matrix/dapps/stacks.ts)
