> **DRAFT — needs legal review** together with [privacy-policy.md](privacy-policy.md).

# In-app data-use disclosure (Settings → Your data)

The short, in-app version of the privacy policy, shown in the extension (`packages/ui/src/screens/DataUse.tsx`)
and the mobile app (`apps/mobile/src/screens/DataUse.tsx`). The text lives in the translation layer, namespace
`privacy`, in all 12 shipped languages (`packages/ui/src/i18n/<locale>/privacy.ts`; English is the source). The
mobile app reads the same strings through `PRIVACY_CATALOGS`. Translation QA (ICU, glossary, Arabic bidi
isolation) covers them like every other UI string.

**Keep it true.** If the wallet starts contacting something new, change this text, the privacy policy and
`apps/extension/store/listing.md` in the same pull request.

## English source

**Your data**

{name} has no account for you. Your recovery phrase and keys stay on this device, locked with your password. We
never see them.

| Section | Text |
|---|---|
| Stays on this device | Your recovery phrase, private keys, password, contacts, settings and activity. None of it is sent to us. |
| What the wallet looks up | To show balances and send payments, the wallet asks public network services (nodes and indexers) about your public addresses. Prices come from CoinGecko and DEX Screener. |
| Scam checks | Open scam lists are downloaded to this device and checked here, so they never learn which sites you visit. If this version has Blockaid switched on, Blockaid sees the site, the request and your address. |
| Only when you use them | Swap, buy and stake send your address and the amount to the provider you choose, and their own privacy policy applies. |
| Passkey backup, if you turn it on | Our backup service stores a locked copy that only your passkey can open, and a keyed hash of your email or your Google or Apple account so you can find it again. Delete it at any time. |
| Pictures of your collectibles | Pictures load through our media proxy, so the sites that host them never see your device. We don't keep a record of who asked. |
| Never | No analytics, no ads, no tracking, and we never sell data. |

Translations: de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi (machine-assisted, written to each language's
glossary in `packages/i18n/src/qa/glossary`; a native-speaker review is recommended before a public release).
