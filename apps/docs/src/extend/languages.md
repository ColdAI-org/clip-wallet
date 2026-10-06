# Add a language

Clip Wallet ships English and 11 translations: German, French, Spanish, Brazilian Portuguese, Italian, Turkish,
Japanese, Korean, Simplified Chinese, Arabic (right to left) and Hindi. Adding a language is mostly translation, plus a
few checks that keep every language as safe and as clear as the English.

## Where the strings live

| Catalog | Path | What |
| --- | --- | --- |
| Screens | `packages/ui/src/i18n/<code>/` | every screen, per namespace |
| Background | `packages/core/src/messages/locales/<code>.ts` | approval titles, warnings and errors from the chain modules and services |
| Phone | `apps/mobile/src/i18n/<code>/` | the phone app's screens (`m.*`) |
| Notifications | `packages/social/src/notifications/locales/<code>.ts` | OS notifications |
| Glossary | `packages/i18n/src/qa/glossary/<code>.ts` | the must-match terms (below) |

## Steps

1. **Register the locale.** Add the code (BCP 47, such as `pl` or `pt-BR`) to `LOCALE_CODES` and its native and English
   names and direction to `LOCALES` in [`packages/i18n/src/locales.ts`](repo:packages/i18n/src/locales.ts). Check
   `negotiateLocale()` maps the device languages you expect.
2. **Translate each catalog.** Copy English's ids; the types fail until every id has a translation and no extra ids
   exist. Register the screens' catalog in `UI_CATALOGS` (`packages/ui/src/i18n/index.ts`) as a lazy import, so each
   language is its own chunk.
3. **Write the glossary.** About 25 terms whose translation must be the same everywhere: wallet, recovery phrase,
   passkey, account, address, network fee, collectible, stake… Each entry is a case-insensitive regex, so inflected
   forms match.
4. **Run the checks** (they run in `pnpm test` for every catalog): `pnpm --filter @clip-wallet/ui test`,
   `pnpm --filter @clip-wallet/mobile test`, `pnpm --filter @clip-wallet/social test`,
   `pnpm --filter @clip-wallet/core test`.
5. **Have a native speaker read it,** especially the safety-critical strings (below).

## The rules the checks enforce

| Rule | Check |
| --- | --- |
| Same ids, same `{arguments}`, same tags as English; protected terms kept verbatim | `checkTranslation()` |
| Every message parses and renders for 0, 1, 2, 3, 5, 11, 12, 21, 22, 100, 101, 1.5 and 1,000,000 and every select key, with nothing left as `{name}` | `lintCatalog()` |
| Plural categories exist in the language; Arabic needs `few` and `many`; `=n` and select keys English relies on are kept; no literal `#` outside a plural | `lintCatalog()` |
| A glossary term's translation appears wherever English uses the term | `checkGlossary()` |
| Right-to-left languages wrap every interpolated value in isolates | `unisolatedArguments()` |

All of them are in `@clip-wallet/i18n/qa`, a test-only entry point. Here they are on a small Polish catalog:

<<< @/snippets/extend/i18n-qa.ts

## Messages are ICU

Messages use a small ICU subset: `{name}`, `{n, number}`, `{n, plural, one {…} other {…}}` with `#`,
`{kind, select, … other {…}}` and simple tags (`<b>…</b>`). Numbers and plurals come from the platform's `Intl`, and
`#` and `{n, number}` use the same Latin digits as amounts.

## Right-to-left languages

Wrap every interpolated value, such as an amount, a symbol or an address, in U+2068 FIRST STRONG ISOLATE and U+2069 POP
DIRECTIONAL ISOLATE. Otherwise an address or a number can reorder the sentence around it. Keep a sign or an `@` inside
the isolate with its value.

<<< @/snippets/extend/i18n-bidi.ts

## Never translate

- The product name. Messages take it as `{name}`, so a kit-built wallet's name shows everywhere.
- Asset symbols, network names, addresses, app names and amounts: they are values.
- Brand and device names (WalletConnect, Ledger, Keystone, Face ID, Touch ID, MetaMask…), and Apple's and Google's
  sign-in button texts, which their brand guidelines fix.

## Safety-critical strings keep their strength

The recovery phrase, unreadable requests and blind signing, scams, look-alike addresses, unlimited approvals,
suspicious tokens and wrong-network loss. "Can take all of it" must not become "might take some". A reviewer reads these
against English for every language.

The last full review and its per-language decisions: [`docs/i18n/review-2026-10.md`](repo:docs/i18n/review-2026-10.md).
