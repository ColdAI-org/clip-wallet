---
"@coldai/clip-wallet-ui": minor
"@coldai/clip-wallet-mobile-kit": minor
"@coldai/clip-wallet-features": patch
---

The swap quote shows the Clip fee on a SODAX swap before you review it: "Clip fee 0.875% · 0.875 USDC", with the
amount in the asset you sell, a hint that it is part of what you pay and who receives it, and a separate "Network fee"
row that says it is paid on top and shown before you approve. Advanced mode also shows where the swap arrives. Settings
→ Your data gains "Swaps between networks" (what the swap server, SODAX and Sonic see). Every string in all 12
languages, in the extension, desktop and phone apps. A quote's `clipFee` now carries the fee's `name` ("Clip").
