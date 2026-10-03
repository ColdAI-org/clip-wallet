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
- As a user with a phrase from another wallet I import it and see the same EVM, Solana and Bitcoin addresses.

### Balances and activity
- I see one balance per asset, merged across networks; bridged copies are listed separately.
- I see NFTs from every family; spam is hidden by default.
- Activity reads like a statement: "Paid 25 HBAR to app.example", "Received 0.1 ETH".

### Sending and receiving
- I send by asset and amount; the network chip appears only when the address could be on several networks
  ("network matters").
- I receive by showing one QR per family with a plain label ("Ethereum and EVM apps").

### Dapps
- Any EVM, Solana, Bitcoin or Hedera dapp connects through 1Mask or WalletConnect.
- Every request shows a decoded title, balance changes, fee and warnings; unlimited approvals and permits are
  called out; blind signing is off unless I turn it on.

### Route and fund
- When I don't hold enough where it's needed, I see what is missing and where I could pay from.
- I see quotes with fee, time, emissions, trust and steps, and pick one; I approve only normal transactions.
- I follow the route to the end, or get my money back after the deadline.

### Wallet makers
- As a wallet maker I rebrand by editing `clip.config.ts` and `pnpm harness` stays green.
- As a wallet maker I scaffold a wallet with `npx create-clip-wallet my-wallet` (experimental).

### Safety
- Mainnet cannot be turned on by accident: it needs the checklist object in `clip.config.ts`.
- No key material is ever logged, sent or committed (`pnpm harness`).
