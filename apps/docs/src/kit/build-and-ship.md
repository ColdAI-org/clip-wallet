# Build and ship

## The extension's files

A wallet project keeps three things; the rest comes from `@clip-wallet/extension-kit`.

**`wxt.config.ts`**: the whole build is `clipWallet()`.

<<< @/snippets/kit/wxt.config.ts

**One-line entrypoints** in `src/entrypoints/`:

::: code-group

<<< @/snippets/kit/background.ts [background.ts]

<<< @/snippets/kit/content.ts [content.ts]

<<< @/snippets/kit/inpage.content.ts [inpage.content.ts]

<<< @/snippets/kit/popup.tsx [popup/main.tsx]

:::

The approval window, the offscreen plugin host and the plugin sandbox are one line each too
(`mountApprovalWindow()`, `startPluginHost()`, `import "@clip-wallet/extension-kit/plugin-sandbox"`).
`create-clip-wallet` writes all of them. What `clipWallet()` does with them: [Extension kit](../architecture/extension-kit.md).

## Build and try it

```sh
pnpm extension:build             # → packages/extension/.output/chrome-mv3
pnpm extension:dev               # watch mode, Chrome opens with the extension loaded
pnpm extension:build:fixtures    # sample data, no network: for screenshots and demos
```

Load `.output/chrome-mv3` with **Load unpacked** in `chrome://extensions`. Then run the checks:

```sh
pnpm harness && pnpm check-types && pnpm build
```

## Package for the stores

In a kit-built wallet, `pnpm extension:zip` writes the store zips with WXT. Clip Wallet's own extension in this repo
uses a stricter script:

```sh
pnpm --filter @clip-wallet/extension package
```

It writes to `apps/extension/release/`:

| File | For |
| --- | --- |
| `clip-wallet-<version>-chrome.zip` | Chrome Web Store and Microsoft Edge Add-ons (the same MV3 package) |
| `clip-wallet-<version>-firefox.zip` | addons.mozilla.org (MV3, the background as an ES-module event page; Firefox 140 or later) |
| `clip-wallet-<version>-source.zip` | AMO's source-code submission |
| `SHA256SUMS`, `TREE-DIGESTS`, `BUILD-INFO` | checksums, architecture-independent content digests, and how it was built |

Every zip is deterministic: `SOURCE_DATE_EPOCH` defaults to the commit time, so two builds of one commit are
byte-identical (see [Reproducible builds](../testing/reproducible-builds.md)). The script refuses a build that isn't the
testnet build.

The store kit (listing copy, permission justifications, screenshots) is in
[`apps/extension/store`](repo:apps/extension/store). Keep your listing's privacy section in step with what the wallet
sends where (Settings → Security and Settings → Your data list it).

## Your extension id

The extension id comes from the public key in `extension.key`. Keep the private key
(`packages/extension/.keys/extension.pem`) offline and **use the same key for the store item**, so the id in the store
matches the one your listings, passkeys and native-messaging hosts know.

## Listings

`pnpm wallet:listings` regenerates the drafts in `docs/listings/` for your identity: EIP-6963 metadata, WalletConnect
Explorer, and for the families you turned on, TON Connect, NEAR Wallet Selector, Stellar Wallets Kit, Tezos Beacon and
Algorand use-wallet. Submit them once your extension is public; until then, some pickers need the one-line additions on
[Troubleshooting](../dapps/troubleshooting.md).

## Upgrading the kit

Your project pins every `@clip-wallet/*` package and `create-clip-wallet` to one exact version (the harness insists).
Upgrading is a deliberate change: bump the pins, read the kit's changelog, then
`pnpm install && pnpm verify:provenance && pnpm harness && pnpm build`. `pnpm verify:provenance` checks each package's
npm provenance attestation against the kit's public repository; `npm audit signatures` verifies the signatures.

## Mainnet

::: danger Real funds
Clip Wallet is pre-release and has had no external audit. A mainnet build moves real money. The checklist in
`packages/extension/MAINNET.md` is the owner's decision, never an agent's.
:::

`pnpm wallet:mainnet-check` lists what is left. The build refuses mainnet until it is empty: see
[Configure clip.config.ts](./config.md#mainnet).
