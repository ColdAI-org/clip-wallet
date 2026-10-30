---
"@clip-wallet/mobile-kit": patch
---

The in-app browser escapes `<`, `>`, line and paragraph separators and control characters in the values it writes into
the scripts it injects, so every value reaches the page unchanged.
