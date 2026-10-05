# Clip Wallet: building the Firefox add-on from source (for AMO reviewers)

This archive is `git archive` of the exact commit the submitted add-on was built from. The add-on is bundled and
minified by Vite (through WXT), so AMO asks for the sources; nothing in the package is hand-edited.

## Requirements

- Linux, macOS or Windows (WSL). The release is built on Ubuntu 24.04 (GitHub Actions `ubuntu-24.04`) and checked
  in the `node:24-bookworm` container image.
- Node.js **24** (tested with 24.21.0): https://nodejs.org
- pnpm **12.6.0** (the version in `package.json` → `packageManager`): `npm install -g pnpm@12.6.0`
- About 3 GB of disk for `node_modules`. Network access for `pnpm install` only.

## Build

From the root of this archive:

```sh
pnpm install --frozen-lockfile --filter "@clip-wallet/extension..."
SOURCE_DATE_EPOCH=<the value from the release's BUILD-INFO, or the commit time> \
  pnpm --filter @clip-wallet/extension package --no-source
```

Or, to build just the Firefox package without zipping:

```sh
cd apps/extension
pnpm exec wxt build -b firefox --mv3
```

The unpacked add-on is `apps/extension/.output/firefox-mv3/`; the zip is
`apps/extension/release/clip-wallet-<version>-firefox.zip`. `apps/extension/release/TREE-DIGESTS` holds a SHA-256
digest of the unpacked tree, which you can compare with the one published on the GitHub release. The zip itself
is byte-identical when built with the same Node version on the same CPU architecture (DEFLATE output depends on
zlib); the tree digest is identical everywhere.

No environment variables are needed. Optional partner keys (`CLIP_0X_API_KEY`, `CLIP_BLOCKAID_API_KEY`, …) are
**not** set for the submitted build; with none set, those providers show as "not switched on" in the wallet.

## Where things are

| Path | What |
|---|---|
| `apps/extension/wxt.config.ts` | The manifest (permissions, CSP, Firefox settings) |
| `apps/extension/src/entrypoints/` | background, popup, full-tab page, approval window, content scripts |
| `packages/*/src` | The wallet: vault (keys, encryption), 1Mask (dapp connectors), chain modules, UI |
| `apps/extension/store/listing.md` | Permission justifications and data-use answers |
| `docs/legal/privacy-policy.md` | Privacy policy (draft) |

## Notes on linter warnings

`addons-linter` reports warnings, no errors, for the Firefox package. Each comes from a bundled dependency:

- `DANGEROUS_EVAL` (`Function("")`): zod 4's JIT capability probe, inside `try/catch`; under the extension CSP it
  is blocked and zod falls back to its interpreter.
- `DANGEROUS_EVAL` (`Function("binder", …)`, `%eval%`): the `function-bind` and `get-intrinsic` polyfills that
  some crypto libraries depend on. They are never called with user input.
- `UNSAFE_VAR_ASSIGNMENT` (`innerHTML`): React DOM's handler for `dangerouslySetInnerHTML`. Clip Wallet's own code
  never uses `dangerouslySetInnerHTML` or `innerHTML` (search `packages/` and `apps/`).

The background is an ES-module event page (`background.type = "module"`) so it shares chunks with the pages and
stays under the linter's 5 MB per-file parse limit.
