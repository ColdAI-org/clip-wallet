---
"@clip-wallet/chains-near": patch
---

NEAR call arguments are shown up to 4,000 characters (was 600, cut silently) and an ft_transfer_call `msg` up to
1,000 (was 200); past that the hidden length is shown and a caution says part of the call isn't on screen.
Audit CHAIN-L.
