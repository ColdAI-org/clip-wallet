---
"@clip-wallet/kit-modules": patch
---

The NEAR Wallet Selector, Stellar Wallets Kit and use-wallet modules show the name and icon the installed wallet announces (`window[globalKey].info`, set by 1Mask), so a kit-built wallet appears under its own identity in those pickers. Explicit options still win; without an announcement they fall back to Clip Wallet's identity.
