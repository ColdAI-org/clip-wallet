---
"@clip-wallet/route": patch
---

Mainnet routes use only verifier families on the new `MAINNET_VERIFIER_FAMILIES` allowlist (exact match, today
`ethereum-sync-committee`); any other family, whatever it is called, is treated as a test verifier: refused on mainnet,
flagged on testnet. New exports `MAINNET_VERIFIER_FAMILIES`, `isMainnetVerifier`. Audit ROUTE-01.
