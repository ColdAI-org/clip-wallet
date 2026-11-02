---
"@clip-wallet/features": patch
---

SODAX swaps refuse an ExClip server that charges a fee of its own. Its `GET /api/exclip/config` must report SODAX
configured, trading on, `partnerFeeBps` 0, `feeReceiver` null and no `feeSplit`. A server with a fee, plain or split,
pins it on the quote, so the minimum you get would be set below what the swap can give: the quote stops with "Swapping
isn't available right now." (`swap/server-fee`), as it does for a server that isn't set up (`swap/server-not-ready`).
A server with a fee split publishes `partnerFeeBps` 0, so the previous check let it through.
