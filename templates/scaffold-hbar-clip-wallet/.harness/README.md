# .harness

What a coding agent reads before changing this wallet, and what it must pass after.

| File | Purpose |
| --- | --- |
| `spec.md` | The product: what this wallet is, what is configurable and the rules no change may break |
| `prd.md` | User stories and the usability tasks a release is tested against |
| `spec.yaml` | A [hedera-harness](https://github.com/hedera-dev/hedera-harness) recipe: the agent adds a typed-data signing step to the dapp, then the validators below grade it |
| `validators/static.json` | Tier 0: files where AGENTS.md puts them; identity, security floor and testnet untouched; no secrets in the workspace |
| `validators/pnpm.json` | Tier 1: install, `pnpm harness`, types, both builds. No secrets, no network writes |
| `validators/playwright-smoke.yaml` | Tier 2: the built dapp serves `/` and `/debug` |
| `acceptance-contract.json` | Tier 3: what a reviewer checks in the running dapp |
| `../AGENTS.md` | Rules and recipes |
| `../tools/harness/check.mjs` | The mechanical rules (`pnpm harness`), Node built-ins only |

```bash
pnpm harness                                   # the rules, every commit
npx hedera-harness doctor .harness/spec.yaml   # prerequisites and every path the recipe references
npx hedera-harness validate .harness/spec.yaml # tiers 0-2 without an agent (fails until the recipe is done)
npx hedera-harness run .harness/spec.yaml      # agent, repairs, all tiers
```

## The checks in `pnpm harness`

1. **key-material-outside-vault**, **vault-import-not-allowed**, **logs-secret**, **phrase-literal**: no key handling,
   vault imports, secret logging or recovery phrases in this project.
2. **env-tracked**, **key-file-tracked**: no `.env` or private key file (`*.pem`, `.keys/`) tracked by git.
3. **kit-identity**: `wallet.identity.json` exists, holds no private key, and isn't Clip Wallet's identity; a warning
   while the template's placeholder identity is still there.
4. **kit-security**: `wxt.config.ts` builds through `clipWallet()`; nothing sets `openLists: false` or defines
   `__CLIP_SECURITY__`.
5. **kit-mainnet**: mainnet on in `clip.config.ts` means every box in `MAINNET.md` is ticked.
6. **kit-pinned**: kit packages are pinned to one exact version.

## When a check is wrong

Don't weaken a rule to get green. The harness is the kit's (`github.com/ColdAI-org/clip-wallet`,
`tools/harness/check.mjs`); propose the change there, with a fixture that shows why.
