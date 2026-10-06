# Mainnet checklist

This wallet runs on **test networks only**. Real money needs every box below ticked by a person, and then the switch in
`clip.config.ts`:

```ts
import { MAINNET_ACKNOWLEDGEMENT, defineConfig } from "@clip-wallet/config";
// …
mainnet: { enabled: true, acknowledged: MAINNET_ACKNOWLEDGEMENT },
```

Three things enforce it, so it can't happen by accident:

- `pnpm harness` fails while mainnet is on and any box here is still `[ ]`;
- every build (`clipWallet()`, `clipDesktop()`, `expoConfig()` / `withClipWallet()` from the kit) refuses a mainnet
  config while any box here is open, or with a placeholder rdns, no homepage, no extension key, no WalletConnect project
  id or a remote icon;
- `pnpm wallet:mainnet-check` lists everything that is left (exit 0 only when nothing is).

Coding agents: never tick these boxes or turn mainnet on. Ask the owner.

## Identity
- [ ] `wallet.identity.json` has your own name, a reverse domain you own as `rdns`, your `homepage`, a description and the app id your stores know (`pnpm wallet:identity`).
- [ ] The icon is your artwork: `icon.svg` (or `icon.png`), and every platform's icons were rendered from it (`pnpm wallet:brand`).
- [ ] The extension's private key (`.keys/extension.pem`) is backed up offline, and the Chrome Web Store item uses the same key (its id matches `docs/listings/README.md`).

## Keys and services
- [ ] `CLIP_WALLETCONNECT_PROJECT_ID` is your own WalletConnect Cloud project, set in the release build's environment (CI secret), with your domains allow-listed.
- [ ] Hosted services in `clip.config.ts` (`services.backupUrl`, `services.mediaProxyUrl`, `services.clipHandles`) point at production deployments you run, or are unset.
- [ ] Blockaid, if you use it, is reached through a proxy that adds the key; no partner key that grants spending or account access is in the bundle.

## Code and supply chain
- [ ] The `@clip-wallet/*` packages are pinned to one release and `pnpm verify:provenance` passes for it.
- [ ] Every change you made on top of the kit has been reviewed by someone other than its author (the kit's own audits don't cover your edits).
- [ ] `pnpm harness`, `pnpm check-types` and `pnpm build` pass on the release commit, in CI.
- [ ] Every build you ship is signed by you (docs/signing.md): the store-signed extension, Developer ID + notarized macOS and code-signed Windows apps, and store-signed iOS / Android apps.

## People
- [ ] Your homepage says who runs the wallet, that it is non-custodial (the recovery phrase never leaves the device; nobody can recover it for the user), and how to get support.
- [ ] You have a security contact (`/.well-known/security.txt`) and can ship a fixed build within a day.
- [ ] The three usability tasks in `.harness/prd.md` passed with five people on testnet, with no wrong-network mistakes.
- [ ] Store listings have a privacy policy and terms that match what the wallet sends where (Settings → Security lists it).

When the last box is ticked: set `mainnet` as above, run `pnpm wallet:mainnet-check`, and only then build for the stores.
<!-- platform:nextjs -->
If the demo dapp should follow, add `chains.hedera` to `packages/nextjs/scaffold.config.ts`.
<!-- /platform:nextjs -->
