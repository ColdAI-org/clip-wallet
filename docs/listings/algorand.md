# Listing draft: Algorand (TxnLab use-wallet v5)

> DRAFT ONLY. Do not publish the package or open the issue/PR until Clip Wallet is released. Nothing has been submitted.

use-wallet v5 makes every wallet a standalone adapter package. Third parties publish and maintain their own; TxnLab lists
them in "Supported Wallets → Third-Party Adapters" (docs/resources/third-party-adapters.md). Listing criteria:

1. Public source repository, linked from the npm package's `repository` field.
2. Open-source license (MIT recommended).
3. Follows the adapter contract: peer deps `@txnlab/use-wallet ^5.0.0` and `algosdk ^3.0.0`; extends `BaseWallet` from
   `@txnlab/use-wallet/adapter`; exports a factory returning `WalletAdapterConfig` plus a `WALLET_ID` constant; optional
   capabilities and the shared `metadata` option.
4. Actively maintained, public issue tracker. npm provenance strongly recommended.

`packages/kit-modules/src/algorand/index.ts` already follows this (`clipWallet()`, `ClipWalletAdapter`, `WALLET_ID`).

## Prerequisites
- [ ] Publish a standalone package, e.g. `@coldai/use-wallet-clip` (same code, peer deps only; MIT; `repository` set),
      with npm provenance from CI.
- [ ] Public repo + issue tracker.
- [ ] Icon (data URI in `defaultMetadata`).
- [ ] Decide `capabilities.supportedNetworks` for the release build (testnet-only builds: `["testnet"]`).

## Issue/PR to TxnLab/use-wallet

**Title:** `docs: list Clip Wallet third-party adapter`

**Body:**

```md
## Adapter
- npm: https://www.npmjs.com/package/<package>
- Source: <repo url> (MIT)
- Wallet: Clip Wallet, a non-custodial browser extension (injected provider at `window.clipwallet.algorand`:
  ARC-1 signTxns, ARC-6 enable).

## Contract
- Extends `BaseWallet` from `@txnlab/use-wallet/adapter`; factory `clipWallet()` returns `WalletAdapterConfig`;
  exports `WALLET_ID = "clip-wallet"`; peer deps `@txnlab/use-wallet ^5`, `algosdk ^3`.
- Transactions not from a connected account are sent with `signers: []` and come back `null` (ARC-1).
- Accounts: ARC-52 (BIP32-Ed25519) HD accounts, same derivation as Pera Universal Wallet.

## Docs entry (Supported Wallets → Third-Party Adapters)
#### Clip Wallet
npm install <package>
import { clipWallet } from '<package>'
const manager = new WalletManager({ wallets: [clipWallet()] })
```

Clip Wallet is also reachable via use-wallet's WalletConnect adapter (namespace `algorand`, `algo_signTxn`) once the
extension's WalletConnect side includes the `algorand` namespace (integration patch); a WalletConnect "skin"
(`{ id: 'clip', name: 'Clip Wallet', icon }`) can be documented for mobile.

## Sources
- https://github.com/TxnLab/use-wallet/blob/main/docs/resources/third-party-adapters.md
- https://github.com/TxnLab/use-wallet/blob/main/docs/getting-started/supported-wallets.md
- https://github.com/algorandfoundation/ARCs (ARC-1, ARC-6, ARC-25, ARC-52)
