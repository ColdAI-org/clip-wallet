# @clip-wallet/security

## 0.2.0

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- d90f6aa: Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
  matched with plain string searches one line at a time, so this work stays linear in the length of its input.
  `@clip-wallet/core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
  The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- 93f8dbc: App permissions now say something for every network family it can't scan. Cardano, Fuel and Bitcoin Cash have
  nothing that can be granted, and say so. TRON, TON, NEAR, Internet Computer, Cosmos, Provenance, Initia, THORChain,
  XRP Ledger, Antelope, Algorand, Stacks and MultiversX get a note that their permissions aren't listed yet. Before,
  they were left off the screen without a word. The existing "not listed yet" notes now say "this wallet" rather than a
  product name. `APPROVAL_NOTE_CODES` lists every note code, and the permissions screens show each one in the user's
  language.
- d67d756: App permissions now list single-NFT ERC-721 approvals (`approve(spender, tokenId)`) while `getApproved` still names
  the app and you still own the NFT, and remove them with `approve(0x0, tokenId)`. The permissions screens say these in
  the user's language, and the approval for `approve(0x0, tokenId)` reads as removing a permission.
- Updated dependencies [07f329b]
- Updated dependencies [d0891e8]
- Updated dependencies [9b69ba4]
- Updated dependencies [035d380]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [a84b2ab]
- Updated dependencies [ffd0808]
- Updated dependencies [d90f6aa]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
- Updated dependencies [31a0f40]
- Updated dependencies [d67d756]
- Updated dependencies [c6bf6f0]
  - @clip-wallet/chains-evm@0.2.0
  - @clip-wallet/chains-hedera@0.2.0
  - @clip-wallet/chains-solana@0.2.0
  - @clip-wallet/core@0.2.0
  - @clip-wallet/features@0.2.0
