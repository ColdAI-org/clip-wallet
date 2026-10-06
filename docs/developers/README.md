# Developer docs

The developer documentation for Clip Wallet is a [VitePress](https://vitepress.dev) site in
[`apps/docs`](../../apps/docs). It is published at <https://coldai.org/clip/docs/>.

```sh
pnpm --filter docs dev       # http://localhost:5173/clip/docs/
pnpm --filter docs build     # static site in apps/docs/.vitepress/dist, then link and safety checks
pnpm --filter docs test      # every code sample typechecks; the runnable ones run
```

- Pages are Markdown in [`apps/docs/src`](../../apps/docs/src). Start with
  [`guide/index.md`](../../apps/docs/src/guide/index.md).
- Code samples are real files in [`apps/docs/src/snippets`](../../apps/docs/src/snippets), typechecked against the
  workspace packages.
- The API reference, the `clip.config.ts` schema, and the error and warning code references are generated from the
  source on every build (`apps/docs/scripts/generate.mjs`).
- How to work on the docs: [`contributing/docs.md`](../../apps/docs/src/contributing/docs.md).
