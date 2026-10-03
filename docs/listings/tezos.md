# Listing draft: Tezos (Beacon)

> DRAFT ONLY. Do not open this PR until Clip Wallet is published on the Chrome Web Store (the extension id is part of
> the entry). Nothing has been submitted.

Beacon dApps find browser extensions by postMessage "ping"/"pong" (any extension that answers shows up), but the
curated wallet list in the Beacon UI comes from `scripts/blockchains/tezos.ts` in github.com/airgap-it/beacon-sdk
(`tezosExtensionList: ExtensionApp[]`, rendered by `scripts/generate-wallet-list.ts`; logos in `assets/logos/`).
An entry is keyed by the browser extension id, which must equal the id our page relay answers with
(`InpageConfig.beaconExtensionId`, see the integration doc).

## Prerequisites
- [ ] Chrome Web Store id (and Firefox add-on id if we ship there), fixed via the manifest `key`.
- [ ] `beaconExtensionId` baked into the inpage config with that id.
- [ ] Logo PNG/SVG for `assets/logos/extension-clip.png`.
- [ ] Shadownet + mainnet tested with a Taquito `BeaconWallet` dApp (permission, transfer, FA2 transfer, delegation, sign payload).

## PR to airgap-it/beacon-sdk

**Title:** `feat(wallet-list): add Clip Wallet browser extension`

**Body:**

```md
## Summary
Adds Clip Wallet, a non-custodial browser extension, to `tezosExtensionList`.

- Implements the Beacon postMessage extension protocol (ping/pong, PostMessage pairing, encrypted v2 messages).
- Supports permission_request, operation_request, sign_payload_request (raw / operation / micheline).
  broadcast_request answers BROADCAST_ERROR.
- Networks: mainnet, shadownet.

## Entry
{
  key: 'clip_wallet_chrome',
  id: '<chrome extension id>',
  name: 'Clip Wallet',
  shortName: 'Clip',
  color: '',
  logo: 'extension-clip.png',
  link: 'https://coldai.org/clip-wallet'
}

## Testing
Paired from a Taquito BeaconWallet dApp; transfers, FA2 transfer, delegation and sign-in payloads on shadownet.
```

## Sources
- https://github.com/airgap-it/beacon-sdk/blob/master/scripts/blockchains/tezos.ts
- https://github.com/airgap-it/beacon-sdk/blob/master/scripts/generate-wallet-list.ts
- https://docs.walletbeacon.io (wallet guide), TZIP-10: https://gitlab.com/tezos/tzip/-/blob/master/proposals/tzip-10/tzip-10.md
