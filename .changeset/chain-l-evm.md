---
"@clip-wallet/chains-evm": patch
"@clip-wallet/core": patch
---

EVM: a transaction with 1–3 bytes of call data is decoded as a call (unreadable without a selector), not shown as a
plain send. personal_sign of non-text data no longer says it "can't move funds": a 32-byte hash (how Safe owners
approve a safeTxHash) is a danger warning, other data a caution. The catalog drops that sentence. Audit CHAIN-L.
