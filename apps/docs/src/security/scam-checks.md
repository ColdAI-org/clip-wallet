# Phishing and scam checks

These checks are part of the **security floor**: always on, in Clip Wallet and in every kit-built wallet. No setting,
build option or plugin switches them off, and a mainnet configuration that tries is refused.

| Check | When | Warning |
| --- | --- | --- |
| Open phishing lists (MetaMask, ScamSniffer, Phantom, PolkadotJS) | a site asks to connect; a request arrives; the desktop browser opens a page | `phishing-site` |
| WalletConnect Verify | a WalletConnect app connects or sends a request | `known-scam`, `domain-mismatch` |
| Known-scam addresses (ScamSniffer, PolkadotJS) | after decode | `malicious-transaction` |
| Look-alike recipients | a send to an address that resembles one you've used, but isn't | `address-poisoning` |
| Zero-value poisoning | transfers designed to plant a look-alike in your history | `address-poisoning` |
| New contracts | a call to a recently created contract (asks the network's Blockscout about the contract, never about you) | `new-recipient` (caution) |
| Unrecognised sites | any site not in the wallet's registry | `domain-mismatch` (caution) |
| Blockaid (optional) | sites and transactions, **only with a key** | `phishing-site`, `malicious-transaction` |

Matching against the lists runs **on the device**: the wallet downloads the list files (daily) and never sends the
sites you visit or your addresses to anyone. Blockaid is the exception, and it is off unless the wallet's builder sets
`CLIP_BLOCKAID_API_KEY`; Settings → Security then says that the site, the transaction and your address go to Blockaid.

## The floor

<<< @/snippets/security/security-floor.ts

`securityFloorProblems()` lists what a mainnet configuration may not do: switch the open lists off, filter them,
refresh them less than daily, or switch new-contract cautions off. `clipWallet()` refuses such a build, and in a
kit-built wallet `pnpm harness` fails if anything sets `openLists: false` or defines `__CLIP_SECURITY__`.

## App permissions and cleanup

Settings → Security also lists every standing permission (EVM token allowances, `setApprovalForAll`, Permit2; Solana
delegates; Hedera allowances), with flags for unlimited, unknown app, old, never used and on a scam list, and revokes
several in one approval. Spam cleanup closes empty Solana token accounts (the rent comes back), dissociates unused
Hedera tokens, and hides spam elsewhere.

## Adding a source

Any source implements `ThreatIntelProvider` and says exactly what leaves the device. See
[Add a scam-check source](../extend/threat-provider.md).
