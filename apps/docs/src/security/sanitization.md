# Sanitising what you see

An approval screen is only as honest as its text. Much of that text comes from places a scammer controls: token names
and symbols, NFT names, memos, a dapp's name, a WalletConnect peer's metadata. Clip cleans and checks it before showing
it.

## Invisible and direction-changing characters

`displaySafe()` in `@clip-wallet/core` removes every Unicode format character (category Cf, such as U+202E RIGHT-TO-LEFT
OVERRIDE, zero-width spaces and the byte-order mark) and every control character except line breaks and tabs, plus the
line and paragraph separators. `sanitizeDecoded()` applies it to every human-readable string of a decoded request (the
title, every line, asset names and symbols in balance changes and the fee, every warning) after every check has run and
before anything is shown.

<<< @/snippets/arch/display-safe.ts

The same cleaning applies to site names, account labels (in the vault) and Solana and ENS names. Plugins can't output
these characters at all: the sandbox's schema rejects them.

## Decode what is signed, not what is claimed

- **EIP-712:** the description is built from the fields the type definition actually hashes, so an undeclared field
  can't change what the screen says.
- **Hedera transaction lists** must be the same transaction for every node, so a hidden second transfer can't ride along.
- **Bitcoin PSBTs from dapps:** the amounts and scripts of the person's own coins are checked against the network, not
  taken from the PSBT.
- **Unknown calls** (unrecognised typed data, app-specific Move calls, unrecognised Starknet entrypoints) carry an
  `unknown-call` caution: the wallet can name them but not promise every effect.
- **Look-alike tokens:** a non-curated token calling itself USDC, USDT or ETH is flagged in the decode and the
  simulation, not only in the portfolio.

## Who is asking

- The origin comes from the browser, never from the page.
- An app URL WalletConnect Verify didn't confirm is shown as "app.example (unverified)" and can't use a real site's
  permissions or pass a sign-in domain check.
- Sign-in messages (SIWE, Sign In With Solana, `ton_proof`) whose domain doesn't match the site get a warning.
- A site the wallet doesn't recognise gets a `domain-mismatch` caution: "Only continue if you opened it yourself."
- The wallet's own requests use the reserved origin `clip-wallet`, which no website can have.

## Media

NFT images and video never load from their own URLs: they go through the [media proxy](../services/media-proxy.md),
which sniffs the type, caps the size and serves SVG under a sandbox CSP, and the wallet renders them only in `<img>` and
`<video>`. Without a proxy, they are placeholders.
