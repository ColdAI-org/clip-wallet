# TON Connect wallets-list entry (DRAFT, do not submit)

Status: **draft only**. Nothing has been submitted. Submitting means a pull request that appends the entry to the
end of `wallets-v2.json` in github.com/ton-connect/wallets-list (served from github.com/ton-blockchain/wallets-list).
Per that repo's README and ton-connect/docs `spec/wallets-list.md`, the PR must validate against
`wallets-v2.schema.json`. Before submitting, the owner has to:

1. Publish a 288×288 PNG icon (non-transparent background, no rounded corners) at a stable HTTPS URL that ends in
   `.png`. The `image` URL below is a placeholder.
2. Publish the `about_url` page. That URL is also a placeholder.
3. Ship a build where `DeviceInfo.appName === "clipwallet"` and the JS bridge key is `"clipwallet"`
   (`window.clipwallet.tonconnect`), and the runtime `features` match the entry. Wiring is in
   `docs/phase2/integration/starknet-ton.md` §10.
4. Mainnet only: the wallets list is for production wallets, so this waits for the mainnet build flag.

```json
{
  "app_name": "clipwallet",
  "name": "Clip Wallet",
  "image": "https://coldai.org/clip-wallet/tonconnect-icon-288.png",
  "about_url": "https://coldai.org/clip-wallet",
  "bridge": [
    {
      "type": "js",
      "key": "clipwallet"
    }
  ],
  "platforms": [
    "chrome"
  ],
  "features": [
    {
      "name": "SendTransaction",
      "maxMessages": 255,
      "extraCurrencySupported": false
    },
    {
      "name": "SignData",
      "types": ["text", "binary", "cell"]
    }
  ]
}
```

Notes:
- Validated with ajv against `wallets-v2.schema.json` from github.com/ton-blockchain/wallets-list (commit of
  2026-10-01). That schema doesn't accept `itemTypes` on `SendTransaction` yet, although ton-connect/docs
  `spec/wallets-list.md` describes it. So the listing leaves it out. The runtime `DeviceInfo.features` still
  advertises `itemTypes: ["ton", "jetton", "nft"]`, and the spec says runtime features win for a connected session.
- `maxMessages: 255` is wallet v5r1. A v4r2 build must say 4.
- No `SignMessage` (gasless relays aren't implemented) and no `EmbeddedRequest`.
- `js` bridge only. It's a browser extension, so `universal_url` and `deepLink` are optional and left out. Add an
  `sse` bridge entry (plus `universal_url`) if the mobile app ships TON Connect over the HTTP bridge.
- Add `firefox` / `safari` to `platforms` when those builds ship.
