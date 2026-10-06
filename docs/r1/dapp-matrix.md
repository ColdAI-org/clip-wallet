# Testnet dapp matrix

Stock wallet-picker UIs and real hosted testnet dapps: [picker-matrix.md](picker-matrix.md).

The real extension build (real vault, real chain modules, real 1Mask) against each family's public testnet. Playwright
drives a dapp page that finds Clip through that ecosystem's own discovery and talks to it through that ecosystem's own
dapp library. There is no Clip SDK on the dapp side.

| Level | What passes |
| --- | --- |
| **L1 connect** | The dapp discovers Clip through the ecosystem's standard discovery and gets the matrix account. The test checks it is the address in `apps/extension/e2e/matrix/addresses.json`, and that the chain module re-derives that address from the vault's public key. |
| **L2 sign** | The dapp signs a message, and the ecosystem's own verify function accepts it. |
| **L3 send** | The dapp signs and broadcasts a self-transfer of the smallest amount, and the testnet's public RPC or explorer API confirms it. |
| **L4 approval** | The approval window shows the decoded request: amount, symbol and recipient. Rows must not overflow, and the request must not be blind. A screenshot is taken. |

L3 skips while the account holds less than its minimum. L4 then declines the same request in the wallet. Funding:
[dapp-matrix-funding.md](dapp-matrix-funding.md).

```bash
pnpm --filter @clip-wallet/extension matrix                # builds (WalletConnect on if the id is set), runs all
pnpm --filter @clip-wallet/extension matrix -- -g cardano  # one family
node scripts/dapp-matrix-balances.mjs --watch              # see faucet funds land, then rerun
```

The default `pnpm e2e` leaves the matrix out: it needs public testnets and the matrix wallet (`DAPP_MATRIX=1` turns it
on). The matrix wallet's phrase is read from the git-excluded `.env.dapp-matrix` and typed into onboarding's import
flow. Trace, screenshot-on-failure and video are off for the whole spec, so the phrase never lands in an artifact.

## Results (2026-10-05, full run after funding)

Every L3 hash below was confirmed by the test itself on the testnet's public RPC or indexer, independently of the
wallet (`confirmTx` in `e2e/matrix/chain.ts`), and links to the explorer.

| Family | Testnet | L1 connect | L2 sign | L3 send (tx) | L4 approval |
| --- | --- | --- | --- | --- | --- |
| EVM | Sepolia | pass | pass (viem `verifyMessage`) | **pass** [0x398603c4…dcf8](https://sepolia.etherscan.io/tx/0x398603c4da73c2ed659c645bcf0b58f104284c894565e50c0ca990168d98dcf8) | pass: "Send <0.000001 ETH to 0x05AC…2717" |
| EVM, live dapp | Sepolia | pass ([MetaMask test dapp](https://metamask.github.io/test-dapp/) lists and connects Clip over EIP-6963) | n/a ¹ | n/a ¹ | n/a ¹ |
| Hedera, injected EIP-1193 | Hedera testnet (296) | pass (fix 1) | pass (viem) | **pass** [0xcfb5ffa6…9047](https://hashscan.io/testnet/transaction/0xcfb5ffa6446156760a95add3f00fba453334b7d7f3daa74ed2f0a8e8166f9047) (fix 2) | pass: "Send <0.000001 HBAR to 0x05AC…2717" |
| Hedera, WalletConnect / HashConnect | Hedera testnet | skip ² | skip ² | skip ² | skip ² |
| Solana | Devnet | pass | pass (`verifyMessageSignature`) | **pass** [25xEHvRV…Ls6Y](https://explorer.solana.com/tx/25xEHvRV7nH1UQpAuhqcUKS8CofoWVaYWvEXrqQzTqfSK217nzGX5HNvz7vqXtyDQEGHsDf3EfhXSChcyrN7Ls6Y?cluster=devnet) | pass: "Send 0.000000001 SOL to G1zR…dxzk" (fix 4) |
| Bitcoin | Testnet4 | pass | pass (bip322-js, BIP-322) | skip: holds 546 sats, needs 5,000. An earlier run with 0.005 tBTC passed: [1a80e46e…3386](https://mempool.space/testnet4/tx/1a80e46e71e401055f6f610c66f4eb71e33beb9e35ecc55e74a97925a5bd3386) | skip while short. The approval says "You don't have enough BTC…" (fix 3). Funded, it passed: "Move your BTC between your own addresses" ³ |
| Sui | Testnet | pass | pass (`verifyPersonalMessageSignature`) | **pass** [4mtQgGbW…YCYgL](https://suiscan.xyz/testnet/tx/4mtQgGbWGRAXmMXy8W98ELYy9UXwQNTr5mmrXAcYCYgL) | pass: "Send 0.000000001 SUI to 0x6103…c5f9" (fix 4) |
| Aptos | Testnet | pass | pass (ts-sdk `verifySignature`, AIP-62) | skip: needs 0.01 APT | skip: needs funds. The approval says "You don't have enough APT to pay the network fee." (fixes 3 and 5) |
| Cardano | Preprod | pass | pass (cardano-verify-datasignature, CIP-8) | **pass** [a722a4bf…a93d](https://preprod.cardanoscan.io/transaction/a722a4bf90217115de7488e1410c140d6bef3156bc91e2ec71c4bcccbf9da93d) | pass: "Move your ADA between your own addresses" (fix 4) |
| Substrate | Westend | pass | pass (`signatureVerify`) | **pass** [0x7b235ac6…a91a](https://westend.subscan.io/extrinsic/0x7b235ac6ae275e09872f979c1efbbdafc874e25ed975b3d612d6ee0e218fa91a) (block hash of inclusion) | pass: "Send 0.000000000001 WND to 5Gj64M…HCQb" |
| Starknet | Sepolia | pass | pass (starknet.js `typedData.verifyMessage`) | **pass** [0x0368b317…4db0](https://sepolia.voyager.online/tx/0x0368b31742d49ad25c261047de09c8a2e40ca41b598e8145b1086dad3a004db0) (the account was deployed by an earlier run) | pass: "Send 0.000000000000000001 STRK to 0x014f…e6b8" |
| TON | Testnet | pass | pass (TON Connect sign-data, `signVerify`) | skip: needs 0.2 GRAM | pass: "Send 0.000000001 GRAM to 0QBQ…aXFi" |
| NEAR | Testnet | pass | pass (NEP-413, `PublicKey.verify`) | skip: needs 0.1 NEAR | skip: needs funds. The approval says "This account doesn't exist on NEAR yet. Receive some NEAR first" (fixes 3 and 5) |
| Stellar | Testnet | pass | pass (SEP-53, `Keypair.verify`) | **pass** [49592861…3554](https://stellar.expert/explorer/testnet/tx/495928614f41a96371e62b105abaa8b973824a20cde6220f4d088ad1d8453554) | pass: "Send 0.0000001 XLM to GB4N…VYVJ" |
| Tezos | Shadownet | pass | pass (Taquito `verifySignature`) | **pass** [onwo49LZ…bXniXZ](https://shadownet.tzkt.io/onwo49LZraha6MYrwX2rMQ5jEXYtHMG53VBXRexv1uwfMbXniXZ) | pass: "Send 0.000001 XTZ to yourself" |
| Algorand | TestNet | pass | n/a (use-wallet v5 / ARC-1 have no message signing; ARC-60 is a draft) | **pass** [B3EKJPKV…QTSQ](https://lora.algokit.io/testnet/transaction/B3EKJPKVQQHBORJ5QGPEJCNSCIINHHMZULNYAOA2OQPKK2LBQTSQ) | pass: "Send 0.000001 ALGO to you" |

Totals:

- L1: 15 of 15 pass (the WalletConnect row is skipped).
- L2: 13 pass, 2 n/a.
- L3: 11 confirmed on chain; 4 wait for funds (Bitcoin, Aptos, TON, NEAR).
- L4: 12 pass; 3 wait for funds (Bitcoin, Aptos, NEAR), and each says why.
- No failures.

Earlier confirmed runs (before the coordinator's funding): Hedera EVM
[0xcf9db775…4a60](https://hashscan.io/testnet/transaction/0xcf9db77579742c5bd97c4bad1b181f5ad91c0aac6e1c827889ca2afae9534a60),
Starknet's first transaction (account deploy + transfer)
[0x019466e3…0feb](https://sepolia.voyager.online/tx/0x019466e35039dd3de3a79ac1a0a58bdfd389d98437c322a74979826230640feb),
Tezos's first operation (reveal + transfer)
[opUyZvDL…A2X](https://shadownet.tzkt.io/opUyZvDLicpwx9Ewf5Kp2NMch8VarW5FiQbza43jppU1nmA5A2X).

1. The MetaMask test dapp enables its sign and send buttons only when `provider.isMetaMask` is true (its
   `isMetaMaskInstalled()`). Clip deliberately doesn't impersonate MetaMask, so the wagmi row covers those levels.
2. Needs `WALLETCONNECT_PROJECT_ID` in `.env.dapp-matrix`. Then `pnpm --filter @clip-wallet/extension matrix` builds
   the wallet with `CLIP_WALLETCONNECT_PROJECT_ID` and runs the row. Until then it skips with that message. The
   Hedera account is funded (0.0.10872693).
3. Bitcoin's decode lists the 546-sat output to yourself as "Change back to you". That is true, but it reads as change
   rather than "the amount you asked to send". Not changed; see "Open findings".

Screenshots: `apps/extension/e2e/shots/matrix/` (`<family>-sign.png`, `<family>-approval.png`,
`evm-live-connected.png`). Raw results: `apps/extension/e2e/shots/matrix/results.json`.

## networks87 rows (2026-10-06)

The families added for the remaining CLPR networks ([networks87.md](networks87.md)), same levels and rules, run with
`pnpm --filter @clip-wallet/extension matrix -- -g "matrix: (cosmos|tron|stacks|fuel|xrpl|chainflip|multiversx)"`.
The existing rows were re-run in the same session with no change (all previous passes still pass).

| Family | Testnet | Dapp library / discovery | L1 connect | L2 sign | L3 send (tx) | L4 approval |
| --- | --- | --- | --- | --- | --- | --- |
| Cosmos SDK (Osmosis) | osmo-test-5 | cosmjs `SigningStargateClient` over Clip's Keplr-compatible `window.clipwallet.cosmos` | pass | pass (ADR-36, `@cosmjs/crypto` `Secp256k1.verifySignature`) | skip: needs 0.1 OSMO | skip: "the account doesn't exist on osmo-test-5 yet" |
| TRON | Nile | raw TIP-6963 discovery + TIP-1193 (no tronwallet adapter accepts a third-party TIP-6963 wallet), TronWeb | pass | pass (TronWeb `Trx.verifyMessageV2`) | skip: needs 2 TRX | skip: "the account doesn't exist on Nile yet" |
| Stacks | testnet | `@stacks/connect` 8 `request()` through WBIP-004 `window.wbip_providers` | pass | pass (`verifyMessageSignatureRsv`) | **pass** [0xdcb787f4…d069](https://explorer.hiro.so/txid/0xdcb787f4291329664e5b5d8df9dac80770639b8df2a45394259153a435b2d069?chain=testnet) | pass: "Send 0.000001 STX to ST000…W42H" |
| Fuel | testnet | fuels-ts `Fuel` connectors list → Clip's FuelConnector | pass | pass (`Signer.recoverAddress(hashMessage(…))`) | skip: needs testnet ETH | skip: needs funds first |
| XRP Ledger | testnet | `@wallet-standard/app` with the `@xrpl-wallet-standard/app` feature filter (XLS-72d) | pass | n/a (XLS-72d has no message signing) | **pass** [601CC505…8E32](https://testnet.xrpl.org/transactions/601CC50503CD39B6783D609863C218159DC44EE1C7E34FB4DC51EA13BD8D8E32) (no-op AccountSet with a memo: rippled refuses a payment to yourself) | pass: "Change your account settings", memo shown |
| Chainflip (substrate) | Perseverance | `@polkadot/extension-dapp` + `@polkadot/api`, as lp.chainflip.io | pass (cF… address) | pass (`signatureVerify`) | skip: needs FLIP (no plain FLIP transfer; L3 is `liquidityProvider.registerLpAccount`) | pass: "Register as a Chainflip liquidity provider" |
| MultiversX | devnet | `@multiversx/sdk-dapp` 5.7.3 `initApp` + `ProviderFactory` (custom provider from the **undocumented** `window.multiversx.providers` hook) | pass | pass (sdk-dapp `verifyMessage`) | skip: needs devnet EGLD | skip: needs funds first |

No L1/L2 rows: Antelope, ICP (no wallet-side standard Clip can answer as itself), Bitcoin Cash (WalletConnect only;
needs a project id), Provenance, Initia (same Keplr-compatible provider as Osmosis, no separate page), THORChain (no
public testnet). Screenshots: `apps/extension/e2e/shots/matrix/{cosmos,tron,stacks,fuel,chainflip,multiversx}-sign.png`,
`stacks-approval.png`, `xrpl-approval.png`, `chainflip-approval.png`.

Fixes the run found: the XRPL page and chains-xrpl now use `testnet.xrpl-labs.com` first (rippled's own testnet host
answers no CORS preflight, so a page's fetch failed); the MultiversX page connects without native auth (with it,
`login()` asks for a second, sign-in approval inside L1).

## Which dapp each row uses, and why

Live public dapps come first in the brief. In practice:

- The **MetaMask test dapp** runs live (no account, no captcha). It proves EIP-6963 discovery and connect, but its
  actions are MetaMask-only.
- The official example dapps (Sui dapp-kit, Aptos wallet-adapter, Solana wallet-adapter, NEAR wallet-selector,
  use-wallet, get-starknet) are source repos, not hosted pages.
- The hosted ones need things the brief forbids, or a listing Clip doesn't have yet:
  - TON Connect's demo only shows wallets from the official wallets list.
  - polkadot.js apps is too large a UI to drive reliably.
  - Beacon's modal (below) doesn't work for an unlisted Chromium extension.

So every other row is that ecosystem's **official dapp library in a local page** (`apps/extension/e2e/matrix/dapps/`).
The page is served on `https://matrix-dapp.example` so 1Mask injects, and it talks to the real public testnet.

| Row | Discovery and dapp library |
| --- | --- |
| EVM | wagmi 3 + viem, EIP-6963 (mipd) |
| Hedera injected | wagmi + viem `hederaTestnet` (296, Hashio) |
| Hedera WalletConnect | `@hashgraph/hedera-wallet-connect` DAppConnector: extension discovery (`hedera-extension-query`), `connectExtension`, `hedera_signMessage` checked with its own `verifyMessageSignature`, TransferTransaction through the DAppSigner. Hedera refuses transfers to yourself, so it pays 1 tinybar to the matrix's EVM-path account. |
| Solana | `@solana/wallet-adapter` StandardWalletAdapter over the Wallet Standard |
| Bitcoin | Wallet Standard `bitcoin:*` + the sats-connect v4 `request` API (`getAccounts`, `signMessage` BIP-322, `sendTransfer`) |
| Sui | `@mysten/wallet-standard` with dapp-kit's filter (required `sui:signTransaction`, a `sui:` chain) + `@mysten/sui` Transaction |
| Aptos | `@aptos-labs/wallet-standard` `getAptosWallets` (AIP-62) + ts-sdk |
| Cardano | CIP-30 `window.cardano`. The tx is built with cborg from `getUtxos`. Koios sends no CORS headers, so the page uses a backend proxy the test serves, as production dapps do. `signData` is verified in Node with the Cardano Foundation's verifier, which needs Node streams. |
| Substrate | `@polkadot/extension-dapp` + `@polkadot/api` (`transferKeepAlive` with the extension's signer) |
| Starknet | get-starknet-core v4 + starknet.js (SNIP-12, STRK `transfer`) |
| TON | `@tonconnect/sdk` injected JS bridge (`isWalletInjected` + `connect({ jsBridgeKey })`), `signData`, `sendTransaction` |
| NEAR | Wallet Selector v10 + `@clip-wallet/kit-modules/near` |
| Stellar | Stellar Wallets Kit module API (`ClipWalletModule`) + stellar-base + Horizon |
| Tezos | Beacon `DAppClient`. Beacon's modal does list Clip (found by its postMessage ping), but in beacon-ui 4.8.0 clicking an unlisted Chromium extension does nothing: "Use Extension" is offered only for listed or Firefox ids. So the page answers `PAIR_INIT` itself and posts the same pairing message that button posts. Getting into Beacon's extension list (the listing draft exists) makes the stock modal work. |
| Algorand | `@txnlab/use-wallet` v5 + `@clip-wallet/kit-modules/algorand` + algosdk |

## Wallet bugs found and fixed

Each fix has a regression test. All of them pass, along with `pnpm -r typecheck`, `pnpm -r test`, `pnpm harness` and
the existing e2e (compat included).

1. **Hedera EVM dapps couldn't connect over EIP-1193.** Chain 296/295 wasn't in 1Mask's registry unless settle on
   Hedera was on, so wagmi's `hederaTestnet` (and the Scaffold-HBAR template's own home page) got "Clip Wallet only
   connects to the networks it ships with".
   - Fix: `dappRequestNetworks()` in `packages/engine/src/catalog.ts`, used by both wirings. Hedera's EVM is reachable
     whenever the wallet has Hedera, and is still never listed or scanned.
   - Tests: `packages/extension-kit/test/hedera-evm-dapps.test.ts`, `packages/engine/test/wiring.test.ts`.
2. **A funded account on Hedera EVM couldn't send.** The route planner checked the request against the portfolio, which
   never scans 296, so it saw a shortfall and blocked Approve with "We couldn't find a way to pay HBAR on Hedera".
   - Fix: `balancesForPlan()` (extension-kit service and engine) adds the request network's own balance, read with its
     chain module.
   - Test: `packages/engine/test/engine.test.ts`.
3. **The module's reason was thrown away when it couldn't decode a request.** An unfunded Bitcoin, Sui, Aptos or NEAR
   account showed only "Unreadable request … Signing something you can't read can empty your wallet".
   - Fix: `decodeFailureReason()` in `@clip-wallet/core`. The request stays blocked, and a ClipError's plain-words
     reason ("You don't have enough BTC…") is now shown.
   - Tests: `packages/extension-kit/test/decode-failure.test.ts`, `packages/engine/test/engine.test.ts`.
4. **Self-transfers decoded with no amount or recipient.**
   - Solana: "Approve a transaction" became "Send 0.000000001 SOL to G1zR…dxzk".
   - Sui: "Approve a transaction for <site>" became "Send 0.000000001 SUI to 0x6103…c5f9".
   - Cardano: "Approve a transaction" became "Move your ADA between your own addresses", with a line "To: Your own
     address: …".
   - Tests: `packages/chains-solana/test/solana.test.ts`, `packages/chains-sui/test/sui.test.ts`,
     `packages/chains-cardano/test/cardano.test.ts`.
5. **Misleading reasons for empty accounts.**
   - Aptos: an empty account's simulation (`MAX_GAS_UNITS_BELOW_MIN_TRANSACTION_GAS_UNITS`) said "needs more network
     fee than the app allowed". It now says "You don't have enough APT to pay the network fee."
   - NEAR: an unfunded implicit account (testnet answers `UNKNOWN_ACCESS_KEY`) said "isn't controlled by this wallet's
     key". It now says "doesn't exist on NEAR yet. Receive some NEAR first".
   - Sui: "Unable to perform gas selection due to insufficient SUI balance" said "couldn't run". It now says "You don't
     have enough SUI to pay the network fee."
   - Tests: in each chain package's test file.
6. **Hedera WalletConnect / HashConnect dapps couldn't find Clip.** `@hashgraph/hedera-wallet-connect`'s DAppConnector
   lists extension wallets by `hedera-extension-query` postMessage, and Clip didn't answer.
   - Fix: `packages/1mask/src/inpage/hedera.ts` answers the query. `hedera-extension-connect-<id>` hands the pairing
     code to the wallet's WalletConnect, as if pasted, and the proposal still needs approval. Router method
     `hedera:walletConnectPair`, host `pairWalletConnect`.
   - It is installed only in builds with a WalletConnect project id (`__CLIP_WALLETCONNECT__`).
   - Test: `packages/1mask/test/inpage-hedera.test.ts`. The e2e row runs once the project id is set.
7. **Approval rows overflowed.** A full address or hash ran over the row's label and off the card, so the recipient
   (e.g. Solana "To", Stellar "To") was unreadable.
   - Fix: `packages/ui/src/styles.css` (`overflow-wrap: anywhere`, label `flex-shrink: 0`).
   - Tests: `packages/ui/test/screens.test.tsx`. The matrix also fails any L4 whose rows overflow.
8. **A tiny balance change read "−0 ETH".** 1 wei showed as "−0 ETH" in the approval details while the title said
   "<0.000001".
   - Fix: `ChangeLine` in `packages/ui/src/screens/Approval.tsx`.
   - Test: `packages/ui/test/screens.test.tsx`.
9. **Addresses were inconsistent between the vault and the chain modules.**
   - Hedera: `addressFromPublicKey` returned the lowercase alias while the vault and UI show EIP-55. It now returns
     EIP-55 (`checksumAlias`), and mirror-node lookups keep the lowercase alias.
   - Cardano: the wallet already shows and uses the CIP-1852 base address (payment key + stake key `2/0`) for balances,
     CIP-30 and tx building. Coins at the same payment key's enterprise address are now included in balances and coin
     selection; change and every handed-out address stay the base address.
   - Tests: `packages/chains-hedera/test/hedera.test.ts`, `packages/chains-cardano/test/cardano.test.ts`. The balances
     script now compares case-insensitively and derives Cardano's base address through the module.

10. **Stellar balances intermittently showed "offline".** One dropped connection or a 5xx from Horizon made the
    balance read fail with `stellar/offline`. Horizon reads now retry twice with backoff (0.4 s, 1.2 s) before
    reporting offline; submits are never retried. Code: `packages/chains-stellar/src/horizon.ts`. Test:
    `packages/chains-stellar/test/stellar.test.ts`.

Test-suite finding: the existing compat suite's Sui scenario picked Clip's **Solana** wallet (same name, registered
first) and never tested Sui. It now filters as dapp-kit does, and its snapshot was re-recorded for that reason only
(see `docs/compat.md`).

## Open findings (not changed)

- **Hedera EVM balances aren't in the portfolio.** Injected dapps on 296 use the EVM key (`0x05AC…`, as MetaMask would),
  but the wallet's portfolio shows only the Hedera key's HBAR (`0xa3a5…`). HBAR a user receives on their EVM-path
  account is spendable from dapps but invisible on Home. Fixing it needs a product decision: one key for both, or show
  both.
- **Bitcoin decode wording.** A dapp's `sendTransfer` to your own address lists that output as "Change back to you".
- **Beacon listing.** Clip needs to be in Beacon's extension list (or Beacon UI needs a fix) for the stock pairing modal
  to work. The matrix pairs headlessly.
- **TON Connect listing.** The TON Connect demo and `@tonconnect/ui` show only listed wallets.
