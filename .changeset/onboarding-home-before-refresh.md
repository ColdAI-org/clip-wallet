---
"@clip-wallet/ui": patch
---

Finishing onboarding goes home before it refreshes the wallet's state, so a tap made while that refresh runs
(Settings, say) is no longer undone when it lands.
