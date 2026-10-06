---
layout: home
title: Clip Wallet Docs
titleTemplate: false

hero:
  name: Clip Wallet
  text: Developer docs
  tagline: Connect your dapp to Clip, launch your own wallet on the kit, and extend it with new networks, plugins and languages. Test networks only, for now.
  image:
    src: /brand/clip-mark.svg
    alt: The Clip Wallet mark
  actions:
    - theme: brand
      text: Connect your dapp
      link: /dapps/
    - theme: alt
      text: Launch your own wallet
      link: /kit/
    - theme: alt
      text: Run it locally
      link: /guide/quickstart

features:
  - title: Your dapp already works
    details: Clip answers each ecosystem's own wallet standard. wagmi, RainbowKit, the Solana and Sui adapters, CIP-30, Polkadot and the rest find it with no Clip code.
    link: /dapps/
    linkText: Per-ecosystem guides
  - title: Clip Connect
    details: One connect() for any wallet, accounts as CAIP-10, and pay() that lets the wallet bring money in from the user's other networks (EIP-5792 and ERC-7682).
    link: /connect/
    linkText: The SDK
  - title: A wallet of your own
    details: create-clip-wallet gives you a branded extension for 14 network families, with its own name, icon and extension id, and a Scaffold-HBAR dapp next to it.
    link: /kit/
    linkText: The kit
  - title: Extend it
    details: Add a network family with a ChainModule, write a sandboxed plugin, or add a language with the same QA checks the shipped ones pass.
    link: /extend/chain-module
    linkText: Extending Clip
  - title: Safe by construction
    details: Only the vault touches keys. Every request is decoded into plain words before approval, and the vault signs exactly what was approved, once.
    link: /security/
    linkText: Security model
  - title: Generated reference
    details: API reference for every published package, the clip.config.ts schema, and every error and warning code, built from the source.
    link: /reference/
    linkText: Reference
---

::: warning Pre-release
Clip Wallet runs on **test networks only**. It has had an internal security review and no external audit. Test tokens
have no value; don't use the wallet with real funds.
:::

## Pick your path

| You want to… | Start here |
| --- | --- |
| Make your dapp work with Clip Wallet | [Clip works with your dapp](./dapps/) |
| Use Clip's payment features from a dapp | [Clip Connect SDK](./connect/) |
| Ship a wallet under your own brand | [Launch your own wallet](./kit/) |
| Change Clip Wallet itself | [Run it locally](./guide/quickstart.md), then [Architecture](./architecture/) |
| Add a network, a plugin or a language | [Extending Clip](./extend/chain-module.md) |
| Review how it keeps keys and approvals safe | [Security model](./security/) |
