---
"@clip-wallet/link": patch
"create-clip-wallet": patch
---

The desktop link server listens first and replaces a socket left behind only when nothing answers on it, so a copy of
the app that is running keeps its socket (starting a second one fails with `EADDRINUSE` instead). create-clip-wallet
reads the files it edits once instead of checking for them first.
