#!/usr/bin/env bash
# Reproducible-build check: builds the store packages twice, each time in a fresh container from a clean clone
# of one commit, and fails unless both runs produce byte-identical extension zips.
#
#   scripts/repro-check.sh            # HEAD
#   scripts/repro-check.sh v0.1.0     # any commit-ish
#
# The two runs differ on purpose in everything a build should not depend on: container, hostname, time zone,
# locale and umask. Same CPU architecture and image (pinned by digest) for both, so zlib's DEFLATE output is
# comparable byte for byte; TREE-DIGESTS (unpacked content) is printed too for cross-architecture comparison.
# Needs: docker, git, node. Network: the pnpm install inside each container.
set -euo pipefail

REF="${1:-HEAD}"
# node:24-bookworm (multi-arch index), Node 24.21.0. Keep in step with .github/workflows/*.yml.
IMAGE="${REPRO_IMAGE:-node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4}"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
COMMIT="$(git rev-parse --verify "$REF^{commit}")"
EPOCH="$(git log -1 --format=%ct "$COMMIT")"
# Under the repo, not $TMPDIR: Docker Desktop / colima only share the home directory with the VM on macOS.
mkdir -p "$ROOT/.repro"
WORK="$(mktemp -d "$ROOT/.repro/run.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

git update-ref refs/repro-check/src "$COMMIT"
git bundle create "$WORK/src.bundle" refs/repro-check/src >/dev/null 2>&1
git update-ref -d refs/repro-check/src
echo "repro-check: commit $COMMIT, SOURCE_DATE_EPOCH=$EPOCH, image $IMAGE"

run() {
  local n="$1" tz="$2" lang="$3" mask="$4"
  mkdir -p "$WORK/out$n"
  docker run --rm --network=bridge \
    --hostname "repro-$n-$RANDOM" \
    -e TZ="$tz" -e LANG="$lang" -e LC_ALL="$lang" \
    -e SOURCE_DATE_EPOCH="$EPOCH" -e CI=1 \
    -v "$WORK/src.bundle:/in/src.bundle:ro" -v "$WORK/out$n:/out" \
    "$IMAGE" bash -euo pipefail -c "
      umask $mask
      git config --global advice.detachedHead false
      git clone -q /in/src.bundle /work && cd /work && git checkout -q $COMMIT
      npm install -g --silent pnpm@$PNPM_VERSION >/dev/null
      pnpm install --frozen-lockfile --reporter=silent --filter \"@clip-wallet/extension...\"
      pnpm --filter @clip-wallet/extension package >/out/package.log 2>&1 || { tail -50 /out/package.log; exit 1; }
      cp apps/extension/release/SHA256SUMS apps/extension/release/TREE-DIGESTS /out/
    "
  echo "run $n ($tz, $lang, umask $mask):"
  sed 's/^/  /' "$WORK/out$n/SHA256SUMS"
}

run 1 UTC C.UTF-8 022
run 2 Asia/Tokyo en_US.UTF-8 077

if diff -u "$WORK/out1/SHA256SUMS" "$WORK/out2/SHA256SUMS" && diff -u "$WORK/out1/TREE-DIGESTS" "$WORK/out2/TREE-DIGESTS"; then
  echo "repro-check: OK, both runs produced identical packages"
  cat "$WORK/out1/TREE-DIGESTS"
  [ -n "${REPRO_OUT:-}" ] && cp "$WORK/out1/SHA256SUMS" "$WORK/out1/TREE-DIGESTS" "$REPRO_OUT"/
  exit 0
fi
echo "repro-check: FAILED, the two builds differ (see the diff above)" >&2
exit 1
