---
"@coldai/clip-wallet-ui": patch
---

The review of a swap that carries the Clip fee (SODAX) calls its other fee row "Network fee" instead of "Fee", so the
two fees can't be mixed up; the Clip fee, who receives it and where the swap arrives are rows of their own. New string
`approval.networkFee` in all 12 languages.
