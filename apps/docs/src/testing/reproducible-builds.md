# Reproducible builds

Anyone can check that a Clip Wallet store package was built from the public source: two clean builds of one commit
produce byte-identical extension zips.

```sh
scripts/repro-check.sh            # HEAD
scripts/repro-check.sh v0.1.0     # any commit or tag
```

It builds the store packages twice, each time in a fresh container from a clean clone of the commit, and fails unless
both runs produce identical zips. The two runs differ on purpose in everything a build should not depend on:
container, hostname, time zone, locale and umask. It needs Docker, git and Node, and network access for the
`pnpm install` inside each container.

## What makes it reproducible

- **Pinned toolchain:** the container image is pinned by digest (Node 24), and pnpm is the version `package.json` pins.
- **`SOURCE_DATE_EPOCH`** is the commit time; every timestamp in the zips comes from it.
- **Deterministic zips:** fixed file order, timestamps and permissions.
- **No randomness in the build:** the inpage message channel is derived from the version and `SOURCE_DATE_EPOCH`.

## Across machines

zlib's compressed output can differ between CPU architectures, so the zips are compared byte for byte only on the same
architecture. `TREE-DIGESTS` (written next to the zips) is a digest of each unpacked build's content, and compares
across architectures.

## Releases

A signed version tag builds the store packages in the same pinned container, writes `SHA256SUMS`, and attests SLSA build
provenance for every file (verifiable with `gh attestation verify`). The npm packages are published by CI with npm
provenance: see [Changesets and releases](../contributing/releases.md).
