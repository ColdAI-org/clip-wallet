---
"@clip-wallet/chains-stellar": patch
---

SEP-43 `signAuthEntry` approvals always carry a warning: danger when the authorized call tree can move or approve
assets (SEP-41 / SAC functions, contract creation), caution otherwise; plus a caution when the entry has already
expired or stays valid for more than about a day. Audit CHAIN-L.
