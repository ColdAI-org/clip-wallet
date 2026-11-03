# @coldai/clip-wallet-features

## 0.2.0

### Minor Changes

- e267fc9: The kit's packages are published as `@coldai/clip-wallet-<name>`: every `@clip-wallet/<name>` becomes
  `@coldai/clip-wallet-<name>`, for example `@clip-wallet/core` → `@coldai/clip-wallet-core`, and imports use the new
  names (`import { defineConfig } from "@coldai/clip-wallet-config"`). `create-clip-wallet` is unchanged:
  `npx create-clip-wallet` scaffolds a wallet as before.
- b3180f8: The reviewed list of Clip fee receivers (`sodax-fee-receivers.json`) holds ColdAI LLC's address,
  `0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f313`, so a mainnet build that sets it as `CLIP_SODAX_FEE_RECEIVER` offers
  SODAX swaps. Any other address is refused as before: the build fails its mainnet check, SODAX stays off, and a swap
  paying it is stopped before signing. A test pins the list.
- 876cb31: Cross-network swaps through SODAX (`SodaxSwap`), with the disclosed 0.875 % Clip fee on the amount you sell, paid to
  ColdAI LLC through SODAX's partner fee in its exact amount form. Mainnet builds only (SODAX has no test networks), and
  off unless the build sets an ExClip server URL and a fee receiver that is on the reviewed list
  (`sodax-fee-receivers.json`). Before anything can be approved the wallet decodes the transaction it
  built and refuses it unless the fee receiver is reviewed, the fee is at most 0.875 % and everything else matches the
  quote. Tokenised stocks (`isRwa`) are never offered. Quotes carry `clipFee` and `arrivesOn`; new exports `SodaxSwap`,
  `sodaxTokens`, `SODAX_SPOKES`, `SODAX_INTENTS`, `checkSodaxSwap`, `decodeSodaxSwap`, `sodaxFeeData`, `sodaxSwapTx`,
  `CLIP_FEE`, `clipFeeOn`, `withinClipFee`, `SODAX_FEE_RECEIVERS`, `isReviewedFeeReceiver`, `isFeeReceiverAddress`,
  `parseFeeReceivers` and the `@coldai/clip-wallet-features/sodax-fee` entry. Core gains the refusal and line-label messages in
  all 12 languages. See docs/features/sodax-swaps.md.

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@coldai/clip-wallet-route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- d90f6aa: Trailing slashes, base64 padding and NUL padding are trimmed with a scan from the end, and node error messages are
  matched with plain string searches one line at a time, so this work stays linear in the length of its input.
  `@coldai/clip-wallet-core` adds the two helpers this uses: `withoutTrailing(s, chars)` and `includesInOrder(text, ...parts)`.
  The plugin installer takes a pax `path` only from a record of its own, and the Phantom list is read line by line.
- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- cb6c413: SODAX swaps are set up from the build environment only, with no defaults: `CLIP_SODAX_SERVER_URL` (an ExClip server
  that quotes them) and `CLIP_SODAX_FEE_RECEIVER` (where the 0.875 % Clip fee goes), exported as `SODAX_SERVER_ENV` and
  `SODAX_FEE_RECEIVER_ENV`. `clipWallet()` passes them to the background only in a mainnet build that sets both
  (`sodaxFor()`), and only then adds host permissions for the server's origin and Sonic's RPC. The mainnet checklist
  gains the SODAX items: `mainnetProblems()` asks for both settings (the server over https, the receiver an address) once
  either is set, and the extension build refuses a receiver that isn't on the reviewed list (`sodaxProblems()`). A build
  without them offers no SODAX swaps. Features exports `SONIC_RPC_URL`.
- 7c459d0: A SODAX swap's review keeps the Clip fee, who receives it, the minimum you get and where it arrives even when the
  network can't dry-run the swap and the review stays unreadable (blocked unless blind signing is allowed). Steps gain
  `linesProven`: set only where `verify` proves every line from the request's own bytes, as SODAX's check does. Every
  other step keeps the audited behaviour (FEAT-02): an unreadable review shows only what the chain module read.
- 82697ae: SODAX swaps refuse an ExClip server that charges a fee of its own. Its `GET /api/exclip/config` must report SODAX
  configured, trading on, `partnerFeeBps` 0, `feeReceiver` null and no `feeSplit`. A server with a fee, plain or split,
  pins it on the quote, so the minimum you get would be set below what the swap can give: the quote stops with "Swapping
  isn't available right now." (`swap/server-fee`), as it does for a server that isn't set up (`swap/server-not-ready`).
  A server with a fee split publishes `partnerFeeBps` 0, so the previous check let it through.
- 4e79927: The swap quote shows the Clip fee on a SODAX swap before you review it: "Clip fee 0.875% · 0.875 USDC", with the
  amount in the asset you sell, a hint that it is part of what you pay and who receives it, and a separate "Network fee"
  row that says it is paid on top and shown before you approve. Advanced mode also shows where the swap arrives. Settings
  → Your data gains "Swaps between networks" (what the swap server, SODAX and Sonic see). Every string in all 12
  languages, in the extension, desktop and phone apps. A quote's `clipFee` now carries the fee's `name` ("Clip").
- Updated dependencies [07f329b]
- Updated dependencies [d0891e8]
- Updated dependencies [d6aeb53]
- Updated dependencies [28a4e18]
- Updated dependencies [9b69ba4]
- Updated dependencies [2e43a78]
- Updated dependencies [035d380]
- Updated dependencies [b44f2cd]
- Updated dependencies [ec56ae4]
- Updated dependencies [53feb71]
- Updated dependencies [86786a8]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [a84b2ab]
- Updated dependencies [ffd0808]
- Updated dependencies [d90f6aa]
- Updated dependencies [20b6dda]
- Updated dependencies [e267fc9]
- Updated dependencies [2d940da]
- Updated dependencies [31a0f40]
- Updated dependencies [f4715ce]
- Updated dependencies [876cb31]
- Updated dependencies [c6bf6f0]
  - @coldai/clip-wallet-chains-algorand@0.2.0
  - @coldai/clip-wallet-chains-aptos@0.2.0
  - @coldai/clip-wallet-chains-cardano@0.2.0
  - @coldai/clip-wallet-chains-hedera@0.2.0
  - @coldai/clip-wallet-chains-near@0.2.0
  - @coldai/clip-wallet-chains-solana@0.2.0
  - @coldai/clip-wallet-chains-starknet@0.2.0
  - @coldai/clip-wallet-chains-stellar@0.2.0
  - @coldai/clip-wallet-chains-substrate@0.2.0
  - @coldai/clip-wallet-chains-sui@0.2.0
  - @coldai/clip-wallet-chains-tezos@0.2.0
  - @coldai/clip-wallet-chains-ton@0.2.0
  - @coldai/clip-wallet-core@0.2.0
  - @coldai/clip-wallet-route@0.2.0
