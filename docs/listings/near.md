# Listing draft: NEAR (NEAR Connect + NEAR Wallet Selector)

> DRAFT ONLY. Do not open these PRs until Clip Wallet is published (Chrome Web Store listing, npm packages,
> public repo, security statement). Nothing here has been submitted.

There are two NEAR pickers. The NEAR Infra Committee / NEAR Foundation now recommends **NEAR Connect**
(github.com/azbang/near-connect, `@hot-labs/near-connect`); **Wallet Selector** (github.com/near/wallet-selector) is still
supported during the transition (its README says so). Clip Wallet works with both:

- NEAR Connect: no dApp change and no PR needed for the injected path. 1Mask answers NEAR Connect's
  `near-selector-ready` event with a `near-wallet-injected` wallet (`packages/1mask/src/inpage/near.ts`). A manifest PR only
  matters if we also want a sandboxed executor (for users without the extension) — not planned.
- Wallet Selector: dApps add `setupClipWallet()` from `@clip-wallet/kit-modules/near`, or the module is upstreamed as
  `@near-wallet-selector/clip-wallet` (PR below).

## Prerequisites (from Wallet Selector CONTRIBUTING.md "Listing Criteria for Third Party Wallet")

- [ ] Custody disclosed in onboarding (non-custodial; phrase stays on device).
- [ ] Conforms to the injected wallet standard (NEP-408) — note: our provider follows the wallet-selector injected shape;
      re-check NEP-408 field names before submitting.
- [ ] User guide link, account recovery (BIP-39 phrase), active maintenance + support contact.
- [ ] Dated security statement on our site/GitHub covering the 21 security items (audits, pentests, bug bounty, testnet
      wallet available, extension listed on the Chrome Web Store, dependency scanning, logging policy).
- [ ] Icon hosted by us (PNG/SVG), download URL.

## PR to near/wallet-selector

**Title:** `feat: add Clip Wallet (injected) module`

**Body:**

```md
## Summary
Adds `@near-wallet-selector/clip-wallet`, an injected-wallet module for Clip Wallet, a non-custodial browser extension.

- Module type: `injected` (`WalletModuleFactory<InjectedWallet>`), id `clip-wallet`.
- Detection: `window.clipwallet.near` (`isClipWallet: true`), available on the networks the extension serves.
- Supports: signIn / signOut / getAccounts, signAndSendTransaction(s), signMessage (NEP-413),
  getPublicKey and signNep413Message (Signer). verifyOwner is not supported (deprecated).
- Not supported: signTransaction / signDelegateAction / createSignedTransaction — the wallet signs and sends in one
  approved step. signIn does not create function-call keys; every transaction is approved in the wallet.
- Actions are converted with core's `najActionToInternal`; bytes travel base64.

## Listing criteria
- Custody: non-custodial, disclosed during onboarding.
- Security statement: <link, dated>
- User guide: <link>
- Chrome Web Store: <link>
- Testnet: supported (default build is testnet-only).

## Testing
- Unit tests for the module against the injected provider.
- Tried in the example app on testnet: sign in, transfer, function call, NEP-413 message.
```

Files to add upstream (mirroring other injected modules such as `packages/bitget-wallet`): `packages/clip-wallet/src/lib/clip-wallet.ts`
(content of `packages/kit-modules/src/near/index.ts`), `index.ts`, `package.json`, `project.json`, README, icon in
`packages/clip-wallet/assets/`, and an entry in the root README wallet list and the example apps' module lists.

## Sources
- https://github.com/near/wallet-selector (README, CONTRIBUTING.md listing criteria)
- https://github.com/azbang/near-connect (README "How to add my wallet?", "Injected wallets")
- https://github.com/near/NEPs/pull/408 (injected wallet standard)
