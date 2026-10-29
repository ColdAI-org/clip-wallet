---
"@clip-wallet/ui": patch
"@clip-wallet/mobile-kit": patch
---

Approval screens hide "blind-signing" warnings only when the request is blocked as unreadable, where the blocked notice
stands in for them. A readable request shows them as written, e.g. a PSBT signature that doesn't lock its outputs or a
Sui package publish. Applies to the extension and desktop approval screens (packages/ui) and the phone app's.
