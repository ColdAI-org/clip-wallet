---
"@clip-wallet/security": patch
"@clip-wallet/ui": patch
"@clip-wallet/mobile-kit": patch
---

App permissions now say something for every network family it can't scan. Cardano, Fuel and Bitcoin Cash have
nothing that can be granted, and say so. TRON, TON, NEAR, Internet Computer, Cosmos, Provenance, Initia, THORChain,
XRP Ledger, Antelope, Algorand, Stacks and MultiversX get a note that their permissions aren't listed yet. Before,
they were left off the screen without a word. The existing "not listed yet" notes now say "this wallet" rather than a
product name. `APPROVAL_NOTE_CODES` lists every note code, and the permissions screens show each one in the user's
language.
