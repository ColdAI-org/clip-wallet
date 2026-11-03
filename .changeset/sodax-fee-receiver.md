---
"@coldai/clip-wallet-features": minor
---

The reviewed list of Clip fee receivers (`sodax-fee-receivers.json`) holds ColdAI LLC's address,
`0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f313`, so a mainnet build that sets it as `CLIP_SODAX_FEE_RECEIVER` offers
SODAX swaps. Any other address is refused as before: the build fails its mainnet check, SODAX stays off, and a swap
paying it is stopped before signing. A test pins the list.
