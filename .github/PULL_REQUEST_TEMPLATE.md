## What and why

<!-- One logical change. Link the issue it closes, if any. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`, [DCO](../CONTRIBUTING.md#developer-certificate-of-origin-dco))
- [ ] `pnpm typecheck && pnpm test && pnpm harness` pass
- [ ] Extension or a shared package touched: `pnpm --filter @clip-wallet/extension e2e` passes
- [ ] `packages/*` changed: a changeset (`pnpm changeset`)
- [ ] User-facing text goes through i18n in every shipped language
- [ ] The wallet contacts something new: privacy policy, in-app disclosure and store listing updated
- [ ] No key material, recovery phrases, API keys or `.env` values anywhere (tests use the public BIP-39 vectors only)
- [ ] Third-party code added: its licence kept next to it and listed in `NOTICE`

<!-- Security fixes: don't open a PR. Report privately first (SECURITY.md). -->
