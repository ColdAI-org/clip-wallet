# @clip-wallet/chains-solana

Solana `ChainModule` for Clip Wallet. Builds, decodes and simulates. It never touches keys: `prepare()` returns
the message bytes for the vault to sign (ed25519), and `finalize()` puts the signatures in place and sends.

Built on `@solana/kit` 8 plus the `@solana-program/*` clients (system, token, compute-budget). Kit is the
maintained SDK, and the Wallet Standard features only exchange raw bytes, so there's no dependency on
`@solana/web3.js`. Token instructions are identified with `@solana-program/token` (the kit-native successor of
`@solana/spl-token`). Token-2022 shares the base instruction layouts.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/chains-solana @clip-wallet/core
```

## Example

```ts
import type { ChainModule } from "@clip-wallet/core";
import { createSolanaModule, SOLANA_DEVNET } from "@clip-wallet/chains-solana";

// A wallet's background holds one module per family; it never gives the module a key.
const module: ChainModule = createSolanaModule();
console.log(module.family, module.derivationPath(0)); // "solana" "m/44'/501'/0'/0'"

const network = SOLANA_DEVNET;
console.log(network.id, network.testnet); // a CAIP-2 id, true

// The flow: decode() → the person approves → prepare() → the vault signs → finalize().
```

## Documentation

- [Chain modules](https://coldai.org/clip/docs/architecture/chain-modules.html)
- [Write a chain module](https://coldai.org/clip/docs/extend/chain-module.html)
- [The Solana guide for dapps](https://coldai.org/clip/docs/dapps/solana.html)
- [API reference](https://coldai.org/clip/docs/reference/api/chains-solana.html)

## Networks

| cluster | NetworkId (CAIP-2, WalletConnect) | Wallet Standard chain |
|---|---|---|
| devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | `solana:devnet` |
| testnet | `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z` | `solana:testnet` |
| mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `solana:mainnet` |

CAIP-2 ids are the first 32 characters of each genesis hash, checked with `getGenesisHash` against the public RPCs.
Wallet Standard ids come from `@solana/wallet-standard-chains`. Mapping: `toWalletStandardChain`, `fromChainId`
(accepts either form). Asset keys: SOL = `sol`; Circle USDC (`EPjF…Dt1v` mainnet, `4zMM…ncDU` devnet) = `usdc`;
other tokens `spl:<mint>`.

## Requests

1Mask sends Wallet Standard features when injected, and WalletConnect methods as they are:

| method | params | result |
|---|---|---|
| `solana:signTransaction` | `{ inputs: [{ account, transaction (b64), chain, options }] }` | `[{ signedTransaction (b64) }]` |
| `solana:signAndSendTransaction` | same | `[{ signature (b64 bytes) }]` |
| `solana:signMessage` | `{ inputs: [{ account, message (b64) }] }` | `[{ signedMessage, signature }]` (b64) |
| `solana:signIn` | `{ inputs: [SolanaSignInInput] }` | `[{ account: { address, publicKey (hex) }, signedMessage, signature, signatureType }]` |
| `solana_signTransaction` | `{ transaction (b64) }` | `{ signature (bs58), transaction (b64) }` |
| `solana_signAndSendTransaction` | `{ transaction, sendOptions? }` | `{ signature (bs58) }` |
| `solana_signAllTransactions` | `{ transactions: b64[] }` | `{ transactions: b64[] }` |
| `solana_signMessage` | `{ message (bs58), pubkey }` | `{ signature (bs58) }` |

The input `account` / `pubkey` must be this account, and the input `chain` must be this network. Otherwise the
request is refused.

### decode()

- Legacy and v0 transactions. Address lookup tables are fetched and resolved. If they can't be, the request is
  blind but still simulated.
- Described: System transfers / create account; SPL and Token-2022 transfer, transferChecked, approve(Checked)
  (`unlimited-approval`: danger at u64::MAX or ≥ supply, caution otherwise), revoke, close, burn, sync-native;
  associated-token-account create ("Also opens a USDC account for the recipient (≈0.002 SOL)"); compute budget
  (fee); memo. SetAuthority, system Assign/Allocate on your account, and any unknown program are listed by
  program id and make the request **blind**.
- **Swaps** (`src/swaps.ts`) are described, not blind: Jupiter v6 (`route`, `routeWithTokenLedger`,
  `sharedAccountsRoute(WithTokenLedger)`, `exactOutRoute`, `sharedAccountsExactOutRoute`), Raydium AMM v4
  (`SwapBaseIn/Out` and V2), Raydium CPMM (`swap_base_input/output`), Raydium CLMM (`swap`, `swap_v2`) and Orca
  Whirlpool (`swap`, `swap_v2`), mainnet and devnet program ids. Title: "Swap 2.5 USDC for at least 0.01 SOL on
  Jupiter" from the instruction (exact in + minimum out, or maximum in + exact out; Jupiter's slippage is shown),
  replaced by the simulated amounts ("Swap 2.5 USDC for 0.0102 SOL on Jupiter") when simulation runs. The swap
  must be paid by this account (else blind); if the output token account belongs to someone else → danger
  `new-recipient`; if its owner can't be confirmed → caution. SOL sent into your own wSOL account is shown as
  "Wraps". Layout sources are cited at the top of `src/swaps.ts` (Jupiter IDL from jup-ag/instruction-parser and
  jupiter-cpi; raydium-amm `instruction.rs`; raydium-cp-swap / raydium-clmm `lib.rs`; orca-so/whirlpools `lib.rs`);
  Anchor discriminators are re-derived from `sha256("global:<name>")` in the tests.
- **Jupiter Swap API v2** transactions (`api.jup.ag/swap/v2/order`): `route_v2`, `exact_out_route_v2`,
  `shared_accounts_route_v2`, `shared_accounts_exact_out_route_v2` plus Jupiter's helper instructions
  `create_idempotent_associated_token_account` and `close_wsol_token_account`, from the program's on-chain Anchor
  IDL (account `C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa`). Minimum output = quoted × (1 − slippage).
- **Native staking** (`src/stake.ts`, `@solana-program/stake` 0.10): System `CreateAccountWithSeed` owned by the
  Stake program, `Initialize`, `DelegateStake`, `Deactivate`, `Withdraw`, with or without the legacy sysvar /
  stake-config accounts. "Stake 2 SOL with validator Abcd…wxyz" (rent deposit of a 200-byte stake account,
  2 282 880 lamports, shown separately), "Stop staking", "Withdraw 2 SOL from staking". Stake or withdraw
  authority handed to someone else, or a withdraw to someone else → danger; lockup → caution; other stake
  instructions (Split, Merge, Authorize…) or a stake account you don't control → blind.
- First instruction `AdvanceNonceAccount` → `durable-nonce` danger ("never expires").
- `simulateTransaction` (`sigVerify: false`, `replaceRecentBlockhash` unless durable-nonce,
  `accounts: { addresses: [me] }`). Balance changes come from pre/post balances and token balances, with the fee
  taken out of the SOL change because it's shown separately. Simulation errors become a plain `simulation-failed`
  warning. Fee = 5000 lamports × signatures + CU price × CU limit, or the simulator's fee when it has one.
- `signMessage`: text is shown. Bytes that decode fully as a transaction or as a bare transaction message are
  refused ("a transaction in disguise"). Non-text bytes are shown as hex and marked blind.
- `signIn` (SIWS): shows domain, statement, URI, expiry and resources. If the domain isn't the requesting origin's
  host → `domain-mismatch` danger. The signed text matches `createSignInMessageText` from
  `@solana/wallet-standard-util` byte for byte.

### prepare() / finalize()

One `ed25519` payload per transaction this account must sign (its message bytes), per message, or per SIWS text.
`finalize` checks each signature with `ed25519.verify` before using it, writes it into this account's slot and
re-encodes. For send methods it calls `sendTransaction` with `skipPreflight: false` and
`preflightCommitment: "confirmed"`. RPC errors come back as plain `ClipError`s.

## Balances and NFTs

- SOL via `getBalance`. Tokens via `getTokenAccountsByOwner` (jsonParsed) for **both** the SPL Token and
  Token-2022 programs, summed per mint. (`getParsedTokenAccountsByOwner` is the web3.js client name. The RPC
  method is `getTokenAccountsByOwner`.)
- Symbol/name: the Token-2022 `tokenMetadata` extension, otherwise the Metaplex metadata PDA
  (`["metadata", program, mint]`).
- NFTs: decimals 0, balance 1, mint supply 1, plus Metaplex metadata (verified collection, off-chain JSON).
  `mediaUrl` is untrusted: only https/ipfs/ar URLs are kept. Render through the sandboxed media proxy.
- Compressed NFTs: `createSolanaModule({ dasUrl })` (one URL, or one per network id) calls DAS `getAssetsByOwner`
  and adds the compressed assets.

## buildTransfer

SOL (system transfer) or SPL / Token-2022 (`transferChecked` from your largest token account of that mint). If the
recipient's associated token account doesn't exist, an idempotent create is added first. A token-account address as
recipient is refused. Uses the latest blockhash. The result is a `solana:signAndSendTransaction` DappRequest.

## Tests

`pnpm test`: fixtures are built with kit inside the tests, and the RPC is mocked per method. Signatures are fixtures
computed once offline (`test/signatures.ts`), because tests may only verify. `LIVE=1 pnpm test` adds read-only
devnet checks (balances, and a simulation of an unfunded payer).

## Gaps

- v1 transactions (kit 8 can decode them): the durable-nonce check only looks at legacy/v0 instructions.
- Program descriptions: System / Token / ATA / Compute Budget / Memo and the swap programs above. Whirlpool two-hop
  swaps, Raydium's router, Meteora, Phoenix and liquidity instructions are still blind (simulation still shows
  what moves). Jupiter has no devnet deployment, so its decoding is only exercised by fixtures.
- Token-2022 extensions (transfer fees, hooks, permanent delegate) aren't flagged yet.
- `solana:signAndSendAllTransactions` and `solana:signOffchainMessage` aren't handled (1Mask doesn't expose them).

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

Apache-2.0: see [LICENSE](./LICENSE) and [NOTICE](./NOTICE). "Clip Wallet" and "1Mask" are ColdAI trademarks (not licensed).
