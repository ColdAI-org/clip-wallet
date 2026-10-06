# Rules that never break

A handful of rules keep Clip Wallet safe. They are written down in [`AGENTS.md`](repo:AGENTS.md), and most of them are
checked mechanically by `pnpm harness` ([`tools/harness/check.mjs`](repo:tools/harness/check.mjs)), which every change,
human or AI, must pass.

## The rules

1. **Only `packages/vault` touches recovery phrases and private keys.** No other package may import key libraries
   (`@scure/bip39`, `@scure/bip32`, private-key or signing APIs of `@noble/curves`, `viem/accounts`, ethers wallets,
   the Hedera SDK's `PrivateKey`, Solana's `Keypair`, Argon2…). Verification and public-key maths are fine anywhere.
2. **Chain modules never import the vault.** Each `packages/chains-*` implements `ChainModule`, returns
   `SignablePayload`s from `prepare()` and gets signatures back. It may not even list the vault as a dependency.
3. **Every dapp request becomes a `DecodedRequest` before approval.** A request the wallet can't decode is *blind*,
   and blind signing is off by default.
4. **Networks are invisible in the default UI.** Speak in assets and apps; show the network only where a mistake
   loses money. See [Networks are invisible](../architecture/networks-invisible.md).
5. **Never log, print or commit key material, phrases, API keys, `.env` values or key files** (`*.pem`, `.keys/`).
   Tests use the public BIP-39 test vectors only.
6. **Testnet by default.** Mainnet needs the checklist object in `clip.config.ts`, and a mainnet build needs everything
   `mainnetProblems()` asks for.
7. **The security floor is not configurable.** Open phishing lists, decode-before-approve, new-contract and
   look-alike checks are always on. `@clip-wallet/security` refuses a mainnet config below the floor.
8. **Kit-built wallets announce their own identity.** Nothing in the kit may hard-code "Clip Wallet" or Clip's rdns
   where the wallet's own name belongs.
9. **Packages are released by CI only**, with changesets and npm provenance. Never publish by hand.

## Who may import the vault

Type-only imports (`import type { ClipVault } from "@clip-wallet/vault"`) are fine anywhere. Code imports are allowed
only in:

- `packages/vault` itself;
- the extension background: `packages/extension-kit/src/background/` and `apps/extension/**/background*`;
- the phone app's background (`packages/mobile-kit/src/background/`) and the desktop host
  (`packages/desktop-kit/src/main/host/`);
- the onboarding screen (`packages/ui/src/screens/Onboarding.tsx`, or an `onboarding/` folder).

Screens talk to the background through messages (`packages/ui/src/client.ts`), never to the vault.

## What `pnpm harness` checks

`pnpm harness` runs the checks below, its own unit tests, the published-manifest checks and the template sync check.
Each failure names a file and line and says what to do in a plain sentence.

| Check | Fails when |
| --- | --- |
| `key-material-outside-vault` | a file outside `packages/vault` imports a key library or uses a private-key API |
| `vault-import-not-allowed` | `@clip-wallet/vault` is imported (not type-only) outside the places above |
| `chain-module-imports-vault` | a chain module imports or depends on the vault, tests included |
| `logs-secret` | `console.*` prints something named like a phrase, mnemonic, seed, private key or secret |
| `phrase-literal` | a string that is a BIP-39 phrase appears outside `packages/vault/test` |
| `env-tracked`, `key-file-tracked` | git tracks a `.env` file (`.env.example` is fine), a `*.pem` or a `.keys/` folder |
| `vault-kat-missing` | the vault's tests lose the public "abandon … about" known-answer vector |

In a [kit-built wallet](../kit/) the same file also checks the wallet's own identity, that the build goes through
`clipWallet()` with the phishing lists on, that mainnet stays off while `MAINNET.md` has an open box, and that kit
packages are pinned to one exact version.

## When a check is wrong

Don't weaken a rule to get a green run. If a rule blocks something legitimate, change
[`tools/harness/check.mjs`](repo:tools/harness/check.mjs) and its fixtures in a separate commit that says why, so a
person reviews the exception. The details are in [`.harness/README.md`](repo:.harness/README.md).
