# SODAX swaps and the Clip fee

Clip Wallet can swap an asset on one network for an asset on another, for example USDC on Base for ETH on
Arbitrum, through SODAX, the swap engine ExClip uses. **Each SODAX swap carries the Clip fee: 0.875 % of the amount
you sell, paid to ColdAI LLC.** Swaps within one network (0x, Jupiter and the other providers in
[Features](../../apps/docs/src/architecture/features.md)) carry no Clip fee.

> **Status.** Only in mainnet builds that set SODAX up ([below](#build-with-it-or-without-it)). SODAX has no test
> networks (every chain in @sodax/types 2.2.0 is a mainnet, `dist/chains/chain-keys.js:15-38`), so the testnet build
> Clip Wallet ships today doesn't offer these swaps. No build can offer them until ColdAI's receiving address is on
> the reviewed list, and mainnet itself waits for the external audit.

## What a swap costs

| Cost | Set by | Paid to | Where you see it |
|---|---|---|---|
| Clip fee | ColdAI: 0.875 % of the amount you sell | ColdAI LLC, at the address the build names | The quote: "Clip fee 0.875% · 0.875 USDC" (selling 100 USDC), with "Part of the 100 USDC you pay. It goes to ColdAI LLC." The review: "Clip fee" and "Fee goes to: ColdAI LLC, 0x…" |
| Network fee | The network you swap from | The network | The quote: "Paid on top, shown before you approve". The review: "Network fee" |
| SODAX's own costs | SODAX and its solvers | SODAX | Included in the rate SODAX quotes |

The Clip fee is part of what you pay, not added on top. Selling 100 USDC swaps 99.125 USDC and pays 0.875 USDC to
ColdAI LLC. The rate on the quote is SODAX's price for the 99.125 USDC, and "You get at least" on the review is that
price less the price-move limit you chose.

The fee is rounded down to the token's smallest unit, so it is never more than 0.875 %. An amount so small that the
fee would round to nothing is refused ("That amount is too small to swap"), never swapped without the fee.

## How the fee travels

SODAX lets a partner take a fee from each swap. It travels inside the swap (SODAX calls it an intent) as one fee
entry: the amount and the receiver, `encodePacked(uint8 1, abi.encode(uint256 fee, address receiver))`
(@sodax/sdk 2.2.0 `dist/index.mjs:25251-25284`, `:25114-25141`). SODAX pays it on Sonic, the network it runs on, to
that receiver ("the EVM hub fee receiver", @sodax/types 2.2.0 `dist/backend/backendApiV2.d.ts:10-22`).

SODAX takes the fee as a percentage in whole basis points or as an exact amount. 0.875 % is 87.5 basis points, which
the percentage form can't express: the SDK computes `amount * BigInt(percentage) / 10000n` and `BigInt(87.5)` throws
(`dist/index.mjs:5254`, `:6782-6784`), and it requires `Number.isInteger(percentage)` (`:44846`). So the wallet uses
the exact-amount form (`:6791-6796`, `:25257-25258`): it works out 875/100 000 of the amount you sell itself and puts
that amount in the swap. The fee is exactly 0.875 %, not 0.87 % or 0.88 %.

The constants are in [`sodax-fee.ts`](../../packages/features/src/swap/sodax-fee.ts) (`CLIP_FEE`, `clipFeeOn`,
`withinClipFee`).

## Who receives it

ColdAI LLC. The address is a build setting with no default (`CLIP_SODAX_FEE_RECEIVER`), and it must also be on the
reviewed list committed with the code, [`sodax-fee-receivers.json`](../../packages/features/src/swap/sodax-fee-receivers.json).
That list is **empty in the repository**, and a test pins it ("pins the reviewed receiver list" in
[`sodax-swap.test.ts`](../../packages/features/test/sodax-swap.test.ts)). So no build offers SODAX swaps until one
reviewed commit adds ColdAI's address to the list and to that test. The environment can choose among reviewed
addresses, never add one.

Every review shows the receiver in full: "Fee goes to: ColdAI LLC, 0x…".

## How the wallet checks it before you sign

The swap server only quotes. The wallet builds the transaction itself and checks the exact bytes before they can be
approved (`checkSodaxSwap` in [`sodax-intent.ts`](../../packages/features/src/swap/sodax-intent.ts)):

1. **The fee goes to a reviewed address.** Otherwise: "This swap would pay its fee to an address Clip Wallet hasn't
   reviewed, so it was stopped. Nothing was signed."
2. **The fee is at most 0.875 % of the amount sold.** Otherwise: "This swap would charge more than the 0.875% Clip
   fee, so it was stopped. Nothing was signed."
3. **Everything else is what the wallet planned, byte for byte:** the network's SODAX contract, the token, the amount
   and value, your SODAX account on Sonic, the two calls it makes there, the assets on both sides, both networks,
   your address on both, no chosen solver, no partial fill, the minimum you get, nothing else in the swap's data, and
   a deadline within the hour. Otherwise: "This swap doesn't match what you asked for, so Clip Wallet stopped it.
   Nothing was signed."

The check runs when the swap is planned, before any token permission is asked for; again when the transaction is
built for signing; and when the review is drawn, on the request being approved (the step's `verify`, which
`refineDecoded()` runs). A wallet built from the kit names itself in these messages.

The review lists the swap's own lines: the Clip fee with its amount, who receives it, the least you get and the
network it arrives on. Next to the Clip fee, the other fee row reads "Network fee", so the two can't be mixed up. The
EVM module can't read a SODAX call by itself (it is a call to a contract it has no decoder for), so, like every
request the wallet builds, the review is readable only when the check passes on the bytes and the network dry-runs
the transaction without failure. If the network can't dry-run it, the review stays unreadable and is blocked unless
blind signing is allowed in Advanced mode, and the Clip fee lines stay on it, because the check proves them from the
bytes (`linesProven` in [`steps.ts`](../../packages/features/src/steps.ts)).

The other swap providers' fee checks are unchanged: AVNU must carry no integrator fee, STON.fi no referral, and
Aftermath no extra fee.

## How a swap runs

1. **Quote.** The wallet asks the ExClip server for SODAX's token list and for a quote on the amount after the fee.
   It reads two things from Sonic itself: your SODAX account there (`getDeployedAddress` on the hub wallet factory,
   as the SDK does, `dist/index.mjs:29862-29873`), and, for each token, that SODAX's asset on Sonic stands for that
   token on that network (`assetInfo` on the hub asset manager). If Sonic disagrees with the token list, nothing is
   built.
2. **Permission.** Selling a token, rather than the network's own coin, needs a permission for exactly the amount you
   sell, for the network's SODAX asset manager. The wallet waits for it to be in a block.
3. **Swap.** One transaction to the network's SODAX asset manager, `transfer(token, yourSodaxAccount, amount, calls)`
   (`dist/index.mjs:17361-17381`). It moves the amount to your SODAX account on Sonic, which approves SODAX's intents
   contract and creates the swap with a fresh id, a ten-minute deadline and the Clip fee.
4. **Hand-over.** Once it is sent, the wallet hands the transaction to SODAX (`POST /swaps/submit-tx`,
   `backendApiV2.d.ts:462-474`) so SODAX's relay picks it up. A hand-over that doesn't go through is kept on the
   device and retried with the next quote, for up to a day.

A solver fills the swap by delivering at least the minimum to your address on the other network. **A swap that no
solver fills before its deadline isn't filled: the amount waits with SODAX until the swap is cancelled.** Cancelling
is a transaction from the same account on the network you swapped from (SODAX's `cancelIntent`,
`dist/index.mjs:31530-31599`). Clip Wallet doesn't build it yet, so the quote says "At least …, or the order isn't
filled".

## Who sees what

| Who | What they receive | When |
|---|---|---|
| The ExClip server the build names | The two tokens and networks and the amount; your IP address | When you ask for a SODAX price |
| The same server | Your address on both networks, the sent transaction and the swap | After you send a swap |
| SODAX, through that server | What the server passes on: the same | The same |
| Sonic's public RPC (`rpc.soniclabs.com`, run by Sonic Labs) | Your address (to look up your SODAX account) and the tokens' assets on Sonic | When you ask for a SODAX price |
| The network you swap from | The permission and the swap you signed | When you approve them |

The server holds SODAX's API key (SODAX's swap API takes it as `x-api-key`, @sodax/swaps-api 2.2.0
`dist/index.mjs:81-84`), so the wallet never has one. ExClip's server adds the key, drops any fee a client sends and
pins its own, and refuses tokenised stocks (ExClip `apps/server/src/services/sodaxProxy.ts:1-2`, `:97-101`,
`:190-199`). The wallet uses a server only while `GET /api/exclip/config` reports SODAX configured, trading on and a
partner fee of 0 (ExClip `apps/server/src/services/config.ts:57-62`). A server fee would be pinned into the quote,
and the minimum on the review would no longer match what the swap can give.

Settings → Your data says the same in every language ("Swaps between networks").

## Networks

Both ends must be on these ten EVM mainnets, and they must differ (a swap within one network goes to that network's
own providers, with no Clip fee):

| Network | Chain id | SODAX's key |
|---|---|---|
| Ethereum | 1 | `ethereum` |
| OP Mainnet | 10 | `0xa.optimism` |
| BNB Smart Chain | 56 | `0x38.bsc` |
| Polygon PoS | 137 | `0x89.polygon` |
| HyperEVM | 999 | `hyper` |
| Robinhood Chain | 4663 | `robinhood` |
| Kaia | 8217 | `0x2019.kaia` |
| Base | 8453 | `0x2105.base` |
| Arbitrum One | 42161 | `0xa4b1.arbitrum` |
| Avalanche C-Chain | 43114 | `0xa86a.avax` |

The list is `SODAX_SPOKES` in [`sodax-intent.ts`](../../packages/features/src/swap/sodax-intent.ts), with each asset
manager cited from @sodax/types 2.2.0 `dist/chains/chains.js`. A test in
[`packages/engine/test/sodax-networks.test.ts`](../../packages/engine/test/sodax-networks.test.ts) checks that every
one is an EVM mainnet the wallet carries.

Not covered:

- **SODAX networks Clip carries in other families:** Solana, Sui, Stellar, NEAR, Bitcoin and Stacks. Each needs
  SODAX's deposit for that family, which isn't built.
- **Hedera:** SODAX has a Hedera spoke, but the SDK scales the native value there (`dist/index.mjs:17270-17273`) and
  Clip treats Hedera's EVM as part of Hedera. Left out until it is built and tested on its own.
- **SODAX networks Clip doesn't carry:** LightLink, Redbelly, ICON, Injective's Cosmos side (Clip carries Injective's
  EVM, which SODAX doesn't) and Sonic itself.
- **Tokenised stocks** (tokens SODAX marks `isRwa`) are never offered. The wallet drops them from SODAX's list, and
  ExClip's server refuses them too.

## Build with it, or without it

**Without it** is the default. A build that doesn't set both settings, and every testnet build, offers no SODAX
swaps, never contacts the server or Sonic, and asks for no host permission for them. Nothing else changes.

**With it** (mainnet builds only), set both in the build environment, or as `CLIP_*` lines in the project's `.env`,
never in `clip.config.ts`:

```bash
CLIP_SODAX_SERVER_URL=https://exclip.example   # the ExClip server (https) that quotes SODAX swaps
CLIP_SODAX_FEE_RECEIVER=0x…                     # ColdAI LLC's address, already on the reviewed list
```

The extension build then:

- refuses a mainnet build where only one is set, the server isn't `https`, or the receiver isn't an address
  (`mainnetProblems()` in [`packages/config`](../../packages/config/src/index.ts)), or where the receiver isn't on the
  reviewed list (`sodaxProblems()` in [`wxt.ts`](../../packages/extension-kit/src/wxt.ts));
- asks for host permissions for the server's origin and `https://rpc.soniclabs.com/*` (ExClip's server sends no
  CORS headers).

The swap also stays off at run time ("Swapping these tokens isn't switched on in this build.") if the server isn't
`https` or the receiver isn't reviewed, and it stops with "Swapping isn't available right now." while the server
doesn't report SODAX configured, trading on and no fee of its own.

The desktop and phone apps don't pass any swap partner settings yet (0x and Jupiter included), so they offer no SODAX
swaps. Their quote screens already show the Clip fee when a quote carries it.

## Before a mainnet build offers it

- [ ] ColdAI LLC's receiving address is decided. It receives the fee on Sonic, so it must be able to hold and move
      SODAX's assets there.
- [ ] One reviewed commit adds it to `sodax-fee-receivers.json` and to the pinning test.
- [ ] `CLIP_SODAX_FEE_RECEIVER` is that address. `CLIP_SODAX_SERVER_URL` is an ExClip server that reports SODAX
      configured, trading on and `partnerFeeBps: 0`.
- [ ] The fee clause in the [terms of use](../legal/terms-of-use.md) and the swap text in the
      [store listing](../../apps/extension/store/listing.md) have passed legal review.
- [ ] The [privacy policy](../legal/privacy-policy.md) names whoever runs the ExClip server.

The build enforces the second and third items. The others are for people.

## Kit wallets

A wallet built from the kit gets the same swap, the same fee and the same check. How kit wallets will share the fee
through a split contract is a design, not code yet: [sodax-kit-split.md](sodax-kit-split.md).

## The tests behind this

| Rule | Test |
|---|---|
| The receiver list ships empty, and a malformed list is an error | `packages/features/test/sodax-swap.test.ts`: "pins the reviewed receiver list: empty in the repository, …", "reads a malformed receiver list as an error, …" |
| The fee is 875/100 000, rounded down, in SODAX's fee entry | Same file: "is exactly 875 / 100 000 of the amount sold, rounded down, and paid to ColdAI LLC", "travels in the intent as SODAX's single fee entry: …" |
| The check refuses another receiver, a higher fee, and anything off the plan | Same file: "refuses a fee paid to an address it hasn't reviewed, naming the wallet", "refuses a fee above 0.875 %, naming the Clip fee", "refuses anything else that isn't the plan: …" |
| The quote and review show the fee, its receiver and where the swap arrives | Same file: "quotes what's left after the 0.875 % Clip fee …", "shows the Clip fee, who gets it and where you get paid before you sign; …", "the review shows the Clip fee even when the network can't dry-run the swap; …"; `packages/ui/test/features.test.tsx` and `packages/ui/test/screens.test.tsx` ("Swap with the Clip fee (SODAX)"); `packages/mobile-kit/test/features.test.tsx` |
| Off unless set up; fails closed | Same file: "is off without the server, without a reviewed fee receiver, in test builds and off its networks", "needs the server set up for it: …"; `packages/extension-kit/test/wxt-sodax.test.ts` |
| A mainnet build needs both settings and a reviewed receiver | `packages/config/test/config.test.ts`: "asks for both SODAX settings once a build sets either"; `packages/extension-kit/test/wxt-sodax.test.ts`: "refuse a mainnet build whose settings are half set or whose receiver isn't reviewed" |
| No tokenised stocks | `packages/features/test/sodax-swap.test.ts`: "never offers a tokenised stock (isRwa), …", "refuses to quote a tokenised stock even when the server lists it" |
| Only networks the wallet carries | `packages/engine/test/sodax-networks.test.ts` |

Tests use a clearly fake receiver (`0x00000000000000000000000000000000000fee01`) and fixtures only: no network calls.

## Sources

Pinned to @sodax/sdk, @sodax/types and @sodax/swaps-api 2.2.0. Line numbers point into their `dist` files, as in the
source comments of `sodax.ts`, `sodax-intent.ts` and `sodax-fee.ts`. ExClip references are to its repository.
