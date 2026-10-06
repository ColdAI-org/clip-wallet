# How to contribute

Thank you for helping. Contributions are welcome: code, docs, translations, test reports and security reviews. Please
read the [Code of Conduct](repo:CODE_OF_CONDUCT.md) first. For security issues, don't open an issue: see
[Report a vulnerability](../security/disclosure.md).

## Before you open a pull request

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm test && pnpm harness            # always
pnpm --filter @clip-wallet/extension e2e               # if you touched the extension or a shared package
pnpm pack-all && pnpm kit:e2e                          # if you touched packaging, create-clip-wallet or templates/
scripts/repro-check.sh                                 # if you touched the build (needs Docker)
actionlint                                             # if you touched .github/workflows
```

And `pnpm changeset` for any change to a published package (see [Changesets and releases](./releases.md)).

## Sign off every commit (DCO)

Every commit must be signed off. The sign-off certifies the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): that you wrote the change, or have the right
to submit it under the project's licence.

```sh
git commit -s -m "fix(vault): refuse a sub-path the vault never handed out"
```

That adds a trailer with your name and email:

```text
Signed-off-by: Jane Doe <jane@example.org>
```

To sign off commits already on your branch: `git rebase --signoff main`. Pull requests with commits that aren't signed
off can't be merged. If a tool or an assistant helped write a commit, keep your own `Signed-off-by` (you certify the
DCO) and add a `Co-Authored-By:` trailer for the tool if you like.

Maintainers also **sign** their commits and release tags cryptographically (`git commit -S`, `git tag -s`, with an SSH or
GPG key registered on GitHub). The release workflow refuses an unsigned tag.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`.

```text
fix(vault): …
feat(chains-sui): …
test(e2e): …
docs: …
ci: …
```

One logical change per commit, and each commit builds on its own. User-visible changes get a line in
[`CHANGELOG.md`](repo:CHANGELOG.md) under "Unreleased".

## House rules

- **The rules that never break** ([Rules](../guide/rules.md)): keys only in the vault, decode before approval,
  networks invisible, nothing secret logged or committed, testnet by default.
- **Every user-facing string goes through the translation layer**, in every shipped language; the i18n tests fail
  otherwise. Right-to-left languages wrap interpolated values in isolates. See [Add a language](../extend/languages.md).
- **Screens read theme tokens only**: no hard-coded colours or product name in `packages/ui/src/screens`.
- **Brand assets come from `brand/`.** Edit the SVG, run `node tools/brand/render.mjs`, commit the outputs.
- **If the wallet starts contacting something new**, update the privacy policy draft, the in-app disclosure
  (`privacy.*` strings) and the store listing in the same pull request.
- **Cite the spec.** When you implement a standard or a third-party API, link the current source in a comment.
- **Don't weaken a harness rule to get green.** Change it in a separate, explained commit.

## Working with agents

Coding agents are welcome contributors too; they follow [`AGENTS.md`](repo:AGENTS.md) and must pass the same checks.
See [Work with AI agents](../kit/ai-agents.md).
