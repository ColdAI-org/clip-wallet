---
"@clip-wallet/ui": minor
"@clip-wallet/mobile-kit": patch
---

`Row` takes `hintTone="strong"` for a hint someone decides on: it is drawn in `--clip-text-2`, AA 4.5:1 on every
surface in both modes, instead of the muted hint colour. The swap quote's Clip fee hint ("Part of the 100 USDC you pay.
It goes to ColdAI LLC.") uses it in the extension, desktop and phone apps.
