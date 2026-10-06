---
"@clip-wallet/chains-substrate": patch
---

A payload built for a runtime version the wallet can't load is shown as unreadable (blind, danger) instead of being
decoded with the current runtime's metadata. `Assets.transfer_approved` reads its `owner` and `destination` fields
(it was shown without a recipient). Audit CHAIN-L.
