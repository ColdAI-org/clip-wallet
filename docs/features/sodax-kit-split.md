# Kit wallets and the SODAX fee: a split contract (design)

**Design only.** No contract, no factory and no wallet code for this exists yet. It describes how wallets built from
the kit (`npx create-clip-wallet`, or the Scaffold-HBAR template in `templates/scaffold-hbar-clip-wallet`) get SODAX
swaps, and how a split contract's predicted address would take the place of the single reviewed receiver in the
wallet's check. Points the owner has to decide are marked **Decision**. How the fee works today:
[sodax-swaps.md](sodax-swaps.md).

## What kit wallets get today

- **The same swap.** A kit wallet's extension is `clipWallet()` from `@coldai/clip-wallet-extension-kit`
  (`templates/scaffold-hbar-clip-wallet/packages/extension/wxt.config.ts`), so `sodaxFor()` reads the same two build
  settings, `CLIP_SODAX_SERVER_URL` and `CLIP_SODAX_FEE_RECEIVER`, in a mainnet build. Nothing in the template has to
  change for that. The desktop and phone apps pass no swap partner settings yet, for kit wallets or for Clip Wallet.
- **The same fee, to ColdAI.** The receiver must be on the reviewed list inside `@coldai/clip-wallet-features`
  (`src/swap/sodax-fee-receivers.json`), which a kit project can't change without forking the package. So a kit
  wallet can only pay ColdAI LLC's reviewed address. Its review says "Clip fee" and "Fee goes to: ColdAI LLC, 0x…"
  (`CLIP_FEE.name` and `receivedBy` belong to the fee, not to the wallet), and its operator receives nothing.
- **Its own name in refusals.** "… so My Wallet stopped it. Nothing was signed." comes from `config.name`.
- **The same gate.** A mainnet build with only one setting, or with a receiver that isn't reviewed, is refused. The
  template's `MAINNET.md` has no SODAX items yet (see [Checklist](#checklist)).

## Why a split contract

A SODAX swap can name one fee receiver:

- The SDK puts one fee entry in an intent's data (`composeIntentData`, @sodax/sdk 2.2.0 `dist/index.mjs:25114-25123`)
  and reads back only the first (`extractFeePayload` uses `.find`, `:25148-25167`). Two receivers, ColdAI and the
  wallet's operator, can't both be in the swap.
- SODAX pays the fee on Sonic, to "the EVM hub fee receiver" (@sodax/types 2.2.0
  `dist/backend/backendApiV2.d.ts:10-22`), in the sold token's asset on Sonic.

So the one receiver has to be a contract on Sonic that divides what it receives.

A fee split on the ExClip server (`feeSplit`) is no substitute: the swap the wallet builds carries the Clip fee alone,
and the wallet refuses a server that charges a fee of its own, plain or split
([sodax-swaps.md](sodax-swaps.md#who-sees-what)).

## The contract

A small, immutable splitter on Sonic:

- **Two payees and their shares, fixed when it is created:** ColdAI LLC's reviewed address and the operator's payout
  address. No owner, no admin, no upgrade, no way to change the terms.
- **Pull payments.** Anyone can call `release(token)`, which sends each payee its share of the contract's balance of
  that token (SODAX's assets on Sonic are ERC-20 tokens). Payees bring their share back to another network through
  SODAX from their own accounts. The splitter never swaps or bridges.
- **Deployed with CREATE2 by one factory**, with the terms in the salt, for example
  `salt = keccak256(abi.encode(coldai, payout, coldaiShare, payoutShare, version))`. Its address is then a pure
  function of the factory, the contract's init code hash and the terms:
  `keccak256(0xff ‖ factory ‖ salt ‖ initCodeHash)[12:]`.
- **It doesn't have to exist yet.** Tokens can be sent to the predicted address before anything is deployed there.
  Anyone can deploy it later through the factory, with the same terms, and release what has built up.

**Decision:** who writes, audits and deploys the factory, and whether an existing audited splitter can be used on
Sonic instead.

## How the predicted address replaces the single receiver

Today the check's first rule is "the receiver is on the reviewed list" (`isReviewedFeeReceiver` in
`checkSodaxSwap`, `packages/features/src/swap/sodax-intent.ts`). With splits:

1. **The reviewed file gains the split's constants**, not each wallet's address: the factory's address on Sonic, the
   splitter's init code hash, the version, and ColdAI's payee address. Changing them takes a reviewed commit and an
   update to the pinning test, as the receiver list does today.
2. **The kit wallet declares its terms**: its payout address and its share or fee. **Decision:** in `clip.config.ts`
   (public and reviewed in the operator's repository, like the wallet's identity; this document leans this way) or as
   build settings (like `CLIP_SODAX_FEE_RECEIVER` today).
3. **The wallet works out the address itself**, from the reviewed constants and the declared terms (viem's
   `getContractAddress({ opcode: "CREATE2", from: factory, salt, bytecodeHash })`): at build time in `sodaxFor()` and
   `sodaxProblems()`, which refuse a mainnet build with malformed terms, and at run time in the SODAX provider.
4. **The check accepts that address and the reviewed list, nothing else.** A kit wallet with a split doesn't set
   `CLIP_SODAX_FEE_RECEIVER`: its receiver is derived, never typed in, so no environment can point the fee at an
   arbitrary address. Different terms give a different address, and the review shows the terms.
5. **The rest of the check doesn't change**: the fee cap, byte-for-byte against the plan, refused before signing,
   the fee lines kept on the review.

The fee cap depends on the deal. **Decision:**

- **Share of the Clip fee.** The fee stays 0.875 % of the amount sold and the splitter divides it. The cap stays
  0.875 %. The review shows "Clip fee 0.875% · 0.875 USDC" and "Fee goes to: ColdAI LLC and My Wallet, through
  0x…".
- **The operator's fee on top.** The swap carries 0.875 % plus the operator's declared fee, in one fee entry to the
  splitter. The cap becomes 0.875 % plus that declared fee, itself capped by the kit (1 %, say). The quote and the
  review show two lines, "Clip fee 0.875% · …" and "My Wallet fee 0.25% · …", and one "Fees go to" line naming the
  splitter.

Either way, the fee is exact in the amount form, rounded down, and disclosed wherever a person decides, as now.

## Checklist

Items the template's `MAINNET.md` would gain when this is built (not added now: nothing checks them yet):

- [ ] SODAX swaps, if the wallet offers them: the split terms are the ones agreed with ColdAI, and
      `pnpm wallet:mainnet-check` shows the predicted split address.
- [ ] The factory and the splitter's code on Sonic are the reviewed ones, and the payout address is one you control
      on Sonic.
- [ ] The wallet's terms of use and store listing state both fees, who receives them, and that the quote and the
      review show them.

## Tests to write with the code

- The factory, init code hash and ColdAI payee are pinned, as the receiver list is.
- A predicted address from fixed, clearly fake terms, computed offline into a fixture: no network calls.
- The check refuses a receiver that isn't the predicted address, a share that isn't the declared one, and a fee over
  the cap; it passes the declared split.
- A kit build without terms behaves as today, and a template build from tarballs (`pnpm kit:e2e:scaffold-hbar`)
  stays green.

## Open questions

- The deal: a share of the 0.875 % or a fee on top, and the shares.
- Who builds and audits the splitter and the factory, and whether SODAX has any limit on contracts as fee receivers.
- Whether a kit wallet's review keeps the name "Clip fee" for ColdAI's part (this design assumes yes).
