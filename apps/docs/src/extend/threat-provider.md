# Add a scam-check source

Scam detection in `@clip-wallet/security` is a list of `ThreatIntelProvider`s, consulted when a site asks to connect
and after every request is decoded. Clip ships the open lists (MetaMask, ScamSniffer, Phantom, PolkadotJS), local
heuristics (look-alike recipients, zero-value poisoning, new contracts) and an optional Blockaid scanner. You can add
your own.

## The interface

| Member | |
| --- | --- |
| `id`, `name` | an id for tests and Advanced mode; the name shown in Settings → Security |
| `privacy` | **one plain, true sentence** about what leaves the device. Shown in Settings → Security. |
| `sendsUserData` | `false` means the provider never sends the person's addresses, requests or the sites they visit anywhere |
| `status()` | `{ enabled, updatedAt?, entries?, unavailable? }` |
| `load()`, `refresh(force?)` | load the cached copy; fetch a fresh one when stale. **Keep the last copy on failure.** |
| `checkSiteSync(host)`, `checkAddressSync(address)` | synchronous lookups (WalletConnect's `isKnownScam`, the revoker) |
| `checkSite(origin)`, `checkTransaction(input)` | async checks on connect and after decode |

Findings are `{ level, code, message, source }` with codes `phishing-site`, `malicious-transaction`,
`address-poisoning`, `known-scam` or `new-recipient`.

## An example

A list you download once a day and match on the device:

<<< @/snippets/extend/threat-provider.ts

## The rules

1. **Say exactly what leaves the device**, in `privacy` and in a comment on the provider. Downloading a whole list and
   matching locally is the model to follow.
2. **Anything that sends the person's data to a third party is off unless a key is configured**, and Settings → Security
   says so (like Blockaid). Keys come from the build environment, never from config or source.
3. **Never lower the floor.** A provider adds warnings; it never removes the module's or another provider's, and never
   switches the open lists off. `securityFloorProblems()` refuses mainnet configs that try.
4. **Fail safe.** A provider that can't refresh keeps its last copy; a provider that throws is skipped, never fatal.

Register it with the other providers in the security service's construction (see
[`packages/security/src/threat`](repo:packages/security/src/threat)) and test the privacy contract: which requests carry
the person's address, if any.
