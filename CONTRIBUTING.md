# Contributing to Clip Wallet

Thank you for helping. Clip Wallet is MIT-licensed. Contributions are accepted under the same licence, with a
Developer Certificate of Origin sign-off and review before merge. Please read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Developer Certificate of Origin (DCO)

Every commit must be signed off. The sign-off certifies the [Developer Certificate of Origin 1.1](https://developercertificate.org/):
that you wrote the change or have the right to submit it under the project's licence.

```sh
git commit -s -m "fix(vault): ..."
```

This adds a trailer with your real name and e-mail:

```
Signed-off-by: Jane Doe <jane@example.org>
```

To sign off commits already on your branch: `git rebase --signoff main`. Pull requests with commits that aren't
signed off can't be merged. If a tool or assistant helped write a commit, keep your own `Signed-off-by` (you
certify the DCO) and add a `Co-Authored-By:` trailer for the tool if you like.

Maintainers also **sign** their commits and release tags (`git commit -S`, `git tag -s`, SSH or GPG key
registered on GitHub). The release workflow refuses an unsigned tag.

## Before you open a pull request

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm harness            # required (AGENTS.md)
pnpm --filter @clip-wallet/extension e2e               # if you touched the extension or a shared package
scripts/repro-check.sh                                 # if you touched the build (needs Docker)
actionlint                                             # if you touched .github/workflows
```

CI runs the same, plus the Firefox lint, the mobile app's tests, the services' tests in workerd, CodeQL and the
reproducible-build check.

## Rules that never break

From [AGENTS.md](AGENTS.md), enforced by `pnpm harness`:

1. Only `packages/vault` touches seed phrases or private keys.
2. Chain modules implement `ChainModule` and never import the vault.
3. Every dapp request becomes a `DecodedRequest` before approval; undecodable means blind signing, off by default.
4. Networks are invisible in the default UI.
5. Never log, print or commit key material, phrases, API keys or `.env` values. Tests use the public BIP-39 test
   vectors only, and never generate keys.
6. Testnet by default; mainnet needs an explicit build flag and the checklist.

Also:

- **User-facing text goes through the translation layer** in every shipped language (`packages/ui/src/i18n`,
  `apps/mobile/src/i18n`); the i18n tests fail otherwise. Arabic wraps interpolated values in bidi isolates.
- **Screens read theme tokens only.** No hard-coded colours or product name in `packages/ui/src/screens`.
- **Brand assets come from `brand/`.** Edit the SVG, run `node tools/brand/render.mjs`, commit the outputs.
- **If the wallet starts contacting something new**, update `docs/legal/privacy-policy.md`, the in-app
  disclosure (`privacy.*` strings) and `apps/extension/store/listing.md` in the same pull request.
- **Cite the spec.** When you implement a standard or a third-party API, link the current source in a comment.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, e.g. `fix(vault): ...`,
`feat(chains-sui): ...`, `test(e2e): ...`, `docs: ...`, `ci: ...`. One logical change per commit; each commit
builds on its own. User-visible changes get a line in [CHANGELOG.md](CHANGELOG.md) under "Unreleased".

## Reporting security issues

Never in a public issue. See [SECURITY.md](SECURITY.md).
