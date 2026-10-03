# Listing draft: Stellar Wallets Kit

> DRAFT ONLY. Do not open this PR until Clip Wallet is published. Nothing has been submitted.

Stellar Wallets Kit (github.com/Creit-Tech/Stellar-Wallets-Kit) lists wallets as modules implementing its
`ModuleInterface`. Its guide (`docs/files/wallets/create-wallet-module.md`) says: build the module, then "open a PR with
the module and we will review", listing any extra dependency (e.g. a Buffer polyfill). Ours needs none.

Until it is merged, dApps can add it themselves:
`StellarWalletsKit.init({ modules: [...defaultModules(), new ClipWalletModule()] })` from `@clip-wallet/kit-modules/stellar`.

## Prerequisites
- [ ] Chrome Web Store listing and product URL.
- [ ] Icon: the kit hosts icons at `https://stellar.creit.tech/wallet-icons/<id>.png`; send ours with the PR.
- [ ] Decide whether to ask for inclusion in `sep43Modules()` (our provider follows SEP-43 exactly) as well as `defaultModules()`.

## PR to Creit-Tech/Stellar-Wallets-Kit

**Title:** `feat(modules): add Clip Wallet module`

**Body:**

```md
## Summary
Adds `ClipWalletModule` (`src/sdk/modules/clip-wallet.module.ts`, id `clip-wallet`, `ModuleType.HOT_WALLET`) for
Clip Wallet, a non-custodial browser extension.

- Detection: `window.clipwallet.stellar` (`isClipWallet: true`); answers `isAvailable()` synchronously.
- The injected provider implements SEP-43 (getAddress, signTransaction, signAuthEntry, signMessage (SEP-53), getNetwork)
  and returns SEP-43 `{ error }` objects; the module maps them to `IKitError` rejections.
- Also implements `signAndSubmitTransaction` and `disconnect`, and `onChange` (accounts changed).
- No extra dependencies or polyfills.

## Testing
- Unit tests with a mocked provider (address, network, sign, errors → IKitError codes).
- Manual: testnet payment, trustline, Soroban invoke with auth entry, SEP-53 message.
```

Upstream files: `src/sdk/modules/clip-wallet.module.ts` (our `packages/kit-modules/src/stellar/index.ts`, importing the
kit's own `ModuleType`/`ModuleInterface` instead of the structural copies), an export in `src/sdk/modules/utils.ts`
`defaultModules()` (and `sep43Modules()` if accepted), a package.json `exports` entry `./modules/clip-wallet`, and a test
file like `ghostsig.module.test.ts`.

## Sources
- https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/wallets/create-wallet-module.md
- https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md
- https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
