#!/usr/bin/env bash
# Checks a freshly scaffolded project: files, no secrets, install, identity, the harness, types (every platform), the
# builds (extension, desktop, dapp), the dapp serving / and /debug, the extension manifest carrying the new identity,
# and the mainnet gate. With a second
# argument (a project made by create-clip-wallet with the same answers) it also checks both trees are the same.
set -euo pipefail
APP="$(cd "$1" && pwd)"
CLI="${2:-}"
cd "$APP"

step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

step "Required files"
for f in README.md AGENTS.md CLAUDE.md llms.txt LICENCE package.json pnpm-workspace.yaml .harness/spec.yaml \
         clip.config.ts wallet.identity.json MAINNET.md docs/signing.md packages/extension/wxt.config.ts \
         packages/desktop/electron.vite.config.ts packages/mobile/app.config.ts \
         packages/nextjs/app/debug/page.tsx tools/harness/check.mjs; do
  [ -f "$f" ] || fail "missing $f"
done
[ ! -e template.json ] || fail "template.json should have been consumed by the CLI"

step "No committed secrets"
if git ls-files | grep -E '(^|/)\.env(\.[^/]*)?$|\.pem$|(^|/)\.keys/' | grep -v '\.env\.example$'; then fail "secret-looking file is tracked"; fi

step "Install and identity"
pnpm install
pnpm wallet:identity --name "Fresh Scaffold" --rdns com.example.freshscaffold --yes
node -e 'const i=require("./wallet.identity.json"); if(i.name!=="Fresh Scaffold"||!i.extension?.key) process.exit(1)' || fail "identity not written"
[ -f .keys/extension.pem ] || fail "no extension key"
git check-ignore -q .keys/extension.pem || fail "the extension key isn't gitignored"

step "Harness, types, builds"
pnpm harness
pnpm check-types
pnpm build

step "The extension carries the new identity"
node -e '
const m = require("./packages/extension/.output/chrome-mv3/manifest.json");
const id = require("./wallet.identity.json");
if (m.name !== id.name) throw new Error("manifest name " + m.name);
if (m.key !== id.extension.key) throw new Error("manifest key differs from wallet.identity.json");
console.log("manifest ok:", m.name);'

step "Mainnet is gated"
cfg=clip.config.ts
cp "$cfg" "$cfg.orig"
# sed -i.bak works with both GNU and BSD sed.
sed -i.bak -e 's/^  mainnet: false,$/  mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },/' \
  -e 's/^import { defineConfig } from "@clip-wallet\/config";$/import { MAINNET_ACKNOWLEDGEMENT, defineConfig } from "@clip-wallet\/config";/' "$cfg"
grep -q 'mainnet: { enabled: true' "$cfg" || fail "couldn't switch mainnet on for the check"
if pnpm harness >/dev/null 2>&1; then fail "the harness accepted mainnet with an open checklist"; fi
if pnpm extension:build >/dev/null 2>&1; then fail "the build accepted mainnet with a placeholder identity"; fi
mv "$cfg.orig" "$cfg"
rm -f "$cfg.bak"

step "Dapp boots"
pnpm next:serve > serve.log 2>&1 &
trap 'kill %1 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://localhost:3000 && break; sleep 2; done
for route in / /debug; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000$route")
  echo "$route -> $code"
  [ "$code" = 200 ] || fail "$route returned $code"
done

if [ -n "$CLI" ]; then
  step "create-clip-wallet made the same project"
  # Excluded: what install/build/serve create, and the two files that carry each wallet's own random extension key.
  diff -rq -x .git -x node_modules -x .keys -x .output -x .wxt -x .next -x out -x .expo -x serve.log -x '*.tsbuildinfo' -x next-env.d.ts \
    -x pnpm-lock.yaml -x wallet.identity.json -x listings "$CLI" "$APP" || fail "the two projects differ (beyond the per-wallet key)"
fi
echo "Fresh scaffold OK"
