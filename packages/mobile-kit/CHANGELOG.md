# @clip-wallet/mobile-kit

## 0.2.0

### Patch Changes

- 886f755: Approval screens hide "blind-signing" warnings only when the request is blocked as unreadable, where the blocked notice
  stands in for them. A readable request shows them as written, e.g. a PSBT signature that doesn't lock its outputs or a
  Sui package publish. Applies to the extension and desktop approval screens (packages/ui) and the phone app's.
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
- 3b70d4d: The in-app browser escapes `<`, `>`, line and paragraph separators and control characters in the values it writes into
  the scripts it injects, so every value reaches the page unchanged.
- c629c95: Plugin installs on React Native gunzip with pako 3.0.2 (was 2.2.0). The streaming `Inflate` that stops at the size cap
  works as before.
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
- Updated dependencies [886f755]
- Updated dependencies [9b69ba4]
- Updated dependencies [86786a8]
- Updated dependencies [e3fba40]
- Updated dependencies [6d36975]
- Updated dependencies [14807cd]
- Updated dependencies [a84b2ab]
- Updated dependencies [8b60f88]
- Updated dependencies [d90f6aa]
- Updated dependencies [b98fe95]
- Updated dependencies [20b6dda]
- Updated dependencies [b97d4c2]
- Updated dependencies [2d940da]
- Updated dependencies [93f8dbc]
- Updated dependencies [31a0f40]
- Updated dependencies [68820e5]
- Updated dependencies [b25505f]
- Updated dependencies [d67d756]
- Updated dependencies [c6bf6f0]
- Updated dependencies [db17749]
  - @clip-wallet/1mask@0.2.0
  - @clip-wallet/config@0.2.0
  - @clip-wallet/core@0.2.0
  - @clip-wallet/engine@0.2.0
  - @clip-wallet/features@0.2.0
  - @clip-wallet/hardware@0.2.0
  - @clip-wallet/i18n@0.2.0
  - @clip-wallet/link@0.2.0
  - @clip-wallet/names@0.2.0
  - @clip-wallet/plugins@0.2.0
  - @clip-wallet/security@0.2.0
  - @clip-wallet/social@0.2.0
  - @clip-wallet/ui@0.2.0
  - @clip-wallet/vault@0.2.0
