# .harness

What a coding agent reads before changing Clip Wallet, and what it must pass after.

| File | Purpose |
| --- | --- |
| `spec.md` | The product: what Clip Wallet is and the rules no change may break |
| `prd.md` | User stories and the three usability tasks every release is tested against |
| `../AGENTS.md` | Rules and recipes (rebrand, networks, tokens, routing, screens, chain modules) |
| `../llms.txt` | Map of packages, the core contract and commands |
| `../tools/harness/check.mjs` | The mechanical checks (`pnpm harness`) |

## The checks

`pnpm harness` (`node tools/harness/check.mjs`, Node built-ins only) fails with `file:line` and a plain sentence when:

1. **key-material-outside-vault**: a file outside `packages/vault` imports `@scure/bip39`, `@scure/bip32`,
   `ed25519-hd-key`, `micro-key-producer`, or uses private-key/signing APIs (`sign`, `getPublicKey`,
   `getSharedSecret`, `keygen`, `randomSecretKey`/`randomPrivateKey`) of `@noble/curves` secp256k1/ed25519,
   argon2 from `hash-wasm`, `viem/accounts` key accounts, `ethers` wallets, Hedera SDK `PrivateKey`/`Mnemonic` or
   Solana `Keypair`. Verification and public-key maths (`verify`, `Point`) are fine anywhere.
2. **vault-import-not-allowed**: `@clip-wallet/vault` is imported outside the vault, the extension background
   (`apps/extension/**/background*`) and the onboarding screen (`packages/ui/src/screens/Onboarding.tsx` or an
   `onboarding/` folder in the UI or extension). Type-only imports are fine.
3. **chain-module-imports-vault**: a ChainModule package (`packages/chains-*`, or any package that implements
   `ChainModule`) imports `@clip-wallet/vault` anywhere, tests included, or lists it in `package.json`.
4. **logs-secret**: `console.*` prints an identifier named like phrase, mnemonic, seed, privateKey or secret.
5. **phrase-literal**: a string that is a BIP-39 phrase appears outside `packages/vault/test`.
6. **env-tracked**: git tracks a `.env` or `.env.*` file (`.env.example` is fine).
7. **vault-kat-missing**: `packages/vault` has no test containing the public "abandon ×11 about" vector
   (a warning, not a failure, when `packages/vault` is absent).

The checks are lexical: comments are ignored, strings are understood, imports are matched with their bindings.
Tests: `node --test tools/harness/test/*.test.mjs` (fixture trees in `tools/harness/test/fixtures`, which the
real run skips).

## When a check is wrong

Don't weaken a rule to get green. If a rule blocks something legitimate, change `tools/harness/check.mjs`
and its fixtures in a separate commit that says why, so a human reviews the exception.
