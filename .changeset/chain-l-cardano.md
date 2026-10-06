---
"@clip-wallet/chains-cardano": patch
---

CBOR maps with a repeated key (compared by value) are refused, so a transaction can't be shown with one value and
applied with another. Audit CHAIN-L.
