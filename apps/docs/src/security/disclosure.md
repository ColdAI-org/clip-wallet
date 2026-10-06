# Report a vulnerability

Please report vulnerabilities **privately**. Don't open a public issue, pull request or discussion, and don't test
against other people's wallets or funds.

- **Preferred:** GitHub private vulnerability reporting on the repository: the **Security** tab, then **Report a
  vulnerability**.
- Or e-mail [shayan@coldai.org](mailto:shayan@coldai.org). To encrypt your report, ask for the current key in a first,
  detail-free message.
- The full policy is in [`SECURITY.md`](repo:SECURITY.md).

Include the affected component, the commit or release, the impact you expect, and a proof of concept; a failing test
is ideal. Use test networks and the public BIP-39 test vectors only: never send a real recovery phrase or private key.

## What happens next

- Acknowledgement within 3 working days, a first assessment within 10.
- A disclosure date agreed with you: 90 days by default, sooner once a fix ships.
- Credit if you want it. (There is no bug bounty yet.)
- Fixes ship as a new signed tag and release with SHA256SUMS and build provenance; hosted-service fixes deploy to the
  Workers directly; an advisory follows once people have had time to update.

## Especially interesting

Anything that leaks key material or a phrase; signs something other than what the person approved; lets a page spoof
its origin; bypasses blind-signing protection; escapes the plugin sandbox; or lets the backup service decrypt a backup.

## In scope

The vault; 1Mask and every chain module's decoder; the approval flow and request decoding; the security and plugin
packages; the extension, phone and desktop apps; the backup and media-proxy services; and build, release and CI.
Third-party dependencies are in scope where Clip uses them unsafely. Networks, RPC providers, swap providers and dapps
themselves are not.
