# Changesets

Every change to a published package (`packages/*`: the `@clip-wallet/*` libraries, `@clip-wallet/extension-kit` and
`create-clip-wallet`) comes with a changeset: `pnpm changeset`, pick the packages, pick patch/minor/major, write one
plain sentence for the changelog.

All published packages move together (`fixed` in `config.json`), so a kit-built wallet pins one version of the kit.

Releasing happens only in CI (`.github/workflows/release.yml`), never from a laptop:

1. Merging to `main` opens or updates a "Version packages" pull request (`pnpm version-packages`: `changeset version`,
   then `tools/release/sync-template-versions.mjs` pins the new version in the Scaffold-HBAR template and
   create-clip-wallet's bundled copy).
2. Merging that pull request runs `pnpm release`: `pnpm pack-all` (build, manifest checks, tarball checks) and
   `changeset publish`, with npm provenance (`publishConfig.provenance` plus the workflow's `id-token: write`), so every
   tarball is signed by Sigstore and traceable to the commit and workflow that built it.

Check locally with `pnpm pack-all`: it builds and packs everything into `.packs/` and publishes nothing. The first
release publishes the current version (0.1.0) as it is; no changeset is needed for that.
