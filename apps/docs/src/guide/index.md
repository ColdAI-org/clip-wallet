# What Clip is

Clip Wallet is a non-custodial wallet for every CLPR network: one recovery phrase for fourteen network families,
one balance per asset, and plain words before anything is signed. It runs as a browser extension (Chrome, Edge,
Firefox), an iOS and Android app, and a desktop app.

It is also three things for developers:

- **A wallet your dapp already supports.** Clip answers each ecosystem's own wallet standard (EIP-1193 and EIP-6963,
  the Wallet Standard, CIP-30, `injectedWeb3`, TON Connect and more), so dapps find it with no Clip-specific code.
  See [Clip works with your dapp](../dapps/).
- **A dapp SDK, Clip Connect.** `@clip-wallet/connect` gives a dapp one `connect()` for any wallet and a `pay()` that
  lets a capable wallet bring money in from the user's other networks. See [Clip Connect](../connect/).
- **A kit.** The `@clip-wallet/*` packages, `@clip-wallet/extension-kit` and `create-clip-wallet` let anyone ship a
  wallet of their own on the same code, under their own name. See [Launch your own wallet](../kit/).

::: warning Pre-release: test networks only
Mainnet is off and gated behind a checklist. There has been no external audit. Test tokens have no value.
:::

## The ideas everything follows

**Networks are invisible.** The default screens speak in assets and apps ("Pay 25 USDC", "Swap on Uniswap"), never
"Base Sepolia". Balances of the same asset from the same issuer merge across networks. The network appears only where
a mistake would lose money. See [Networks are invisible](../architecture/networks-invisible.md).

**Only the vault touches keys.** `packages/vault` is the one place that derives keys and signs. Chain modules build and
decode; screens never import the vault. A mechanical check (`pnpm harness`) fails any change that breaks this. See
[Rules that never break](./rules.md).

**Every request is understood before it is approved.** Each dapp request becomes a `DecodedRequest`: a title, balance
changes, the fee and warnings, in plain words. A request the wallet can't read is "blind" and blocked by default. See
[The signing flow](../architecture/signing-flow.md).

**A security floor nobody can switch off.** Open phishing lists, look-alike and address-poisoning checks,
new-contract cautions and decode-before-approve are always on, in Clip Wallet and in every wallet built on the kit.
See [Phishing and scam checks](../security/scam-checks.md).

## Built on CLPR

Clip is built on [CLPR](https://github.com/LFDT-CLPR), the cross-ledger protocol from LF Decentralized Trust, and on
[CLPRouter](https://github.com/ColdAI-org/clprouter). When a dapp asks for money the user holds on another network,
the wallet finds the shortfall and offers a route to fund it. See [Route and settle](../architecture/route-settle.md).

## Where to go next

- New to the code: [Run it locally](./quickstart.md), then the [repository layout](./repo-layout.md).
- Building a dapp: [Clip works with your dapp](../dapps/).
- Building a wallet: [Launch your own wallet](../kit/).
- Unfamiliar words: the [glossary](./glossary.md).
