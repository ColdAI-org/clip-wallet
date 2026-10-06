# Compatibility promise

Dapps that don't know Clip Wallet, and never use Clip Connect, keep working exactly as before. Every new capability is
additive and opt-in.

## What is guaranteed

For every connector 1Mask ships, a change must not alter:

- method results,
- events,
- error codes,
- timing a dapp library can observe.

The connectors: EIP-1193 + EIP-6963; the Wallet Standard wallets for Solana, Sui, Aptos and Bitcoin; CIP-30;
`injectedWeb3`; get-starknet; TON Connect; the NEAR, Stellar and Algorand providers; Beacon; WalletConnect.

In practice:

- **New methods are additive.** The EIP-5792 methods used to answer `4200`; now they answer only when a site calls them.
  Nothing else in the EVM provider changed.
- **Opt-in at every layer.** The 1Mask router and the WalletConnect wallet serve them only when their host passes
  `calls`. A WalletConnect session gets them only if the app's proposal asked; otherwise its namespaces are byte for
  byte what they were.
- **No behaviour switches for unknown dapps.** Clip doesn't detect libraries, doesn't switch modes per site, and
  doesn't claim `window.ethereum`.

## How it's checked

`apps/extension/e2e/compat.spec.ts` runs real, unmodified dapp libraries against the built extension, with no Clip SDK
anywhere:

| Dapp library | What it does |
| --- | --- |
| wagmi / viem | EIP-6963 discovery, connect, `signMessage` verified with viem, `sendTransaction` declined (`4001`) |
| `@solana/wallet-adapter` | Wallet Standard detection, connect, `signMessage` |
| Sui `@mysten/wallet-standard` | dapp-kit's detection and `standard:connect` |
| Cardano CIP-30 | `window.cardano` detection, `enable()`, `getNetworkId()` |
| `@polkadot/extension-dapp` | `web3Enable`, `web3Accounts` |
| Reown AppKit | lists the wallet from EIP-6963 with all Reown traffic blocked |
| plain `window.ethereum` dapp | with another wallet owning `window.ethereum`, and with none |

Each scenario records what the library saw and everything that crossed 1Mask's wire (results, error codes and events,
with addresses and signatures reduced to their shapes), and compares both with a snapshot recorded before the change.
Passing means "identical before and after".

```sh
pnpm --filter @clip-wallet/extension build
pnpm --filter @clip-wallet/extension exec playwright test e2e/compat.spec.ts
```

## When a change must alter the wire

1. Say why, in the change and in [`docs/compat.md`](repo:docs/compat.md).
2. Make it opt-in if it can be: a new method, a capability, a connector option.
3. Re-record with `COMPAT_UPDATE=1` and review the snapshot diff line by line.

The deliberate fixes so far (such as making `window.injectedWeb3` writable, which `@polkadot/extension-dapp` needs) are
listed in [`docs/compat.md`](repo:docs/compat.md).
