# @clip-wallet/i18n

Clip Wallet's translation layer, with no dependencies: a small ICU message subset (plurals, select, tags) over the
platform's `Intl` for numbers, currencies and relative time. Ships the locale list (English plus 11 translations,
including right-to-left Arabic), how a device's language preferences map onto it, optional React bindings, and the
translation QA checks every catalog passes.

The product name is never translated: messages take it as `{name}`, so a kit-built wallet's name shows everywhere.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/i18n
```

## Example

```ts
import { createTranslator, negotiateLocale } from "@clip-wallet/i18n";

const en = { "approvals.count": "{n, plural, one {# request is waiting} other {# requests are waiting}}" };
const de = { "approvals.count": "{n, plural, one {# Anfrage wartet} other {# Anfragen warten}}" };

const locale = negotiateLocale(["de-AT", "en"]); // "de"
const t = createTranslator(en, de, locale);
console.log(t("approvals.count", { n: 3 })); // "3 Anfragen warten"
```

React: `LocaleProvider`, `useT`, `useFormat` from `@clip-wallet/i18n/react` (React is an optional peer). QA checks for
tests: `lintCatalog`, `checkGlossary`, `unisolatedArguments` from `@clip-wallet/i18n/qa`.

## Documentation

- [Add a language](https://coldai.org/clip/docs/extend/languages.html)
- [API reference](https://coldai.org/clip/docs/reference/api/i18n.html)

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
