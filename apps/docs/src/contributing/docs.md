# Working on these docs

This site is a [VitePress](https://vitepress.dev) app in `apps/docs`. Pages are Markdown in `apps/docs/src`; every
code sample is a real file in `apps/docs/src/snippets` that is typechecked against the workspace packages.

```sh
pnpm --filter docs dev       # http://localhost:5173/clip/docs/, with hot reload
pnpm --filter docs build     # generate, build, then check links and safety
pnpm --filter docs test      # typecheck and run the snippets, check the pages and the package READMEs
```

## Where it is served

The site is built for a base path, `/clip/docs/` by default, so it can live at `coldai.org/clip/docs`. Everything is
configurable at build time:

| Variable | Default | |
| --- | --- | --- |
| `DOCS_BASE` | `/clip/docs/` | the URL path the site is served under; `/` for a site of its own |
| `DOCS_SITE_URL` | none | the origin, such as `https://coldai.org`, for the sitemap |
| `DOCS_REPO_URL` | `https://github.com/ColdAI-org/clip-wallet` | where "view source" and edit links point |
| `DOCS_REPO_BRANCH` | `main` | the branch those links use |

```sh
DOCS_BASE=/ DOCS_SITE_URL=https://docs.example.org pnpm --filter docs build
```

The output in `apps/docs/.vitepress/dist` is static files: copy it under the base path on any static host. Links end in
`.html`, so no server rewrites are needed.

## Code samples

Never paste TypeScript into a page. Put it in `src/snippets/<section>/<name>.ts` and include it:

```md
<<< @/snippets/connect/pay.ts
<<< @/snippets/extend/example-module.ts#decode
```

The second form includes a `// #region decode` … `// #endregion decode` part of the file. `pnpm --filter docs test`
fails if a page has inline TypeScript or JavaScript, an include points at a missing file or region, a snippet isn't
used anywhere, a snippet has a type error, a runnable snippet prints something other than what its comments say, or a
`pnpm --filter` command names a script that doesn't exist. Package READMEs' code blocks are typechecked the same way.

## What's generated

`scripts/generate.mjs` runs before every build:

- the **API reference** (`src/reference/api`): TypeDoc over every published package's exports;
- the **config schema**, **error codes**, **warning codes** and **dapp-facing error codes** pages, from the source;
- the **CLI reference**, from `create-clip-wallet --help`;
- the **test reports**, copied from `docs/r1`;
- the brand assets, copied from `brand/`.

Don't edit generated pages; change the source and rebuild. They are not committed.

## Links

Link to other pages with relative `.md` links. Link to files in the repository with `repo:`, such as
`[the vault README](repo:packages/vault/README.md)`; the build fails if the path doesn't exist. After the build,
`scripts/check-site.mjs` checks every internal link and anchor in the output, checks that repository links point at
real files, and scans for anything that must never be published (local paths, secrets, recovery phrases).
`pnpm --filter docs check:external` also requests every external link.

## Style

Plain, friendly sentences; short paragraphs; headings that say what the reader will do. Say "the person" or "you",
not "the user", in prose about people. Use British spelling to match the product. Prefer a table to a long list of
facts, and a diagram (Mermaid) to a long explanation of a flow.
