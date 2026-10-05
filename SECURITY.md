# Security policy

Clip Wallet holds keys. Please report vulnerabilities **privately**. Do not open a public issue, pull request or
discussion, and do not test against other people's wallets or funds.

## Reporting a vulnerability

- **GitHub private vulnerability reporting** on this repository: "Security" tab → "Report a vulnerability"
  (preferred).
- Or e-mail **security@REPLACE-WITH-COLDAI-DOMAIN** (placeholder: the maintainers set the real address and
  publish a PGP key before the first public release).

Please include the affected component, commit or release, the impact you expect, and a proof of concept (a
failing test is ideal). Use test networks and the public BIP-39 test vectors only; never send us a real recovery
phrase or private key.

We aim to acknowledge within 3 working days, give a first assessment within 10 working days, and agree a
disclosure date with you (90 days by default, sooner once a fix ships). We credit reporters who want credit.
[Bug bounty: none yet.]

## Scope

| In scope | Out of scope |
|---|---|
| `packages/vault` (derivation, encryption, signing, passkeys, backup format) | Third-party dependencies, unless Clip Wallet uses them unsafely (report upstream too) |
| `packages/1mask` (connectors, origin handling, router) and every `packages/chains-*` decoder | Networks, RPC providers, indexers, swap/buy providers and dapps themselves |
| Approval flow and request decoding (`packages/engine`, `packages/ui` approval screens) | Attacks needing a compromised OS, browser or device, or physical access to an unlocked device |
| `packages/security`, `packages/plugins` (sandbox escapes) | Social engineering of users or maintainers |
| `apps/extension` (manifest, CSP, background, content scripts) and `apps/mobile` | Denial of service by volume against the hosted services |
| `services/backup` and `services/media-proxy` | Findings on test networks that need mainnet to matter, unless the bug is in our code |
| Build, release and CI (`.github/`, `scripts/`, reproducibility, provenance) | Issues in the threat models' "not covered" lists, unless you show a worse impact |

Especially interesting: anything that leaks key material or a phrase, signs something other than what the user
approved, lets a page spoof its origin, bypasses blind-signing protection, escapes the plugin sandbox, or lets
the backup service decrypt a backup.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes (test networks only; no mainnet build is published) |

## How fixes ship

Fixes ship as a new signed tag and release (`.github/workflows/release.yml`) with SHA256SUMS and build
provenance, then a store update. Hosted-service fixes deploy to the Workers directly
(`docs/phase25/deploy.md`). We will publish an advisory once users have had time to update.
