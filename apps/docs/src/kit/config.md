# Configure clip.config.ts

Everything a wallet maker changes, apart from the icon, is one file: `clip.config.ts` (in a kit-built wallet,
`packages/extension/clip.config.ts`; in this repo, `apps/extension/clip.config.ts`). It is validated by
`defineConfig()` from `@clip-wallet/config`, which fills in defaults and refuses anything wrong with a plain sentence
per problem.

<<< @/snippets/kit/clip.config.ts

Only `name` and `rdns` are required. In a kit-built wallet, the identity fields come from `wallet.identity.json`,
which `pnpm wallet:identity` writes; edit identity there. Every setting with its type and default:
[clip.config.ts schema](../reference/config.md).

## Identity and branding

| Setting | |
| --- | --- |
| `name` | shown in the stores, wallet pickers and every screen; also derives the window global (`acmewallet`) |
| `rdns` | the EIP-6963 id dapps key on: a reverse domain **you own** |
| `description`, `homepage` | stores, WalletConnect metadata and listings |
| `icon` | `./icon.svg` or `./icon.png`, shipped inside the extension |
| `extension.key` | the public key that fixes the Chrome extension id (written by the identity step) |
| `theme` | `accent`, `accentText` (contrast at least 3:1), `font`, `radius` |

Screens read only theme tokens and the configured name, so the whole wallet takes your brand. Small accent-coloured
text is derived from `accent` to reach 4.5:1 contrast automatically.

## Networks

<<< @/snippets/kit/networks.ts

`networks` takes `"evm:*"` (every EVM chain the kit ships), `"evm:<chain id>"`, an EVM network slug, or a family name:
`hedera`, `solana`, `bitcoin`, `sui`, `aptos`, `cardano`, `substrate`, `starknet`, `ton`, `near`, `stellar`, `tezos`,
`algorand`. A family you leave out isn't loaded, and its dapp connectors aren't installed. While `mainnet` is `false`,
only test networks are used.

## Routing

`route.mode`, `route.filters` and `route.settleOnHedera` set the defaults for route-and-fund. See
[Route and settle](../architecture/route-settle.md#routing-defaults).

## Services

<<< @/snippets/kit/services.ts

Each is optional and off when unset: passkey backup and sync, NFT media, phone pairing, and Clip handles. Run your own
deployments: [Services](../services/).

## Keys that never go in the config

The WalletConnect project id and partner keys come from the **build environment**, never from this file:

```sh
# packages/extension/.env (gitignored); only CLIP_* lines are read
CLIP_WALLETCONNECT_PROJECT_ID=<your 32-character project id>
CLIP_0X_API_KEY=<your 0x key>
CLIP_BLOCKAID_API_KEY=<your Blockaid key>
```

The full list is on [Features](../architecture/features.md#partner-keys). Without a key, the feature says plainly that it
isn't switched on in this build.

## Validation

<<< @/snippets/kit/validate.ts

## Mainnet

::: danger Real funds
Clip Wallet is pre-release and has had no external audit. Turning mainnet on makes your wallet move real money. Only do
it after every box in `packages/extension/MAINNET.md` is ticked by a person: your own identity and keys, production
services, an independent review of your changes, usability tests, and support and security contacts.
:::

`mainnet` is `false` or the checklist object, with the acknowledgement copied word for word:

<<< @/snippets/kit/mainnet.ts

Three things enforce it: the extension build refuses mainnet while `mainnetProblems()` lists anything or `MAINNET.md`
has an open box; `pnpm harness` fails while mainnet is on with an open box; and `pnpm wallet:mainnet-check` lists what
is left. Coding agents must never tick the boxes or switch mainnet on.
