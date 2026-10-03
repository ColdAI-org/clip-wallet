# @clip-wallet/kit-modules

Clip Wallet inside each ecosystem's own wallet picker. Import only the subpath you need:

| subpath | for | runs in | talks to |
|---|---|---|---|
| `@clip-wallet/kit-modules/near` | NEAR Wallet Selector v10 (`setupClipWallet()`) | dApp | `window.clipwallet.near` (1Mask `inpage/near.ts`) |
| `@clip-wallet/kit-modules/stellar` | Stellar Wallets Kit v2 (`new ClipWalletModule()`) | dApp | `window.clipwallet.stellar` (SEP-43, 1Mask `inpage/stellar.ts`) |
| `@clip-wallet/kit-modules/algorand` | TxnLab use-wallet v5 (`clipWallet()`) | dApp | `window.clipwallet.algorand` (1Mask `inpage/algorand.ts`) |
| `@clip-wallet/kit-modules/tezos` | Beacon / TZIP-10, wallet side | Clip Wallet background | 1Mask's Beacon page relay (`inpage/tezos.ts`) and Beacon's Matrix P2P |

NEAR Connect (the connector the NEAR Infra Committee now recommends over Wallet Selector) needs no module:
1Mask answers its `near-selector-ready` event with a `near-wallet-injected` wallet (`inpage/near.ts`).

## Usage

```ts
// NEAR Wallet Selector
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupClipWallet } from "@clip-wallet/kit-modules/near";
const selector = await setupWalletSelector({ network: "testnet", modules: [setupClipWallet()] });

// Stellar Wallets Kit
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";
StellarWalletsKit.init({ modules: [...defaultModules(), new ClipWalletModule()] });

// use-wallet v5
import { WalletManager } from "@txnlab/use-wallet";
import { clipWallet } from "@clip-wallet/kit-modules/algorand";
const manager = new WalletManager({ wallets: [clipWallet()], defaultNetwork: "testnet" });
```

```ts
// Wallet side (extension background): Beacon extension peer, answering through the 1Mask router
import { createBeaconExtensionPeer } from "@clip-wallet/kit-modules/tezos";
const beacon = createBeaconExtensionPeer({ name: "Clip Wallet", iconUrl, storage, dispatch: (origin, input) => router.dispatch(origin, input) });
```

Kit-built wallets inject under their own global: pass `globalKey` to each module.

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
