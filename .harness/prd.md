# Clip Wallet: product requirements

Pre-release, test networks only. Each story names how it is accepted.

## Usability tasks (every release)

Run with five people who have used one other wallet. Success = done unaided, no wrong-network mistakes,
the person can say what they paid.

1. **Buy an NFT on Solana holding only USDC on Base.** The marketplace asks for SOL. The wallet shows the
   shortfall ("You need 0.4 SOL more"), offers a route from the USDC balance with the fee in USDC, time and
   steps, and the user approves once per network that must sign. The NFT appears in Collectibles. Today the route
   step is Phase 3; Phase 1 must show the shortfall and say plainly that this route is not available yet.
2. **Stake HBAR.** From Home, the user opens HBAR, picks Stake, chooses a node (or the default) and confirms.
   The approval screen says "Stake 100 HBAR with node 0.0.3: rewards about every day, unstake any time".
   No account id, memo or fee jargon unless Advanced mode is on.
3. **Pay a Hedera dapp from an Ethereum balance.** The dapp asks for 25 HBAR; the user holds only ETH on
   Ethereum. The wallet shows the shortfall, a route quote (fee in ETH, about how long, how it is verified) and one
   approval on Ethereum (`Router.send`). Activity shows progress in plain words until the payment settles or is
   refunded after the deadline.

## User stories

### Onboarding and unlock
- As a new user I create a wallet, see my phrase once, confirm it, and set a password. *Accept:* the phrase is
  never shown again without the password; the vault's known-answer tests pass.
- As a returning user I unlock with a passkey. *Accept:* PRF-capable authenticators unlock; others fall back
  to the password with a plain explanation.
- As a user with a phrase from another wallet I import it and see the same addresses for every family that wallet supports.
- As a user with a hardware wallet I add Ledger or Keystone accounts and sign on the device.

### Balances and activity
- I see one balance per asset, merged across networks; bridged copies are listed separately.
- I see NFTs from every family; spam is hidden by default; media load through the media proxy or not at all.
- Activity reads like a statement: "Paid 25 HBAR to app.example", "Received 0.1 ETH".

### Sending and receiving
- I send by asset and amount; the network chip appears only when the address could be on several networks
  ("network matters").
- I receive by showing one QR per family with a plain label ("Ethereum and EVM apps").

### Dapps
- A dapp on any of the 14 families connects through 1Mask (its own wallet standard) or WalletConnect, with no
  Clip-specific code.
- Every request shows a decoded title, balance changes, fee and warnings; unlimited approvals and permits are
  called out; blind signing is off unless I turn it on.

### Route and fund
- When I don't hold enough where it's needed, I see what is missing and where I could pay from.
- I see quotes with fee, time, emissions, trust and steps, and pick one; I approve only normal transactions.
- I follow the route to the end, or get my money back after the deadline.

### Features
- I stake from the asset's page (Hedera, Solana, Cardano, Polkadot, NEAR, Tezos, Sui, Aptos, TON) and see rewards and
  how to unstake in plain words.
- I swap within a family and the approval shows what leaves, what arrives and the fee; without a partner key the swap
  says it isn't switched on.
- I trade an NFT or token peer-to-peer on Hedera (Secure Trade) and review the real transaction before I sign.

### Security
- I see every standing permission (EVM allowances, Solana delegates, Hedera allowances) and revoke several in one approval.
- Phishing sites, look-alike recipients and zero-value poisoning are flagged before I approve; Settings → Security says
  exactly what each source sees.
- I clean up spam tokens and get Solana rent back.

### Social
- I save contacts and send to a name (ENS, SNS, HNS, Clip handle); the address book is the first suggestion in Send.
- I claim a Clip handle on Hedera with one normal approval.
- I turn notifications on (the browser asks then, not at install) and see Discover for what I hold.

### Plugins
- In Advanced mode I install a Clip Plugin from npm, read its permissions in plain words, and see its notes on
  approvals labelled "From <plugin>, not checked by Clip Wallet". Turning Advanced mode off stops every plugin.

### Settle on Hedera
- When a payment needs money from another network and a settle deployment exists, the approval's Details list the best
  bonded-Connector quote (fee, deadline, cover); a missed deadline pays me from the bond.

### Wallet makers (the kit)
- I scaffold my own wallet with `npx create-clip-wallet my-wallet` or
  `npm create scaffold-hbar@latest -- --template ColdAI-org/scaffold-hbar-clip-wallet` (then `pnpm wallet:identity`).
  *Accept:* both give the same project; `pnpm install && pnpm build` and `pnpm harness` pass (`pnpm kit:e2e`,
  `pnpm kit:e2e:scaffold-hbar`).
- My wallet has its own name, icon, extension id, EIP-6963 rdns and WalletConnect project id. *Accept:* in Chromium the
  extension id is the one its key fixes and EIP-6963 announces my name and rdns, never Clip Wallet's.
- I get listing-submission drafts for my identity (TON Connect, NEAR, Stellar Wallets Kit, Beacon, use-wallet,
  WalletConnect Explorer, EIP-6963).
- I can't switch the security floor off. *Accept:* there is no setting; `openLists: false` fails `pnpm harness`; a
  mainnet config below the floor throws.
- I install signed, versioned kit packages. *Accept:* one exact version pinned (the harness checks), published with npm
  provenance by CI, `pnpm verify:provenance` passes.
- An agent can change my wallet by following `AGENTS.md`, with `.harness` validators and `llms.txt`.

### Safety
- Mainnet cannot be turned on by accident: it needs the checklist object in `clip.config.ts`; a kit-built wallet's build
  also refuses it until `mainnetProblems()` is empty and the harness until `MAINNET.md` is ticked.
- No key material is ever logged, sent or committed (`pnpm harness`).
