# @clip-wallet/i18n

Clip Wallet's translation layer, with no dependencies: a small ICU message subset (plurals, select, tags) over the
platform's `Intl` for numbers, currencies and relative time. Ships the locale list (English plus 11 translations, incl. Arabic,
right-to-left) and how a device's language preferences map onto it.

```ts
import { createTranslator, LOCALES } from "@clip-wallet/i18n";
import { LocaleProvider, useT } from "@clip-wallet/i18n/react"; // optional React bindings (react is a peer)
```

The product name is never translated: messages take it as `{name}`, so a kit-built wallet's name shows everywhere.

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly. Pre-release: test networks by default.

MIT licence.
