# @clip-wallet/extension-kit

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
- 1584585: `npx create-clip-wallet my-wallet` makes the wallet on every platform from one `clip.config.ts` at the project root:
  the browser extension (`packages/extension`), the desktop app (`packages/desktop`, Electron on
  `@clip-wallet/desktop-kit`) and the phone app (`packages/mobile`, Expo on `@clip-wallet/mobile-kit`), plus the
  Scaffold-HBAR dapp with `--scaffold-hbar`. New options: `--platforms`, `--id`, `--logo` (every platform's icons
  rendered from one PNG or SVG with Node alone: extension sizes, `.icns`, `.ico`, Linux PNGs, tray, iOS, Android adaptive
  and monochrome, splash), `--languages`, `--scaffold-hbar`; a `brand` command (`pnpm wallet:brand`); per-platform next
  steps; `docs/signing.md` in every project (store accounts and code-signing variables, no secrets). The identity, the
  config, the logo, `MAINNET.md`, `.env` and `.keys/` now live at the project root.

  `@clip-wallet/extension-kit`: `clipWallet({ configDir })` reads the icon, `MAINNET.md` and the wallet-wide `.env` next to
  a shared `clip.config.ts`; `wxt zip` names the store zip after the wallet.

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

- 2d940da: Every package README is now an npm landing page: what the package is for, how to install it, a minimal example that compiles, and links to the developer docs.
- Updated dependencies [07f329b]
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
- Updated dependencies [14807cd]
- Updated dependencies [8b60f88]
- Updated dependencies [ffd0808]
- Updated dependencies [b526f86]
- Updated dependencies [20b6dda]
- Updated dependencies [b97d4c2]
- Updated dependencies [2d940da]
- Updated dependencies [31a0f40]
- Updated dependencies [b25505f]
- Updated dependencies [f4715ce]
- Updated dependencies [db17749]
  - @clip-wallet/1mask@0.2.0
  - @clip-wallet/backup-client@0.2.0
  - @clip-wallet/chains-algorand@0.2.0
  - @clip-wallet/chains-aptos@0.2.0
  - @clip-wallet/chains-bitcoin@0.2.0
  - @clip-wallet/chains-cardano@0.2.0
  - @clip-wallet/chains-evm@0.2.0
  - @clip-wallet/chains-hedera@0.2.0
  - @clip-wallet/chains-near@0.2.0
  - @clip-wallet/chains-solana@0.2.0
  - @clip-wallet/chains-starknet@0.2.0
  - @clip-wallet/chains-stellar@0.2.0
  - @clip-wallet/chains-substrate@0.2.0
  - @clip-wallet/chains-sui@0.2.0
  - @clip-wallet/chains-tezos@0.2.0
  - @clip-wallet/chains-ton@0.2.0
  - @clip-wallet/config@0.2.0
  - @clip-wallet/core@0.2.0
  - @clip-wallet/engine@0.2.0
  - @clip-wallet/features@0.2.0
  - @clip-wallet/hardware@0.2.0
  - @clip-wallet/i18n@0.2.0
  - @clip-wallet/kit-modules@0.2.0
  - @clip-wallet/link@0.2.0
  - @clip-wallet/names@0.2.0
  - @clip-wallet/plugins@0.2.0
  - @clip-wallet/route@0.2.0
  - @clip-wallet/security@0.2.0
  - @clip-wallet/social@0.2.0
  - @clip-wallet/ui@0.2.0
  - @clip-wallet/vault@0.2.0
  - @clip-wallet/chains-cosmos@0.2.0
  - @clip-wallet/chains-tron@0.2.0
  - @clip-wallet/chains-xrpl@0.2.0
  - @clip-wallet/chains-antelope@0.2.0
  - @clip-wallet/chains-multiversx@0.2.0
  - @clip-wallet/chains-icp@0.2.0
  - @clip-wallet/chains-stacks@0.2.0
  - @clip-wallet/chains-fuel@0.2.0
  - @clip-wallet/chains-bitcoincash@0.2.0
