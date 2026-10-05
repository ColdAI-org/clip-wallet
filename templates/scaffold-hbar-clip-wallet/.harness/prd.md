# Product requirements

Pre-release, test networks only. Each story names how it is accepted.

## Usability tasks (every release)

Run with five people who have used one other wallet. Success = done unaided, no wrong-network mistakes, the person can
say what they approved.

1. **Install and create.** Load the built extension, create a wallet, see the phrase once, confirm it, set a password.
   *Accept:* the wallet shows this project's name and icon everywhere, never "Clip Wallet".
2. **Connect the dapp.** Open the demo dapp, connect, sign the sign-in message. *Accept:* the approval names the site and
   shows the message; the page reports a valid signature.
3. **Send on Hedera testnet.** Send 0.1 HBAR to yourself from the dapp. *Accept:* the approval says what leaves and
   arrives and the fee in HBAR; the HashScan link shows the transaction.

## User stories

### Wallet maker
- I give the wallet its own identity with one command. *Accept:* `pnpm wallet:identity` writes name, rdns, extension
  key and listing drafts; `pnpm harness` passes.
- I rebrand by editing `clip.config.ts` and the icon. *Accept:* `pnpm harness` and `pnpm build` pass; bad values fail
  the build in plain words.
- I can't ship to mainnet by accident. *Accept:* with `mainnet` on and an open box in `MAINNET.md`, `pnpm harness` and
  `pnpm extension:build` both fail and say why.
- I know the kit I ship is the kit that was released. *Accept:* `pnpm verify:provenance` passes for the pinned version.
- I have drafts for every wallet registry my networks need. *Accept:* `docs/listings/` names my rdns, extension id and
  wallet key.

### User
- I connect any EVM, Solana, Bitcoin or Hedera dapp (and the other ten families) without the dapp knowing about this
  wallet in advance. *Accept:* the wallet appears in EIP-6963 / Wallet Standard pickers under its own name.
- Every request shows a decoded title, balance changes, fee and warnings; blind signing is off unless I turn it on.
- Phishing sites and look-alike addresses are flagged before I approve.

### Agent
- An agent can extend the dapp by following `AGENTS.md` and pass `pnpm harness && pnpm check-types && pnpm build`
  without touching identity, security or mainnet (`.harness/spec.yaml`).
