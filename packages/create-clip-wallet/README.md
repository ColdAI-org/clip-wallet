# create-clip-wallet (EXPERIMENTAL)

> **Experimental.** The `@clip-wallet/*` packages this template depends on are pre-release and not published yet.
> Expect breaking changes. Generated wallets run on **test networks only** unless you complete the mainnet checklist.

```sh
npx create-clip-wallet my-wallet
# or, without prompts
npx create-clip-wallet my-wallet --name "My Wallet" --accent "#4F46E5" --networks "evm:*,hedera" --yes
```

It copies `templates/extension` into `my-wallet/`, asks for a name, an accent colour and the networks
(`evm:*`, `evm:<chain id>`, `hedera`, `solana`, `bitcoin`), validates the answers with `@clip-wallet/config`,
writes `clip.config.ts`, copies the harness to `tools/harness/check.mjs`, and prints the next steps:

1. `pnpm install`
2. `cp .env.example .env` and set `CLIP_WALLETCONNECT_PROJECT_ID` (never commit `.env`)
3. set `rdns` in `clip.config.ts` to a reverse domain you own
4. `pnpm harness` (must pass before every commit)

Mainnet stays off until `clip.config.ts` has `mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT }`.

The harness is bundled at `prepack` from the monorepo's `tools/harness/check.mjs` (`scripts/copy-harness.mjs`).
