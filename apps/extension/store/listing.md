# Clip Wallet: store listing (testnet build)

Copy and answers for the Chrome Web Store, Microsoft Edge Add-ons and addons.mozilla.org (AMO). Nothing has been
submitted. Every answer below describes the testnet build that `pnpm --filter @clip-wallet/extension package`
produces (`apps/extension/release/`); re-check it whenever `wxt.config.ts` (the manifest) changes.

## Basics

| Field | Value |
|---|---|
| Name | Clip Wallet |
| Publisher | ColdAI (ColdAI-org) |
| Version | 0.1.0 (from `apps/extension/package.json`) |
| Category (Chrome) | Productivity → Tools |
| Category (Edge) | Productivity |
| Categories (AMO) | Privacy & Security; Other |
| Language | English (the wallet itself ships 12 languages: en, de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi) |
| Homepage | https://github.com/ColdAI-org/clip-wallet |
| Support | https://github.com/ColdAI-org/clip-wallet/issues (security reports: see SECURITY.md, never public issues) |
| Privacy policy URL | Publish `docs/legal/privacy-policy.md` (after legal review) and paste its public URL here |
| Licence (AMO) | MIT |
| Visibility | Unlisted or a private test group while it is testnet-only (see "Before submitting") |

## Short description

Chrome uses the manifest `description` (at most 132 characters); AMO's summary allows 250; Edge takes the
same text.

> A calm, non-custodial wallet for every CLPR network. Test networks only.

(72 characters; identical to the manifest so the store and the browser say the same thing.)

## Long description

> **Clip Wallet is a calm, non-custodial wallet for every CLPR network.** One recovery phrase, one balance,
> and plain words before you sign anything.
>
> **This version uses test networks only.** Test tokens have no value. Don't send real funds to it.
>
> **Your assets, not your networks.** Clip Wallet shows what you own, merged across Ethereum, Hedera, Solana,
> Bitcoin and ten more families of networks. USDC is one USDC. You only see a network where picking the wrong one
> could lose money, and then the wallet asks once, in plain words.
>
> **Know what you sign.** Every request from an app is decoded before you approve it: what you pay, what you
> get, the fee, and anything risky, such as an unlimited spending permission. A request the wallet can't read is
> blocked by default.
>
> **Scam checks on your device.** Before you connect or sign, Clip Wallet checks the site and the addresses
> against open scam lists that are downloaded to your device, so the lists never learn which sites you visit.
> Settings → Security shows which apps can spend your tokens, and lets you take that back.
>
> **Swap, stake and buy.** Built-in swaps, staking and buying, each ending in the same clear approval.
>
> **Works with your apps.** Ethereum-style apps (EIP-1193 and EIP-6963), Solana and Sui apps (Wallet
> Standard), Hedera, Bitcoin, Cardano, Polkadot, Starknet, TON, NEAR, Stellar, Tezos, Algorand and
> WalletConnect.
>
> **Your keys stay yours.** Your recovery phrase and keys are encrypted on your device with your password
> (Argon2id and XChaCha20-Poly1305). We have no account for you and we can't move your money. Optional extras: unlock
> with a passkey, back up with a passkey (we store only a copy we can't open), Ledger and Keystone hardware
> wallets.
>
> **No tracking.** No analytics, no ads, and we never sell data. Settings → Your data lists everything the
> wallet contacts and why.
>
> **Open source.** MIT-licensed, built by ColdAI: https://github.com/ColdAI-org/clip-wallet. Every release
> ships SHA-256 checksums and build provenance, and the extension builds reproducibly.

## Screenshots and graphics

Rendered from the e2e fixture flows (`pnpm --filter @clip-wallet/extension store:shots`) and the brand sources
(`node tools/brand/render.mjs`). All five screenshots are 1280x800, the size Chrome, Edge and AMO accept.

| File | Use |
|---|---|
| `store/screenshots/01-home.png` | One balance across networks |
| `store/screenshots/02-approval.png` | A decoded payment request |
| `store/screenshots/03-send.png` | The one network question, asked only when it matters |
| `store/screenshots/04-swap.png` | Swap with the price-move limit |
| `store/screenshots/05-security.png` | Scam protection sources |
| `store/assets/store-icon-128.png` | Chrome store icon (96 px artwork, 16 px transparent padding) |
| `store/assets/promo-small-440x280.png` | Chrome small promo tile; Edge small promotional tile |
| `store/assets/promo-marquee-1400x560.png` | Chrome marquee; Edge large promotional tile |
| `store/assets/edge-logo-300.png` | Edge store logo (300x300) |
| `public/icon/128.png` | AMO icon (taken from the package) |

Screenshot 02 shows the fixture's payment request with its dapp name replaced by "Example Shop" (the fixture
borrows a real marketplace's name; a listing must not suggest an endorsement). Screenshot 05 names the open
lists the wallet uses (MetaMask's and Phantom's phishing lists, ScamSniffer): that is factual attribution of
data sources, not a partnership.

## Single purpose (Chrome)

> Clip Wallet is a cryptocurrency wallet: it holds the user's keys on their device, shows their balances, and
> lets them send, receive and approve requests from web apps on test networks.

## Permission justifications

Chrome asks for one per permission; AMO and Edge reviewers read the same text in the reviewer notes. The
Firefox package has no `offscreen`, `sandbox`, `externally_connectable` or npm-registry host (Firefox has no
offscreen documents or sandbox manifest pages, so Clip Plugins are left out of that build).

### API permissions

| Permission | Why |
|---|---|
| `storage` | Keeps the encrypted vault (recovery phrase and keys, encrypted with the user's password), settings, contacts, connected-site list and activity on the device. Nothing is synced. |
| `alarms` | Locks the wallet after the auto-lock time the user picked, and runs the optional incoming-payment and price checks, once a minute, only after the user turns notifications on. |
| `identity` | `launchWebAuthFlow` for the optional "back up with Google or Apple" sign-in: the provider only tells our backup service which stored, encrypted backups belong to the user. Never used unless the user starts that flow. |
| `offscreen` (Chrome/Edge only) | Hosts Clip Plugins (Advanced mode, off by default) in an offscreen document with reason `IFRAME_SCRIPTING`, so a misbehaving plugin can only freeze that document, never the wallet's own pages. |
| `notifications` (optional) | Requested only when the user turns on notifications in Settings → Notifications (incoming payments, price alerts). Never asked for at install. |

### Content scripts on `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`

A wallet has to be reachable from any web app the user opens: the content script injects the wallet's
provider objects (EIP-6963 / EIP-1193, Wallet Standard and the other families' connectors) so a site can ask to
connect. The script reads nothing from the page. It only relays requests the page sends to the wallet, and the
wallet shows every request to the user before anything happens. Sites get no data until the user approves a
connection. `localhost` and `127.0.0.1` are for developers testing their own apps; plain `http` sites elsewhere
are not supported.

### Host permissions

Most network services the wallet uses allow cross-origin requests and need no host permission. These do not
(or are reached from the background service worker), so they are listed:

| Host | Why |
|---|---|
| `https://*.koios.rest/*` | Cardano balances and transaction submission (Koios's public tier restricts CORS). |
| `https://api.coingecko.com/*` | Prices for the total balance. Sends asset ids only, never addresses. |
| `https://api.dexscreener.com/*` | Market data in Explore → Discover. Sends token addresses being looked up, never the user's address. |
| `https://api.jup.ag/*` | Solana swap quotes and transactions (Jupiter). |
| `https://api.0x.org/*` | EVM swap quotes and transactions (0x). |
| `https://agg-api.minswap.org/*` | Cardano swap quotes (Minswap aggregator). |
| `https://aftermath.finance/*` | Sui swap quotes (Aftermath). |
| `https://api.hyperion.xyz/*`, `https://api-testnet.hyperion.xyz/*` | Aptos swap quotes (Hyperion). |
| `https://starknet.api.avnu.fi/*`, `https://sepolia.api.avnu.fi/*` | Starknet swap quotes (AVNU). |
| `https://api.ston.fi/*` | TON swap quotes (STON.fi). |
| `https://smartrouter.ref.finance/*` | NEAR swap quotes (Ref Finance). |
| `https://testnet.hashio.io/*` | Hedera JSON-RPC relay: reads Clip handles (contact names) from their Hedera contract. |
| `https://registry.npmjs.org/*` (Chrome/Edge only) | Installs Clip Plugins the user picks in Advanced mode; each download is checked against npm's SHA-512 and the plugin's own SHA-256 before anything is shown. |
| `https://clip-backup.doyoka-platform.workers.dev/*` | ColdAI's backup service for the optional passkey backup: stores only an encrypted copy the service can't open. |
| `https://clip-media-proxy.doyoka-platform.workers.dev/*` | ColdAI's media proxy: loads collectible images so the sites that host them never see the user's browser. |

Swap hosts receive the user's address and the amounts only when the user asks for a quote. `api.blockaid.io`
appears only in builds made with a Blockaid key; the testnet package has none.

### Other manifest entries

| Entry | Why |
|---|---|
| `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'` | Argon2id (the password hashing that protects the vault) runs as WebAssembly. No remote scripts, no `eval`. |
| `sandbox.pages` + sandbox CSP (Chrome/Edge) | The plugin sandbox: a unique opaque origin with no extension APIs, `connect-src 'none'`. `'unsafe-eval'` exists only there, for the SES compartment that runs a plugin. |
| `externally_connectable.matches` (Chrome/Edge) | Lets the passkey web-bridge page hand the wallet a passkey result. **Currently a placeholder origin (`passkey.clipwallet.example`): replace it with a real ColdAI origin, or remove the entry, before submitting.** |
| `browser_specific_settings.gecko.data_collection_permissions` (Firefox) | Required: `financialAndPaymentInfo` (addresses and signed transactions go to network nodes). Optional: `personallyIdentifyingInfo` (the email address for passkey backup). |

## Remote code (Chrome "Are you using remote code?")

> **Yes, only for Clip Plugins, which are off by default.** In Advanced mode a user can install a plugin from
> npm. The bundle is checked against npm's SHA-512 integrity and the plugin's own SHA-256, then runs only inside
> the manifest sandbox page (unique opaque origin, no extension APIs, `connect-src 'none'`) in an SES
> compartment that exposes nothing but the functions the user granted (transaction notes, name lookups, rate-
> limited notifications). A plugin can't sign, can't see keys and can't reach storage or the network directly.
> The wallet's own code is all in the package.

This is the part most likely to draw questions in review. If it blocks approval, ship the store build without
Clip Plugins (the Firefox build already leaves them out) and keep them for a later, separately reviewed version.

## Data usage (Chrome Privacy practices tab)

| Category | Collected? | Notes |
|---|---|---|
| Personally identifiable information | Yes, optional | Email address, only if the user turns on passkey backup with email sign-in; the service keeps a keyed hash (HMAC-SHA-256), never the address. |
| Health information | No | |
| Financial and payment information | Yes | Public wallet addresses and signed transactions are sent to network nodes, indexers and the swap/buy provider the user picks. |
| Authentication information | No | The password, recovery phrase and keys never leave the device. |
| Personal communications | No | |
| Location | No | |
| Web history | No | Scam lists are checked on the device. (Builds with Blockaid switched on send the site being connected to; the testnet package has none.) |
| User activity | No | |
| Website content | No | |

Certify all three: not sold to third parties; not used or transferred for purposes unrelated to the single
purpose; not used or transferred to determine creditworthiness or for lending.

## Reviewer notes (all stores)

> Test build: test networks only (Ethereum Sepolia, Hedera testnet, Solana devnet, and so on). To try it:
> install, choose "Create a new wallet", set any password, write down the 12 words (they are test-only), then
> confirm three of them. Test tokens: each network's public faucet (for example the Hedera portal or a Sepolia faucet). No account or login is
> needed.
>
> Bundled third-party code that linters flag: `Function("")` capability probes in zod 4 (its JIT check, caught
> and disabled under our CSP), `function-bind` / `get-intrinsic` polyfills (pulled in by crypto libraries), and
> React DOM's `innerHTML` path for `dangerouslySetInnerHTML`, which Clip Wallet's code never uses. The extension
> pages' CSP (`script-src 'self' 'wasm-unsafe-eval'`) blocks `eval` there regardless. Sources for every bundled
> file: the source package and `README-AMO.md` inside it.

## Before submitting

- [ ] Legal review of `docs/legal/privacy-policy.md` and `docs/legal/terms-of-use.md`; publish both and put the
      URLs above and in the store forms.
- [ ] Replace the placeholder `externally_connectable` origin (`passkey.clipwallet.example`, from
      `packages/extension-kit/src/app-settings.ts`) or drop the entry.
- [ ] Decide on Clip Plugins in the store build (see "Remote code").
- [ ] Testnet-only listing: Chrome and Edge allow unlisted items; AMO can be "unlisted" (self-distributed,
      signed). A public listing should wait for a mainnet build and its own review.
- [ ] Attach `SHA256SUMS` and the provenance attestation from the GitHub release to the listing's support page.
