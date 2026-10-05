> **DRAFT — needs legal review.** Written by the engineering team to describe what the code actually does
> (checked against this repository at the commit that added it). It is not legal advice and has not been
> reviewed by counsel. Items in [brackets] are placeholders a lawyer and ColdAI must fill in. Do not publish
> until reviewed.

# Clip Wallet privacy policy

*Draft of 2026-10-05. Applies to the Clip Wallet browser extension, the Clip Wallet mobile app (iOS and
Android), and the two optional ColdAI services they use: the passkey backup service and the media proxy.*

## The short version

- Clip Wallet is **non-custodial**. Your recovery phrase, private keys and password are created and kept on your
  device, encrypted with your password. We never receive them and can't recover them for you.
- We have **no user accounts**, **no analytics**, **no ads** and **no tracking**, and we never sell data.
- To work at all, the wallet has to ask public blockchain services about your **public addresses** and send
  them the transactions you sign. Those services are run by third parties.
- Two ColdAI services are optional: **passkey backup** stores an encrypted copy of your wallet we cannot open,
  found again by a keyed hash of your email or Google/Apple account; the **media proxy** loads collectible
  pictures so the sites hosting them never see your device.
- The same summary is in the wallet under Settings → Your data, in all 12 of its languages.

## Who we are

Clip Wallet is published by ColdAI ([legal entity name, registered address, company number]). Contact:
[privacy contact email]. For the purposes of the GDPR and UK GDPR, ColdAI is the controller for the two ColdAI
services described below. [Name an EU/UK representative if required.]

## What stays on your device

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Recovery phrase and private keys | Encrypted vault: Argon2id-derived key, XChaCha20-Poly1305 (`packages/vault`). Extension: `chrome.storage.local`. Mobile: the iOS Keychain / Android Keystore via expo-secure-store. | Never. Only the encrypted passkey backup copy, and only if you turn it on (below). |
| Password | Not stored; used to derive the vault key | Never |
| Passkey / Face ID / fingerprint unlock | The authenticator keeps its own secrets; the wallet stores a wrapped key | Never |
| Contacts, settings, connected-site list, activity history, accounts' names | Encrypted app data on the device | Never |
| Language preference, price-alert rules, notification choices | On the device | Never |

Mobile: Android cloud backup of the app's data is switched off (`allowBackup: false`). Notifications are
generated on the phone; there is no push server.

## What the wallet sends, and to whom

The wallet talks directly to the services below from your device. Each receives your IP address, as any
internet service does, plus what the table says. Their own privacy policies apply. The complete, current list of
endpoints is in the source (`packages/chains-*/src/networks.ts`, `packages/features`, `packages/security`,
`apps/extension/wxt.config.ts`).

| Purpose | Who (examples, testnet build) | What they receive | When |
|---|---|---|---|
| Balances, history, fees, sending | Public network nodes and indexers: PublicNode, dRPC, Blockscout, Hedera mirror nodes and the Hashio relay, Solana public RPC, mempool.space / Blockstream (Bitcoin), Koios (Cardano), Polkadot / Dwellir / Subscan endpoints, Sui GraphQL, Aptos Labs, Starknet PublicNode, TON Center / TonAPI, FastNEAR / NEAR RPC, Stellar Horizon, TzKT / Teztnets, Nodely (Algorand) | Your public addresses; transactions you have signed | Whenever the wallet is open; when you send |
| Prices | CoinGecko | Asset identifiers (not your address) | When balances are shown |
| Market data (Explore → Discover) | DEX Screener | Token addresses being looked up (not your address) | When you open Discover |
| Names (e.g. `.eth`, `.sol`, `.hbar`) | ENS via network nodes, Solana Name Service proxy (`sdk-proxy.sns.id`), Hashgraph name resolver | The name you type, or an address being looked up | When you type a name in Send |
| Clip handles (contact names) | The Hedera JSON-RPC relay (Hashio) | The handle or address being looked up | When you look one up or publish yours |
| Scam lists | GitHub (`raw.githubusercontent.com`): MetaMask phishing list, ScamSniffer, Phantom blocklist, polkadot-js phishing list | Nothing about you: the lists are downloaded and checked on your device | About once a day |
| Advanced scam scanning (optional) | Blockaid | The site you are connecting to, the request, your address | Only in builds made with a Blockaid key (the testnet build has none), before you approve |
| Swaps, staking, buying | The provider you pick: 0x, Jupiter, Minswap, Aftermath, Hyperion, AVNU, STON.fi, Ref Finance; MoonPay, Banxa, C14 for buying | Your address, the assets and amounts | Only when you ask for a quote or start a purchase. Buying opens the provider's own page, where their terms and identity checks apply. |
| Connecting to apps | The website or app you approve, and WalletConnect's relay (Reown) when you pair with a code | The address(es) you choose to share, and requests you approve | Only after you approve a connection |
| Hardware wallets | Ledger (USB/Bluetooth) or Keystone (QR), locally | Transactions to sign | When you use one; nothing goes to the internet |
| Clip Plugins (extension, Advanced mode, off by default) | The npm registry, then only the up-to-three https origins a plugin was granted | The plugin's name (download); whatever the plugin requests from its origins, via the wallet, GET only | Only if you install a plugin |
| Firefox / Chrome / Edge stores, Apple App Store, Google Play | The store you installed from | What the store collects under its own policy | Installing and updating |

We do not receive any of this traffic. Blockchains are public: anything you send on-chain, including your
address and amounts, is visible to everyone, permanently.

## ColdAI services

### Passkey backup (optional)

Off unless you turn it on (Settings → Backup). It lets you restore your wallet on a new device with a passkey
that synced there.

| We store | Details | Kept until |
|---|---|---|
| The encrypted backup | `CLPB` v1 blob: your wallet's entropy encrypted with XChaCha20-Poly1305 under a key only your passkey can produce (WebAuthn PRF). We cannot decrypt it. | You delete it (in the wallet, or "delete everything") |
| Passkey credential id and relying-party id | Public WebAuthn identifiers, so a new device asks for the right passkey | Same as the backup |
| Who it belongs to | `HMAC-SHA-256(secret pepper, your email)`, or of `"google:<account id>"` / `"apple:<account id>"`. We never store the email address or the Google/Apple account id itself. | Same as the backup |
| Sign-in links, sessions, sign-in state | SHA-256 hashes of one-time tokens | Links 15 minutes, Google/Apple sign-in state 10 minutes, sessions 30 days; expired rows are deleted hourly |
| Rate-limit counters | SHA-256 of your IP address or account hash inside a counter key | The rate-limit window (at most one hour), then deleted |

Email sign-in: your address is sent to our email provider ([Resend, Inc.] when email sign-in is switched on) to
deliver the one-time link, and is not kept by us. Google / Apple sign-in: you sign in on Google's or Apple's own
page; they tell our service an account id, which we hash as above. We ask Apple for no scope (no name, no email)
and ignore the email Google includes.

Request logs are switched off for this service (`observability.enabled: false`). It runs on Cloudflare Workers,
D1 and R2 ([region / data-location settings to confirm]).

### Media proxy

Collectible (NFT) images and videos load through `clip-media-proxy` so the sites that host them never see your
device. The proxy receives the image's address (URL, `ipfs://` or `ar://` link) and your IP address. It caches
images by their address, not by who asked. Your IP is used only by Cloudflare's rate limiter (300 requests per
minute) and is not stored by us; request logs are switched off. It runs on Cloudflare Workers.

### Hosting provider

Both services run on Cloudflare, Inc., as our processor. Cloudflare processes connection data (including IP
addresses) to operate and protect its network under its own terms: [link to Cloudflare DPA once signed].

## Legal bases (GDPR / UK GDPR)

[To confirm with counsel.] Passkey backup: your consent and the performance of the service you asked for
(Art. 6(1)(a)/(b)). Media proxy and rate limiting: our legitimate interest in protecting your privacy and the
service from abuse (Art. 6(1)(f)). Third-party services in the table above are contacted by your device at your
request; ColdAI does not receive that data.

## Your choices and rights

- **Delete your backup:** Settings → Backup → delete one backup, or delete everything for that sign-in. Deletion
  removes the database rows and the stored blob. [Confirm R2 replica deletion timing.]
- **Stop the media proxy:** [not yet a setting; collectible images do not load without it.]
- **Uninstall:** removes everything the wallet stored on that device. Keep your recovery phrase: without it
  nobody, including us, can restore the wallet.
- Access, correction, deletion, objection, portability, and complaints to a supervisory authority: write to
  [privacy contact email]. Because we store only hashes, we may need you to sign in to the backup service to
  find your data.
- California (CCPA/CPRA): we do not sell or share personal information for cross-context behavioural
  advertising. [Confirm whether any CCPA notices are required at this scale.]

## Children

Clip Wallet is not directed to children under [13 / 16 depending on jurisdiction], and we do not knowingly
collect their data.

## Security

Encryption and threat model: `packages/vault`, `services/backup/README.md` (threat model) and `SECURITY.md`.
Report a vulnerability privately as described in `SECURITY.md`.

## Changes

We will update this policy when the wallet starts contacting something new, change the date above, and say what
changed in the release notes (`CHANGELOG.md`). The in-app summary (Settings → Your data) changes in the same
release.

## Store data-safety summaries (for the store forms)

- **Chrome Web Store / Edge:** see `apps/extension/store/listing.md` → "Data usage".
- **Firefox:** `data_collection_permissions`: required `financialAndPaymentInfo`, optional
  `personallyIdentifyingInfo`.
- **Apple App Privacy / Google Play Data safety:** [to fill in for the mobile listing. Data linked to the user:
  none held by ColdAI except the optional backup (identifiers: hashed email / account id). Financial info
  (wallet addresses, transactions) is sent to third-party network services at the user's request. No tracking.
  No data sold.]
