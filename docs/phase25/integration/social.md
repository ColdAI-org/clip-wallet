# Phase 2.5: social stream (contacts, Clip handles, notifications, Discover, translations)

Branch `p25/social`. Closes five gaps against Phantom and MetaMask: an address book, human-readable handles,
notifications, a discovery feed, and the UI in 12 languages. No keys outside `packages/vault`. Testnets by default.
Tests use no network: real API responses are trimmed into fixtures.

## What was built

| Area | Where | Notes |
|---|---|---|
| Translation layer | `packages/i18n` (new) | ICU-subset messages, plurals, RTL, locale negotiation, locale-aware numbers and amount parsing. React bindings in `@clip-wallet/i18n/react`. No dependencies. |
| UI strings | `packages/ui/src/i18n/{en,<locale>}/<namespace>.ts` | Every string in `packages/ui` goes through `t()`. The English catalog has 21 namespaces and 655 messages; mobile 332; notifications 15. Each was translated into 11 languages (about 11,000 messages), with a glossary comment at the top of each `<locale>/index.ts`. |
| Mobile strings | `apps/mobile/src/i18n/{en,<locale>}/<namespace>.ts` | Every string in `apps/mobile/src` (screens, kit, app) goes through `t()`. |
| Contacts | `packages/social/src/contacts` | `ContactBook`, sealed by the vault (`ClipVault.sealAppData("contacts")`, new). Exports `ContactLookup` for the security stream. |
| Clip handles | `contracts/handles` (Foundry), `packages/names/src/clip.ts`, `packages/social/src/handles` | The `ClipHandles` contract and its tests, the deploy script and README. Not deployed. Resolver for `@alex` and `alex.clip`. Writes are approved `ContractExecuteTransaction`s with plain-language approvals. |
| Notifications | `packages/social/src/notifications`, `apps/extension/src/background/social.ts`, `apps/mobile/src/background/{notifications,background-task}.ts` | Diffs public data between polls. Extension: `chrome.notifications` plus `chrome.alarms`. Mobile: `expo-notifications` plus `expo-background-task`. No push server. |
| Discover | `packages/social/src/discover`, `packages/ui/src/social/Discover.tsx` | CoinGecko trending, DEX Screener new tokens and top pools, limited to the wallet's networks, with scams filtered. Every row leads to Swap. |
| UI screens | `packages/ui/src/social/*` | Contacts, contact edit, handle, notification settings, Discover, recipient check (approval), contact suggestions (Send). |
| Hosts | `packages/engine/src/social.ts` (`createSocial`), `createEngineSocialClient`, `apps/extension/src/shared/social-bus.ts` | One factory serves both the extension and mobile. |

## Wiring (already applied in this branch: re-check these when merging other streams)

All edits are additive. Line counts are from `git diff --numstat` against `main`.

- **`packages/core/src/index.ts`** (+4): a new `Warning["code"]` value, `"public-record"` ("writes something anyone can read, forever"), used on handle approvals.
- **`packages/vault/src/vault.ts`** (+21) plus a new `src/appdata.ts`: `sealAppData(ns, plaintext)` and `openAppData(ns, box)`. Key = HKDF-SHA256(seed, salt `"clip-wallet/vault/app-data"`, info `"clip-wallet/vault/app-data/<ns>/v1"`). XChaCha20-Poly1305 with AAD `"clip-vault/v1/app-data/<ns>"`. Unlocked only. Tests: `packages/vault/test/appdata.test.ts`. `errors.ts` (+2) adds `appDataUnreadable`.
- **`packages/config/src/index.ts`** (+9): `services.clipHandles?: { address, contractId, ledger }`. Unset means handles are off.
- **`packages/names`**: a `"clip"` `NameService`. `ResolvedName.byFamily` and `ResolvedName.handle` are additive. `MultiNameResolver` option `clip`.
- **`packages/ui/src/client.ts`**: `Prefs.locale?: "system" | LocaleCode` and `ApprovalView.recipient?: { address, family }`.
- **`packages/ui/src/context.tsx`**: `ClipProvider` resolves the locale (prefs, else `navigator.languages`), wraps children in `LocaleProvider`, calls `setFormatLocale`, and sets `<html lang dir>`.
- **`packages/ui/src/App.tsx`** (+23/−7): a `social?: SocialClient` prop on `WalletApp` and `ApprovalWindowApp`, `WithSocial`, and `socialRoute()` before `featureRoute()`.
- **`packages/ui/src/features/routes.tsx`** (1 line): passes `buySymbol` to `Swap`. **`features/Swap.tsx`**: offers a Discover token the wallet doesn't list.
- **`packages/ui/src/screens/Settings.tsx`**: a language picker, plus a "Contacts and notifications" section shown when `social` is present. **`features/Explore.tsx`**: `<Discover/>` at the top when `social` is present. **`screens/Send.tsx`**: contact suggestions; sends `canonicalAmount()`. **`screens/Approval.tsx`**: `<RecipientCheck/>`.
- **`packages/engine/src/messages.ts`, `apps/extension/src/shared/messages.ts`** (+5 each): `...SOCIAL_REQUESTS` in the request union, `extends SocialResponseMap`, and `locale` in `PrefsPatch`.
- **`packages/engine/src/engine.ts`, `apps/extension/src/background/service.ts`** (+33/−4 each, the same edit in both):
  - `attachSocial()` and `socialApprovals()`.
  - Dispatch: `isSocialRequest(m)` goes to `social.handle`. `SocialService.LOCKED_OK` messages (notification settings, Discover) work while locked; everything else calls `requireUnlocked`.
  - `decoded = this.social?.refine(request, decoded) ?? decoded` after the features refine.
  - `lock()` calls `social.onLock()`, which forgets the decrypted contacts.
  - `resolveRecipient` accepts `@handle` and `.clip`, and picks `byFamily` for the asset's family (`handleAddressFor`).
  - `send()` uses `byFamily[network.family]`.
  - `enqueueTransaction` sets `view.recipient`.
- **`packages/engine/src/types.ts`, `apps/extension/src/background/wiring.ts`** (1 line each): `NameResolver.resolve` may return `byFamily`.
- **`apps/extension/src/background/main.ts`** (+22): `svc.attachSocial(startSocial({...}))`. **`pages/mount.tsx`**: `social={createSocialBusClient()}`.
- **`apps/extension/wxt.config.ts`**:
  - `optional_permissions: ["notifications"]`, asked for only when the user turns notifications on.
  - Host permissions for `https://api.dexscreener.com/*` and `https://testnet.hashio.io/*`.
- **`apps/mobile`**:
  - `background/host.ts` builds `createSocial(...)` and exposes `wallet.social` and `wallet.pollNotifications`.
  - `index.ts` imports `background/background-task` (tasks must be defined at load).
  - `ui/context.tsx` adds the locale, `LocaleProvider`, and a root `direction` style for RTL.
  - `app.config.ts` adds the `expo-notifications`, `expo-background-task` and `expo-localization` plugins.
  - `metro.config.js` and `jest.config.js` force a single React copy (workspace packages with hooks otherwise load their own dev copy under pnpm). `jest.config.js` also transforms `@hiero-ledger/*`.

### Still to wire at integration

1. **Clip-handle validators in the name resolvers.** The engine and extension `MultiNameResolver({ networks })` needs `clip: { isAddress }` built from the chain modules. Without it the backend drops every record, which is harmless while handles are off:
   ```ts
   names: new MultiNameResolver({ networks, clip: { isAddress: Object.fromEntries(Object.entries(chains).map(([f, m]) => [f, (a: string) => m!.isAddress(a)])), ...(config.services.clipHandles ?? {}) } }),
   ```
   In the extension, chains load lazily: pass a validators object and fill it after `loadChains()`, as `createSocial` does.
2. **Security stream (address poisoning).** Use `social.lookup()` (`ContactLookup`: `byAddress`, `lookalikes`) from the `SocialService` passed to `attachSocial`. Its token lists plug into Discover as `TokenRiskSource` (`createSocial({ risk })`).
3. **Swap for Discover tokens the wallet doesn't list.** Discover sends `/swap?buy=token:<chain>:<address>&buySymbol=X`. `FeaturesService.swap.quote` doesn't resolve `token:` keys yet, so the quote says plainly that it can't swap them. Resolving them needs the token's decimals (CoinGecko `detail_platforms` has them) and an `AssetRef`. That belongs to the features stream. Wallet-known assets (`swap.assetKey`) work today.
4. **The approval window** gets `social` (mount.tsx), so `RecipientCheck` works there too. Hardware approval gates are unchanged.

## Translations

- **Library:** none. `packages/i18n` is ~7.1 KB minified (3.2 KB gzip) including the React bindings. Measured with esbuild, the alternatives are:

  | Library | Minified | Gzip |
  |---|---|---|
  | i18next 26.4 | 43.8 KB | 14.2 KB |
  | i18next + react-i18next 17.0 | 58.9 KB | 19.8 KB |
  | @formatjs/intl 6.1 | 45.8 KB | 13.2 KB |

  Plurals, numbers, currencies and relative time come from the platform's `Intl`, which both the MV3 pages and Hermes provide. Messages use an ICU subset, so a later move to FormatJS needs no catalog rewrite.
- **Locales:** `en` (source), `de`, `fr`, `es`, `pt-BR`, `it`, `tr`, `ja`, `ko`, `zh-Hans`, `ar` (RTL), `hi`.
  - Negotiation: `pt-*` maps to `pt-BR`. Every `zh-*` maps to `zh-Hans` (no Traditional yet). Anything else falls back to English.
  - Settings → Language offers "Match device (…)" or a language shown in its own name.
- **Loading:** in the extension, English is bundled and other languages load on demand (`() => import("./de")`, one chunk each). The mobile app bundles all of them, because Metro inlines everything anyway.
- **Never translated:** the product name (`{name}` from config), asset symbols, addresses, network names, app names, WalletConnect, Ledger, Keystone, Face ID and Touch ID. `PROTECTED_TERMS` is enforced in `packages/ui/test/i18n.test.ts`.
- **Checks** (`packages/ui/test/i18n.test.ts`, `apps/mobile/test/i18n.vitest.ts`):
  - every locale has exactly the English ids, the same variables and the same rich-text tags, and parses;
  - protected terms are kept;
  - at most 3 sentences are left identical to English;
  - no `.tsx` file in `packages/ui/src` hard-codes English.
- **RTL (Arabic):**
  - Web: `<html dir="rtl">`, and `styles.css` now uses logical properties (`inline-start`/`inline-end`, `text-align: start`) with a few `[dir=rtl]` mirrors. Addresses and amounts stay LTR (`unicode-bidi: isolate`).
  - Mobile: the root `direction` style flips the layout immediately, and `I18nManager.forceRTL` applies natively from the next launch.
- **Numbers:** fiat, token amounts, percentages and relative times follow the locale. Arabic uses Latin digits (`ar-u-nu-latn`) so amounts read the same as on explorers; typed Arabic-Indic and full-width digits are accepted.
  - **Amount input rule:** a single separator is always the decimal point, so "0,5" is half in every locale and never 5. A separator counts as grouping only in valid grouping positions.
  - Screens send `canonicalAmount()` ("1234.5") to the background, whose schema is unchanged.
- **Not translated (gap):** text produced in the background stays English: `ClipError` messages, decoded approval titles and lines, activity titles, feature quotes. Known social error codes are mapped to translated text in the UI (`social/errors.ts`). Background i18n means passing the locale into `ChainModule.decode` and is a cross-stream change. Notification text is translated (`packages/social/src/notifications/locales`).

## Notifications: platform limits

- **Extension:**
  - Polls every minute with `chrome.alarms` (minimum period 30 s since Chrome 120).
  - Asks for the `notifications` permission from the Settings page at the moment the user turns notifications on, and never at install.
  - Clicking a notification opens the wallet tab on the right screen.
- **Mobile:** a foreground timer polls every 60 s while the app is active. `expo-background-task` registers a periodic task with a minimum interval of 15 minutes, but the OS decides the actual time from battery, network and usage. On iOS it can be hours, and nothing runs after the user swipes the app away until they open it again. Background tasks don't run in the iOS simulator. The settings screen says alerts can arrive late.
- **Privacy:**
  - Off by default.
  - The first poll after turning on only records a baseline, so there's no flood.
  - Spam tokens and spam NFTs never notify, because unsolicited airdrops are a phishing vector.
  - Polls read public data with the account cache the wallet already writes after unlock (`clip/accounts`), so they work while locked and never touch the vault. Nothing goes to a server of ours.

## Discover: sources and filtering

| Section | Source |
|---|---|
| Trending | `GET https://api.coingecko.com/api/v3/search/trending` (keyless), enriched with `GET /coins/{id}` platforms (at most 10 per refresh, cached for 7 days) to keep only coins on the wallet's networks. |
| New tokens | DEX Screener `GET /token-profiles/latest/v1` (60 req/min), priced with `GET /tokens/v1/{chainId}/{addresses}` |
| Top pools | DEX Screener `GET /token-pairs/v1/{chainId}/{wrapped native}` (300 req/min), at least $250k liquidity |

Feeds are cached for 5 minutes. A failing section says so; the others still show. Chains (DEX Screener ids checked live on 2026-10-03):

- EVM: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, linea, scroll. These show when the wallet has the chain or its testnet.
- Non-EVM: solana, hedera.

Scams are filtered by:

- the security stream's `TokenRiskSource`, when present;
- impersonation: a canonical stablecoin symbol at a non-canonical address, or a protected symbol such as ETH or WBTC on a new token. A real example from the fixtures is "USDC" that is really "UpSideDownCat";
- bait words and URLs in the name;
- invisible or bidi characters and mixed scripts;
- keyword-stuffed symbols;
- liquidity under $50k.

The canonical USDC and USDT addresses were checked against DEX Screener.

## Sources

- **Hedera EVM:** [deploying (Prague EVM, no EIP-7702, no blobs)](https://docs.hedera.com/evm/development/deploying.md), [gas: unused gas refunded](https://docs.hedera.com/evm/development/gas-fees.md), [chain ids 295/296 and Hashio](https://docs.hedera.com/evm/quickstart/setup-metamask.md), [accounts and EVM addresses](https://docs.hedera.com/evm/differences/accounts-and-keys.md), [Foundry deploy](https://docs.hedera.com/evm/quickstart/deploy-with-foundry.md).
- **CoinGecko:** [trending search](https://docs.coingecko.com/reference/trending-search), [coin by id](https://docs.coingecko.com/reference/coins-id).
- **DEX Screener:** [API reference](https://docs.dexscreener.com/api/reference).
- **Chrome:** [notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions).
- **Expo:** [notifications](https://docs.expo.dev/versions/latest/sdk/notifications/), [background task](https://docs.expo.dev/versions/latest/sdk/background-task/), [localization](https://docs.expo.dev/versions/latest/sdk/localization/).
- **Swap links (mobile):** [Uniswap custom linking (`outputCurrency`)](https://developers.uniswap.org/docs/trading/custom-interface-links), Jupiter `jup.ag/swap?sell=<mint>&buy=<mint>`.
- **Standards:** [BCP 47](https://www.rfc-editor.org/rfc/rfc5646), [ICU MessageFormat](https://unicode-org.github.io/icu/userguide/format_parse/messages/), CLDR plural rules via `Intl.PluralRules`.

## Tests

All green on `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm harness`. The extension e2e results are in the report.

| Suite | Tests | Covers |
|---|---|---|
| `packages/i18n` | 19 | negotiation, RTL, ICU plural/select (Arabic's six categories), fallbacks, structural checks, fiat/amount/percent formatting, safe amount parsing ("0,5" is never 5), Arabic-Indic/full-width digits, Max round-trip, React lazy loading, rich text |
| `packages/social` | 47 | contacts (validation, encryption at rest, migration, search, poisoning look-alikes, initials); notifications (baseline, incoming/NFT/tx/approval, spam ignored, failed-read safety, per-kind switches, flood collapse, one-shot price alerts, locale); public snapshot while locked; Discover against real trimmed CoinGecko and DEX Screener fixtures (supported chains, impersonation, bait, thin pools, security-list hook, cache, partial outage); handle calldata, request building, contract-bound plain-language refine; SocialService end to end; bus schema; notification catalogs × 11 |
| `packages/names` | 29 (12 new) | handle syntax = contract rule, multi-family records, record validation, recent-registration flag, off/unreachable errors, reverse lookup forward check, ABI equals the compiled contract |
| `packages/vault` | +5 | app-data sealing: round trip, namespace separation, tamper detection, locked |
| `packages/engine` | +4 | handle recipient by family, `view.recipient`, social dispatch with lock rules, locked polling |
| `packages/ui` | 151 (72 new) | social screens (contacts, edit + errors, Send suggestions, German Send with a comma decimal, recipient contact/look-alike, handle claim/publish with privacy acknowledgement, notifications permission and alerts, Discover → Swap, language picker, `<html dir=rtl>`); i18n: 11 locales complete, plus a scan of every `.tsx` file for hard-coded English |
| `apps/mobile` | jest 12 (6 new), vitest 43 | contacts, Send suggestions, approval recipient, German formatting after a language change, Discover; swap links, notice routes, 11 mobile catalogs, hard-coded string scan |
| `contracts/handles` | forge 15 | register/records/batch/cap/validation (bidi override, Unicode look-alike), release + 30-day cooldown, reverse opt-in, fuzz: validation equals the documented rule; only the owner writes |

## Gaps

- **ClipHandles isn't deployed** (no keys here). The README has the deploy steps. Handles show "not switched on" until `services.clipHandles` is set.
- **Name resolvers need validators** for handle records (wiring step 1 above).
- **Swap of Discover tokens the wallet doesn't list** needs `token:` key resolution in the features swap service (step 3). On mobile, Discover opens Jupiter, Uniswap or SaucerSwap in the in-app browser, because the app has no native swap screen. SaucerSwap opens without a prefilled token.
- **Market data is mainnet.** In testnet builds, Discover is informational: the wallet's testnet assets can't trade these tokens.
- **Background-generated text is still English** (ClipErrors, decoded titles, activity titles, feature quotes), apart from the social error codes the UI maps and the notification text. (Since done: `r1/bg-i18n` made background text, including warnings, translatable in all 11 languages.)
- **Notifications are best-effort on mobile** (OS-scheduled background tasks, nothing after a force-quit on iOS). There is no push server, by design.
- **No Traditional Chinese** (zh-Hant falls back to zh-Hans). Native-speaker review of the 11 languages is recommended before release. The translators' open questions are in the stream report.
- **Contacts aren't synced** between devices. They are sealed with a seed-derived key, so a future sync could carry the ciphertext.
