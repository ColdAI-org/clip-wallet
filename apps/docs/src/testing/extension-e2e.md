# Extension end-to-end

The extension's Playwright suite lives in `apps/extension/e2e` and drives two builds: the **real** build (real vault,
real chain modules, real 1Mask) and the **fixture** build (`CLIP_MOCKS=1`: mock chains, route and dapps, and a dev
simulator, with no network).

```sh
pnpm --filter @clip-wallet/extension exec playwright install chromium   # once
pnpm --filter @clip-wallet/extension e2e                                 # builds both, runs the suite
```

| Spec | What it covers |
| --- | --- |
| `real.spec.ts` | onboarding, unlock and the real wiring |
| `fixtures-mode.spec.ts`, `phase2.spec.ts`, `phase25.spec.ts` | screens and flows on the fixture build: approvals, send with the network question, features, security |
| `compat.spec.ts` | real, unmodified dapp libraries against the built extension, compared with recorded snapshots ([Compatibility promise](../connect/compatibility.md)) |
| `calls.spec.ts` | `wallet_sendCalls` with auxiliary funds: the simulator, a Clip Connect page, and a declined batch on the real build |
| `settle.spec.ts` | settle on Hedera: the delivered and the late paths |
| `link.spec.ts` | linked devices on the fixture build |
| `plugins.spec.ts` | installing and running a Clip Plugin |
| `store.spec.ts` | the store screenshots (`pnpm --filter @clip-wallet/extension store:shots`) |

The [dapp and picker matrices](./matrices.md) are left out of the default run: they need public testnets and a funded
wallet.

## Unit tests of the background

The background is a library, so most of its logic is tested without a browser:

```sh
pnpm --filter @clip-wallet/extension-kit test
```

vitest aliases the virtual config module to `packages/extension-kit/test/clip.config.ts`. Change the background, run
these, then the end-to-end suite.
