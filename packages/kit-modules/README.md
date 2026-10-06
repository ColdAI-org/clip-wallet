# @clip-wallet/kit-modules

Clip Wallet inside each ecosystem's own wallet picker, for pickers that list only the modules a dapp passes. Import
only the subpath you need:

| Subpath | For | Runs in | Talks to |
|---|---|---|---|
| `@clip-wallet/kit-modules/near` | NEAR Wallet Selector v10 (`setupClipWallet()`) | dapp | `window.clipwallet.near` |
| `@clip-wallet/kit-modules/stellar` | Stellar Wallets Kit v2 (`new ClipWalletModule()`) | dapp | `window.clipwallet.stellar` (SEP-43) |
| `@clip-wallet/kit-modules/algorand` | TxnLab use-wallet v5 (`clipWallet()`) | dapp | `window.clipwallet.algorand` |
| `@clip-wallet/kit-modules/tezos` | Beacon / TZIP-10, wallet side | the wallet's background | 1Mask's Beacon page relay and Beacon's Matrix P2P |

NEAR Connect needs no module: 1Mask answers its `near-selector-ready` event. Modules show the name and icon the
installed wallet announces, so kit-built wallets appear as themselves; pass `globalKey` if a wallet injects under
another key.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/kit-modules
```

## Example

```ts
// NEAR Wallet Selector
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupClipWallet } from "@clip-wallet/kit-modules/near";

export const selector = await setupWalletSelector({ network: "testnet", modules: [setupClipWallet()] });
```

```ts
// Stellar Wallets Kit (the module matches the kit's interface at run time; TypeScript needs the cast)
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks, type ModuleInterface } from "@creit.tech/stellar-wallets-kit/types";
import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";

StellarWalletsKit.init({ modules: [...defaultModules(), new ClipWalletModule() as unknown as ModuleInterface], network: Networks.TESTNET });
```

```ts
// use-wallet v5
import { NetworkId, WalletManager } from "@txnlab/use-wallet";
import { clipWallet } from "@clip-wallet/kit-modules/algorand";

export const manager = new WalletManager({ wallets: [clipWallet()], defaultNetwork: NetworkId.TESTNET });
```

Peers, each optional (install the ones for your ecosystem): `@near-wallet-selector/core`, `@near-js/crypto`,
`@txnlab/use-wallet`, `algosdk`.

## Documentation

- [NEAR guide](https://coldai.org/clip/docs/dapps/near.html)
- [Stellar guide](https://coldai.org/clip/docs/dapps/stellar.html)
- [Algorand guide](https://coldai.org/clip/docs/dapps/algorand.html)
- [Tezos guide](https://coldai.org/clip/docs/dapps/tezos.html)
- [API reference](https://coldai.org/clip/docs/reference/api/kit-modules.html)

## Notes

- **NEAR:** actions go to the wallet as wallet-selector `InternalAction` JSON (NAJ `Action`s are converted with
  the core's own `najActionToInternal`); bytes travel as `argsBase64` / `codeBase64`. `signIn` never adds a
  function-call key; every transaction is approved in Clip. `signTransaction`, `signDelegateAction` and
  `createSignedTransaction` are refused (Clip signs and sends in one approved step). `verifyOwner` is refused
  (deprecated; use `signMessage`, NEP-413).
- **Stellar:** the kit's `ModuleInterface` is copied structurally from v2.7.0 so this package doesn't install the
  kit (its dependency tree includes Reown AppKit, Ledger and Trezor). SEP-43 `{ error }` results become rejected
  `IKitError`s, as the kit expects.
- **Algorand:** follows use-wallet's third-party adapter contract (extends `BaseWallet` from
  `@txnlab/use-wallet/adapter`, exports `WALLET_ID` and a factory returning `WalletAdapterConfig`, peer deps
  `@txnlab/use-wallet ^5` and `algosdk ^3`). Transactions not from a connected account are sent with
  `signers: []` (ARC-1) and come back `null`. ARC-60 `signData` is not offered (Draft).
- **Tezos:** Beacon's own crypto (`@airgap/beacon-core` MessageBasedClient, `@airgap/beacon-utils`). The peer's
  keypair is a Beacon *communication* key from `getKeypairFromSeed(random seed in storage)`, not account key
  material; account signatures still come from the vault through `dispatch`. Tezos dApps send Beacon v2
  messages; v3 (other chains) is answered with an error. `broadcast_request` is refused (`BROADCAST_ERROR`).
  Beacon packages need a global `Buffer` (polyfill in the bundle).
  The interop test runs Beacon's own dApp-side `PostMessageClient` against 1Mask's relay and this peer.

## Sources

- NEAR Wallet Selector module types: `@near-wallet-selector/core` 10.1.4 `src/lib/wallet/wallet.types.d.ts`,
  `transactions.types.d.ts`, `helpers/transform-action`; https://github.com/near/wallet-selector
- NEAR Connect injected wallets and manifest: https://github.com/azbang/near-connect (README "Injected wallets",
  `src/types/index.ts` `NearWalletBase`)
- SEP-43: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
- Stellar Wallets Kit module guide: https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/wallets/create-wallet-module.md
- use-wallet v5 adapters: https://github.com/TxnLab/use-wallet/blob/main/docs/resources/third-party-adapters.md,
  `@txnlab/use-wallet-exodus` 5.0.1 (reference injected adapter)
- ARC-1 / ARC-6 / ARC-7 / ARC-8 / ARC-10: https://github.com/algorandfoundation/ARCs
- Beacon: https://docs.walletbeacon.io, https://github.com/airgap-it/beacon-sdk (`@airgap/beacon-wallet` 4.8.1
  WalletClient, `@airgap/beacon-transport-postmessage` 4.8.0 PostMessageClient/Transport, `@airgap/beacon-types` 4.8.0)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
