# Changesets

Every change to a published package (`packages/*`: the `@coldai/clip-wallet-*` libraries, `@coldai/clip-wallet-extension-kit` and
`create-clip-wallet`) comes with a changeset: `pnpm changeset`, pick the packages, pick patch/minor/major, write one
plain sentence for the changelog.

All published packages move together (`fixed` in `config.json`), so a kit-built wallet pins one version of the kit.

Releasing happens only in CI (`.github/workflows/release.yml`), never from a laptop:

1. Merging to `main` opens or updates a "Version packages" pull request (`pnpm version-packages`: `changeset version`,
   then `tools/release/sync-template.mjs` pins the new version in the Scaffold-HBAR template and
   create-clip-wallet's bundled copy).
2. After that pull request is merged, a signed version tag (`git tag -s vX.Y.Z`, the same tag that builds the
   extension's store packages) runs `pnpm release`: `pnpm pack-all` (build, manifest checks, tarball checks), then
   `tools/release/publish.mjs`. For each tarball whose version isn't on npm it runs
   `npm publish <tarball> --provenance --access public` (the workflow's `id-token: write` lets npm sign the provenance
   with Sigstore), so every tarball is traceable to the commit and workflow that built it; versions already on npm are
   skipped. It then checks every version's SLSA provenance attestation on npm (this repository, a workflow in
   `.github/workflows/`, the digest of the tarball npm serves) and fails if one is missing or doesn't match. The
   workflow refuses an unsigned tag and a tree with pending changesets.

The npm CLI publishes, not `changeset publish`: that calls `pnpm publish`, which turns provenance on only from its own
`--provenance` flag.

Check locally with `pnpm pack-all`: it builds and packs everything into `.packs/` and publishes nothing. After it,
`node tools/release/publish.mjs --dry-run` lists what a release would publish and checks the attestations of the
versions already on npm; it publishes nothing either.
