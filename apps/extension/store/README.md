# Store packages

Everything needed to submit the **testnet** extension to the Chrome Web Store, Microsoft Edge Add-ons and
addons.mozilla.org. Nothing here submits anything.

| What | Where | Made by |
|---|---|---|
| Chrome / Edge zip, Firefox zip, AMO source zip, `SHA256SUMS`, `TREE-DIGESTS`, `BUILD-INFO` | `apps/extension/release/` (gitignored) | `pnpm --filter @clip-wallet/extension package` |
| Listing copy, permission justifications, data-use answers, reviewer notes | [`listing.md`](listing.md) | by hand |
| Five 1280x800 screenshots | [`screenshots/`](screenshots) | `pnpm --filter @clip-wallet/extension store:shots` (e2e fixture flows at 2x) |
| Store icon, promo tiles, Edge logo | [`assets/`](assets) | `node tools/brand/render.mjs` (from `brand/*.svg`) |
| AMO source-code README (goes at the root of the source zip) | [`README-AMO.md`](README-AMO.md) | by hand |

## Check before uploading

```sh
pnpm --filter @clip-wallet/extension package          # testnet build only; refuses anything else
npx web-ext@8 lint -s apps/extension/.output/firefox-mv3   # 0 errors expected; warnings explained in README-AMO.md
scripts/repro-check.sh                                 # two clean container builds, identical zips
```

Which file goes where:

| Store | Upload |
|---|---|
| Chrome Web Store | `clip-wallet-<v>-chrome.zip` |
| Microsoft Edge Add-ons | `clip-wallet-<v>-chrome.zip` (the same MV3 package) |
| addons.mozilla.org | `clip-wallet-<v>-firefox.zip`, and `clip-wallet-<v>-source.zip` when asked for sources |

Releases built by `.github/workflows/release.yml` carry the same files plus a SLSA build-provenance attestation;
prefer those over a local build for a real submission.
