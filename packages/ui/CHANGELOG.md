# @clip-wallet/ui

## 0.2.0

### Minor Changes

- e3fba40: Clip Connect (`@clip-wallet/connect`), a wallet-agnostic dapp SDK, and the EIP-5792 Wallet Call API with ERC-7682 auxiliary funds in 1Mask and over WalletConnect: one approval for a batch of calls, funded from the user's other balances when settle on Hedera can; dapps that never call the new methods see no difference. `window.injectedWeb3` is now writable so `@polkadot/extension-dapp` loads.
- 20b6dda: Every CLPR network with a self-custodial key model: twelve new families (Cosmos SDK chains Osmosis, dYdX, ZIGChain, Provenance, THORChain and Initia; TRON; XRP Ledger; Vaulta, Telos and XPR Network; MultiversX; Internet Computer; Stacks; Fuel; Bitcoin Cash), Chainflip in chains-substrate, STRATO and Arc mainnet in chains-evm, and their dapp providers where a standard lets the wallet appear as itself.

### Patch Changes

- 07f329b: Relicensed from MIT to the Apache License 2.0 (`Copyright 2026 ColdAI`). Every published package now ships `LICENSE`
  (Apache-2.0) and a `NOTICE` with the trademark note ("Clip Wallet", "1Mask" and the logo are ColdAI trademarks; the
  licence grants no trademark rights). `@clip-wallet/route` keeps the MIT notice of the vendored CLPRouter SDK planner,
  and `create-clip-wallet` keeps the MIT notice of the Scaffold-HBAR / Scaffold-ETH 2 dapp in its bundled template.
  Projects made with `create-clip-wallet` or the Scaffold-HBAR template start as Apache-2.0.
- 886f755: Approval screens hide "blind-signing" warnings only when the request is blocked as unreadable, where the blocked notice
  stands in for them. A readable request shows them as written, e.g. a PSBT signature that doesn't lock its outputs or a
  Sui package publish. Applies to the extension and desktop approval screens (packages/ui) and the phone app's.
- 6d36975: Fixes found by the testnet dapp matrix (docs/r1/dapp-matrix.md):

  - Hedera EVM dapps (chain 296/295) can connect over EIP-1193: Hedera's EVM is a dapp request network whenever the wallet has Hedera (`dappRequestNetworks`), not only with settle on Hedera. It is still never listed or scanned.
  - 1Mask answers Hedera extension discovery (`@hashgraph/hedera-wallet-connect` DAppConnector / HashConnect v3): `hedera-extension-query` lists the wallet, and `hedera-extension-connect-<id>` pairs over WalletConnect (the proposal still needs approval). On only in builds with a WalletConnect project id.
  - A request a chain module refuses to decode keeps the module's plain-words reason (`decodeFailureReason`) instead of only "can't read this request".
  - Solana: a SOL transfer to yourself is decoded ("Send 0.000000001 SOL to G1zR…dxzk") instead of "Approve a transaction".
  - Aptos, NEAR, Sui: an empty or not-yet-created account gets "not enough to pay the fee" / "doesn't exist yet" instead of misleading reasons.
  - Approval balance changes never show a non-zero amount as "−0".
  - Solana, Sui and Cardano self-transfers say what moves (Cardano: "Move your ADA between your own addresses").
  - Hedera `addressFromPublicKey` returns the EIP-55 alias the vault shows; Cardano counts coins at the payment key's enterprise address.
  - Planning a request on Hedera's EVM checks that network's own balance (it isn't in the portfolio).
  - Stellar Horizon reads retry transient failures twice with backoff before reporting offline.

- 14807cd: New packages: `@clip-wallet/desktop-kit` (the Electron app for macOS, Windows and Linux: main process, preloads, pages,
  built-in dapp browser, `clipDesktop()` for electron-vite and `electronBuilderConfig()` for electron-builder) and
  `@clip-wallet/mobile-kit` (the Expo app for iOS and Android: screens, vault host, in-app browser, `expoConfig()` and
  `withClipWallet()` for Metro), both driven by clip.config.ts like `@clip-wallet/extension-kit`.

  `@clip-wallet/config`: `languages`, `appId`, `scheme`, `desktop` / `mobile` id overrides, and the hosted-mode `fees` /
  `usage` blocks reserved for Clip Cloud (off by default, never acted on by the kit); `platformIds()`, `enabledLanguages()`;
  `@clip-wallet/config/node` with `loadClipConfigSync()` and the shared build-environment helpers.
  `@clip-wallet/i18n`: `negotiateLocale` / `resolveLocale` take the languages a wallet offers; `offeredLocales()`.
  `@clip-wallet/ui`: Settings → Language lists only the languages clip.config offers.

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
- Updated dependencies [9b69ba4]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [14807cd]
- Updated dependencies [a84b2ab]
- Updated dependencies [8b60f88]
- Updated dependencies [d90f6aa]
- Updated dependencies [b98fe95]
- Updated dependencies [f5a0e15]
- Updated dependencies [20b6dda]
- Updated dependencies [2d940da]
- Updated dependencies [93f8dbc]
- Updated dependencies [31a0f40]
- Updated dependencies [d67d756]
- Updated dependencies [c6bf6f0]
  - @clip-wallet/config@0.2.0
  - @clip-wallet/core@0.2.0
  - @clip-wallet/features@0.2.0
  - @clip-wallet/hardware@0.2.0
  - @clip-wallet/i18n@0.2.0
  - @clip-wallet/link@0.2.0
  - @clip-wallet/media-client@0.2.0
  - @clip-wallet/security@0.2.0
  - @clip-wallet/social@0.2.0
