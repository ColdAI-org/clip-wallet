# Reference

Everything on these pages is generated from the source on every build, so it can't fall behind the code.

| Page | Generated from |
| --- | --- |
| [clip.config.ts schema](./config.md) | the zod schema in `@clip-wallet/config` |
| [Error codes](./errors.md) | `ERROR_CATEGORIES` and the message catalogue in `@clip-wallet/core`, and every `new ClipError(…, "code")` in the packages |
| [Warning codes](./warnings.md) | `WARNING_CODES` and the message catalogue in `@clip-wallet/core` |
| [Dapp-facing error codes](./dapp-errors.md) | `RpcErrorCode` and `CallsErrorCode` in `@clip-wallet/1mask` |
| [create-clip-wallet CLI](./cli.md) | the CLI's own `--help` |
| API reference (below) | TypeDoc over every published package's exports |

## API reference

One page per import path. The packages you are most likely to use:

| You are… | Packages |
| --- | --- |
| Building a dapp | [`@clip-wallet/connect`](./api/connect.md), [`/react`](./api/connect/react.md), [`/wagmi`](./api/connect/wagmi.md), [`/solana`](./api/connect/solana.md); [`@clip-wallet/kit-modules/near`](./api/kit-modules/near.md), [`/stellar`](./api/kit-modules/stellar.md), [`/algorand`](./api/kit-modules/algorand.md) |
| Configuring a wallet | [`@clip-wallet/config`](./api/config.md), [`@clip-wallet/extension-kit/wxt`](./api/extension-kit/wxt.md) |
| Writing a chain module | [`@clip-wallet/core`](./api/core.md), and any `chains-*` package as an example, such as [`@clip-wallet/chains-solana`](./api/chains-solana.md) |
| Writing a plugin | [`@clip-wallet/plugins`](./api/plugins.md) |
| Adding a language | [`@clip-wallet/i18n`](./api/i18n.md), [`/qa`](./api/i18n/qa.md) |
| Running a host | [`@clip-wallet/engine`](./api/engine.md), [`@clip-wallet/vault`](./api/vault.md) |

The full list is in the sidebar. The vendored CLPRouter planner's internal types (inside `@clip-wallet/route`) are
documented upstream in the [CLPRouter SDK](https://github.com/ColdAI-org/clprouter) and left out here.
