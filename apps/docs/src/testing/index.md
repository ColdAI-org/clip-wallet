# Testing

Every change must pass the same three commands CI runs first:

```sh
pnpm typecheck && pnpm test && pnpm harness
```

| Layer | Command | What it covers |
| --- | --- | --- |
| Types | `pnpm typecheck` | every workspace package with strict TypeScript |
| Unit | `pnpm test` | vitest in each package; services in workerd; the phone app with vitest and jest-expo |
| Rules | `pnpm harness` | [the rules that never break](../guide/rules.md), manifests and the template sync |
| Extension end to end | `pnpm --filter @clip-wallet/extension e2e` | Playwright against the real and the fixture builds, including the compat suite: [Extension end-to-end](./extension-e2e.md) |
| Testnet matrices | `pnpm --filter @clip-wallet/extension matrix`, `… pickers` | real dapp libraries and pickers on public testnets: [Dapp and picker matrices](./matrices.md) |
| The kit | `pnpm pack-all && pnpm kit:e2e` | a kit-built wallet and the Scaffold-HBAR template, from packed tarballs |
| Reproducibility | `scripts/repro-check.sh` | two clean container builds produce byte-identical zips: [Reproducible builds](./reproducible-builds.md) |

## One package at a time

```sh
pnpm --filter @clip-wallet/vault test
pnpm --filter @clip-wallet/chains-solana test
pnpm --filter @clip-wallet/1mask test
```

## Rules for tests

- **No real keys, ever.** Tests use the public BIP-39 test vectors only; signatures in fixtures are precomputed offline
  from the public "abandon … about" account. Only `packages/vault/test` may contain a phrase literal, and no test
  outside the vault may use key APIs; `pnpm harness` checks both.
- **No network in unit tests.** Fetch is faked with fixtures; services run against local D1, R2 and Durable Objects.
- **Regression tests fail on the old code.** A fix lands with a test that fails without it.

## In CI

CI runs the packages' typecheck and tests, the harness and `pnpm pack-all`; the extension's typecheck, end-to-end tests,
store packaging and Firefox lint; the phone app's tests; the services' tests in workerd; the kit end-to-end checks;
CodeQL; and the reproducible-build check.
