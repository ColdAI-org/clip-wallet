# AGENTS.md: a wallet on the Clip Wallet kit

This project is a non-custodial wallet on the Clip Wallet kit, for every platform it ships, all described by one
`clip.config.ts` at the root:
<!-- platform:extension -->
- `packages/extension`: the browser extension, on `@clip-wallet/extension-kit` (WXT);
<!-- /platform:extension -->
<!-- platform:desktop -->
- `packages/desktop`: the desktop app for macOS, Windows and Linux, on `@clip-wallet/desktop-kit` (Electron);
<!-- /platform:desktop -->
<!-- platform:mobile -->
- `packages/mobile`: the phone app for iOS and Android, on `@clip-wallet/mobile-kit` (Expo);
<!-- /platform:mobile -->
<!-- platform:nextjs -->
- `packages/nextjs`: a Scaffold-HBAR dapp that connects to the wallet on Hedera testnet.
<!-- /platform:nextjs -->

The wallet's code lives in the kit packages; this project holds the identity, the configuration, the icons and
one-line entrypoints. Map: `llms.txt`. Product: `.harness/spec.md`, `.harness/prd.md`.

## Rules that never break
1. **Never handle key material here.** Recovery phrases, private keys, seeds and signing live only in
   `@clip-wallet/vault`, inside the kit's background. Don't import `@clip-wallet/vault`, `@scure/bip39`/`bip32`, noble
   signing APIs, `viem/accounts`, `ethers` wallets, Hedera `PrivateKey` or Solana `Keypair` in this project.
2. **The identity is this wallet's own.** Never set `rdns` to `org.coldai.*` or the name to "Clip Wallet". Identity lives
   in `wallet.identity.json`; change it with `pnpm wallet:identity`, not by hand-editing the key.
3. **The security floor stays.** Every platform builds through its kit: `clipWallet()` (`packages/extension/wxt.config.ts`),
   `clipDesktop()` (`packages/desktop/electron.vite.config.ts`), `expoConfig()` and `withClipWallet()`
   (`packages/mobile/app.config.ts`, `metro.config.js`). Never switch the phishing lists off, filter them, or define
   `__CLIP_SECURITY__`.
4. **Testnet by default.** Never turn mainnet on and never tick a box in `MAINNET.md`: that is the owner's decision,
   and the harness and every build refuse it until the checklist is done.
5. **Secrets stay out of git and out of logs.** `.env`, `.env.local`, `.keys/` and `*.pem` are gitignored; keep them so.
   Never print them. API keys go in `.env` as `CLIP_*` (wallet) or `NEXT_PUBLIC_*` (dapp; public by definition).
   Signing certificates and store credentials only ever live in CI secrets (`docs/signing.md`).
6. **Kit packages are pinned.** `@clip-wallet/*` and `create-clip-wallet` use one exact version (`"0.1.0"`, never `^`/`~`).
7. **Every dapp request is decoded before approval.** Don't add code that signs or sends outside the approval path.
   Undecodable requests are blind signing, off by default.

## Commands that must pass
```bash
pnpm install && pnpm harness && pnpm check-types && pnpm build
```
`pnpm harness` is fast (no network): run it after every change. `pnpm build` builds the extension, the desktop app and
the dapp (whichever this project has); `pnpm mobile:export` builds the phone app's JavaScript bundles.

## Layout
```
wallet.identity.json                      name, description, rdns, homepage, icon, app id, extension public key
clip.config.ts                            theme, networks, languages, scheme, routing, hardware, passkeys, services, mainnet (typed)
icon.svg (or icon.png)                    the logo; every platform's icons are rendered from it (pnpm wallet:brand)
MAINNET.md                                the owner's mainnet checklist
packages/extension/wxt.config.ts          clipWallet({ config }): the whole extension build   <!-- only:extension -->
packages/extension/src/entrypoints/       one-line entrypoints into the kit   <!-- only:extension -->
packages/desktop/electron.vite.config.ts  clipDesktop({ config }): the whole desktop build   <!-- only:desktop -->
packages/desktop/electron-builder.config.cjs  electronBuilderConfig(): installers for macOS, Windows, Linux   <!-- only:desktop -->
packages/desktop/src/                     one-line entrypoints into the kit; build/ and src/renderer/public/tray/ are icons   <!-- only:desktop -->
packages/mobile/app.config.ts             expoConfig(): name, ids, icons, splash, permissions   <!-- only:mobile -->
packages/mobile/metro.config.js           withClipWallet(): the resolved config for the app   <!-- only:mobile -->
packages/mobile/index.ts                  registerClipWallet(); assets/ are icons   <!-- only:mobile -->
packages/nextjs/                          Scaffold-HBAR dapp: app/page.tsx (demo), app/clip-connect (Clip Connect demo), app/debug, contracts/   <!-- only:nextjs -->
docs/listings/                            listing drafts (generated)
docs/signing.md                           code signing and store accounts: what to set (never the values)
tools/harness/check.mjs                   the rules above, as checks
```

## Recipes
Each ends with `pnpm harness && pnpm check-types && pnpm build`.

### Change the wallet's identity
1. `pnpm wallet:identity --name "…" --rdns <reverse domain the owner owns> [--id <app id>] [--homepage https://…] [--description "…"] [--logo path.png|svg] [--walletconnect-project-id <id>]`.
2. It rewrites `wallet.identity.json`, the page titles, the icons (only when asked or first run) and `docs/listings/`, and
   keeps the extension key. `--new-key` changes the extension id: only when the owner asks. Changing `--id` changes the
   desktop and phone app ids: a store treats that as a different app.
3. Never commit `.keys/extension.pem` or the `.env` files it writes.

### Change the look
1. `theme` in `clip.config.ts`: `accent`, `accentText` (contrast with the accent at least 3:1, or the build fails),
   `font`, `radius` (0–32).
2. The icon: `pnpm wallet:brand --logo path.png` renders every platform's icons (extension sizes, `.icns`, `.ico`, Linux
   PNGs, tray, iOS, Android adaptive and monochrome, splash) from one logo. Don't hand-edit the generated PNGs.
3. Screens are the kit's; they read the theme and the name. Don't fork them into this project.

### Languages and deep links
1. `languages` in `clip.config.ts`: the subset of `en`, `de`, `fr`, `es`, `pt-BR`, `it`, `tr`, `ja`, `ko`, `zh-Hans`, `ar`,
   `hi` that Settings → Language offers; the first is the fallback.
2. `scheme` (default: the name in lower case, no spaces): the desktop and phone apps' deep links (`<scheme>://wc?uri=…`).

### Add or remove a platform
The platforms are folders: `packages/extension`, `packages/desktop`, `packages/mobile`. To add one later, create a
project with `npx create-clip-wallet tmp --platforms <it> --name "<the same name>" --yes`, copy its `packages/<it>`
folder and its root `package.json` scripts over, run `pnpm install && pnpm wallet:brand`. To remove one, delete its
folder and its scripts.

### Turn networks on or off
1. `networks` in `clip.config.ts`: `"evm:*"` or `"evm:<chain id>"`, `"hedera"`, `"solana"`, `"bitcoin"`, `"sui"`,
   `"aptos"`, `"cardano"`, `"substrate"`, `"starknet"`, `"ton"`, `"near"`, `"stellar"`, `"tezos"`, `"algorand"`.
2. Test networks only while `mainnet: false`. An EVM chain the kit doesn't know needs a change in the kit
   (`@clip-wallet/chains-evm`), not here.
3. `pnpm wallet:listings` afterwards: the drafts follow the families that are on.

### Routing and settle-on-Hedera
1. `route.mode`: `balanced`, `cheapest`, `fastest`, `reliable`, `greenest`.
2. `route.filters`: `iso20022`, `mica`, `energy` (or `{ capKgPerTx }`), `trustFloor` (`attested` < `committee` <
   `light-client` < `validity-proof`), `maxHops` (1–6), `deadlineS`, `excludedJurisdictions` (`["DE"]`).
3. `route.settleOnHedera: true` adds bonded-Connector quotes (Phase 3) to the approval's Details where a deployment
   exists. Routes that rely on test verifiers are refused outside test networks; don't try to loosen that.

### Features: swaps, on-ramps, prices
Partner keys go in `.env` at the project root (see `.env.example`), read at build time: `CLIP_0X_API_KEY`,
`CLIP_JUPITER_API_KEY`, `CLIP_COINGECKO_DEMO_KEY`, `CLIP_MOONPAY_API_KEY` + `CLIP_MOONPAY_SIGNER_URL`,
`CLIP_BANXA_PARTNER`, `CLIP_C14_CLIENT_ID` + `CLIP_C14_ASSET_IDS`. Without a key the feature says it isn't switched
on. Staking and the swaps that need no key (SaucerSwap, Minswap, STON.fi, …) work as they are.

### Security
What you may change: `CLIP_BLOCKAID_API_KEY` turns on Blockaid scanning (the site, the transaction and the user's
address go to Blockaid; Settings → Security says so; use a proxy for production). What you may not: the open phishing
lists, their refresh, the new-contract and look-alike checks, the decode-before-approve path. There is no setting for them
on purpose.

### Social: contacts, Clip handles, notifications, Discover
1. Contacts, notifications and Discover work with no setup. Notifications ask for the browser permission only when the
   user turns them on.
2. Clip handles need the ClipHandles contract on Hedera: `services.clipHandles: { address: "0x…", contractId: "0.0.x",
   ledger: "testnet" }` in `clip.config.ts`. Unset, handles say they aren't switched on.

### Hosted services (backup, NFT media)
`services.backupUrl` and `services.mediaProxyUrl` (https base URLs of deployments of the kit's `services/backup` and
`services/media-proxy`). Unset = passkey backup is hidden and NFT media show placeholders. Passkey backups need
`passkeys.rpOrigin` set to an https origin you own first.

### Clip Plugins
Plugins run only when the user turns on Advanced mode and Settings → Advanced → Plugins; they are SES-sandboxed,
installed from npm with integrity checks, and can never sign or see keys. To write one, see the `@clip-wallet/plugins`
README (`clip.plugin.json`: transaction insights, name resolution, notifications, up to 3 https origins). Nothing in
this project needs to change to allow them.

### Hardware wallets
`hardware: ["ledger", "keystone"]` in `clip.config.ts`; remove one to hide it.

<!-- platform:nextjs -->
### Change the dapp
1. Pages: `packages/nextjs/app/<route>/page.tsx`; add a link in `components/Header.tsx`.
2. The wallet's name and rdns come from `utils/wallet.ts` (which reads `wallet.identity.json`); don't hard-code them.
3. A contract on the debug page: add `{ address, abi }` under chain `296` in `contracts/externalContracts.ts`.
4. Own contracts: add Scaffold-HBAR's `packages/foundry` (or hardhat); its deploy fills `contracts/deployedContracts.ts`.
5. Testnet only: `scaffold.config.ts` lists `hederaTestnet`; add `hedera` only after the wallet's mainnet checklist.
<!-- /platform:nextjs -->

### Ship: stores and signing
`docs/signing.md` lists the accounts and certificates each store needs and the environment variable names the tools read
(Chrome Web Store, AMO, Edge; Apple Developer ID and notarization; Windows code signing; App Store and Google Play via
EAS). Never add a certificate, keystore or credential to this repository; never sign or submit for the owner.

### Upgrade the kit
1. Change the exact version of every `@clip-wallet/*` package in `packages/*/package.json` and of `@clip-wallet/config`
   and `create-clip-wallet` in the root `package.json` (all the same version).
2. `pnpm install && pnpm verify:provenance && pnpm harness && pnpm check-types && pnpm build`.
3. Read the kit's changelog for anything that needs a config change.

### Listing the wallet
`docs/listings/*.md` are drafts for the owner; never open those pull requests or submit forms yourself.
