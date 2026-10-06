# Phase 2 brief (read before you start)

Clip Wallet: non-custodial wallet for every CLPR network. Pre-release, TESTNETS ONLY, no funds needed for tests.
Plan: the "Clip Wallet" tab of the CLPR plan doc. Phase 2 = every open-standard family + mobile + hardware + HashPack-parity features.

## Rules (from AGENTS.md, enforced by `pnpm harness`)
- Only packages/vault touches phrases/private keys/signing. Tests outside the vault NEVER generate keys or sign: precompute signatures offline (outside the repo) and commit only public keys + signatures as fixtures (see packages/chains-evm/test/signatures.ts).
- Chain modules implement `ChainModule` from @clip-wallet/core exactly, never import the vault; prepare() returns SignablePayloads, finalize() assembles.
- Networks are invisible: plain-language titles ("Send 10 SUI to 0x12…ab", "Stake 50 DOT"), fees as asset amounts, errors via ClipError(userMessage, code). Show a network only where a mistake loses money (Warning "network-matters").
- Never print/log/commit secrets or .env values. Don't read `.env` files or key files.
- Verify standards, ids and package names from current sources (docs, npm, repos) — not memory — and cite them in your package README.

## Contract
- packages/core/src/index.ts already lists all 14 families, curves (secp256k1, ed25519, bip32-ed25519, sr25519, stark) and schemes (… sr25519, stark-ecdsa). Additive changes only, explained in your report.
- The vault derives keys/addresses for the new families in the vault-v2 stream; until merged, write your module against `Account` (publicKey + address) and use fixture accounts.

## Integration (avoid merge conflicts)
- Create NEW files/packages only. Do NOT edit apps/extension/src/background/wiring.ts, apps/extension/src/shared/catalog.ts, packages/1mask/src/inpage/index.ts, packages/1mask/src/background/methods.ts or router.ts — instead add your connector as new files and write `docs/phase2/integration/<your-stream>.md` with the exact lines to add to those files (the integration step applies them).
- Exceptions are listed in your own task.

## Git
- Work only in your worktree/branch. Commits are SSH-signed by repo config; end messages with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push; there is no remote.
- Before reporting: `pnpm install`, your packages' typecheck + tests green, `pnpm harness` green.
- Report: files, verified sources, test counts, integration doc path, gaps.
