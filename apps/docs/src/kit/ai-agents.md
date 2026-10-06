# Work with AI agents

Clip Wallet and every kit-built wallet are set up for coding agents (Claude Code, Codex, Cursor and others) as much as
for people: the rules are written down, the map is machine-readable, and the important rules are enforced by checks an
agent must pass.

| File | What it gives an agent |
| --- | --- |
| [`AGENTS.md`](repo:AGENTS.md) | The rules that never break, the commands that must pass, and recipes: rebrand, add a network, add a token list, change routing, add a screen, change the background, write a chain module, release |
| [`llms.txt`](repo:llms.txt) | A compact map: the commands, the rules, the core contract and every package, with links to these docs |
| [`.harness/`](repo:.harness/README.md) | `spec.md` (the product), `prd.md` (user stories and the usability tasks), and how the checks work |
| `pnpm harness` | The rules as checks, with `file:line` and a plain sentence for each failure |

A kit-built wallet gets its own `AGENTS.md`, `llms.txt`, `.harness/` and `tools/harness/check.mjs`, written for a
wallet project (identity, look, networks, features, the dapp) rather than for the kit.

## A good loop

1. Point the agent at `AGENTS.md` and `llms.txt` before it changes anything.
2. Ask for one recipe at a time ("add Base Sepolia", "change the accent to …").
3. Require the commands to pass after every change:

```sh
pnpm install && pnpm typecheck && pnpm test && pnpm harness     # in this repo
pnpm install && pnpm harness && pnpm check-types && pnpm build  # in a kit-built wallet
```

4. Review the diff yourself. The harness catches the dangerous mistakes (keys outside the vault, logged secrets,
   committed `.env` files, a lowered security floor, a stolen identity, mainnet switched on with open boxes), not every
   mistake.

## Things an agent must never do

- Handle key material outside the vault, generate keys in tests, or print a phrase or a key.
- Tick a box in `MAINNET.md` or switch mainnet on. That is the owner's decision.
- Weaken a harness rule to get a green run. If a rule is wrong, it changes in a separate, explained commit a person
  reviews.
- Publish packages by hand. Releases happen in CI only.

## Pointing agents at these docs

`llms.txt` links the pages here that agents need most: the [clip.config.ts schema](../reference/config.md), the
[error](../reference/errors.md) and [warning](../reference/warnings.md) codes, [Write a chain module](../extend/chain-module.md)
and the generated [API reference](../reference/). Every page's source is plain Markdown in `apps/docs/src`.
