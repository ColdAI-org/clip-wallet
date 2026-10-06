# Troubleshooting

## Clip Wallet doesn't show up

1. **Is the page served over `https://`, or from `localhost` / `127.0.0.1`?** 1Mask is injected only there.
2. **Does your picker list installed wallets, or only its own registry?** EIP-6963 pickers, the Solana, Sui and Aptos
   adapters, Mesh and DOT Connect list every installed wallet. These show only their own list until Clip is listed:

   | Picker | What to add meanwhile |
   | --- | --- |
   | TON Connect UI | an `includeWallets` entry ([TON Connect](./ton.md)) |
   | NEAR Wallet Selector | `setupClipWallet()` ([NEAR](./near.md)) |
   | Stellar Wallets Kit | `new ClipWalletModule()` ([Stellar](./stellar.md)) |
   | use-wallet | `clipWallet()` ([Algorand](./algorand.md)) |
   | starknetkit | `new InjectedConnector({ options: { id: "clipwallet" } })` ([Starknet](./starknet.md)) |
   | cardano-connect-with-wallet | `"clipwallet"` in `supportedWallets` ([Cardano](./cardano.md)) |
   | Talisman Connect | an entry in `walletList` ([Polkadot](./polkadot.md)) |
   | Beacon's modal | it lists Clip but needs the pairing handler ([Tezos](./tezos.md)) |
   | sats-connect's selector | find Clip through the Wallet Standard instead ([Bitcoin](./bitcoin.md)) |

3. **Did you wait for discovery?** EIP-6963 and the Wallet Standard are events. Ask again
   (`eip6963:requestProvider`) or listen for late registrations instead of reading once at load.
4. **Does the wallet have the family on?** A kit-built wallet may have turned some families off in its
   `clip.config.ts`; its providers for those families aren't installed.
5. **Looking for `window.ethereum`?** Clip never claims it. Use EIP-6963.

## "Clip Wallet only connects to the networks it ships with"

Your dapp asked for a chain the wallet doesn't have (`4902`), or a mainnet chain while Clip is test-networks-only.
Point the dapp at a testnet the wallet ships with.

## The approval says the request can't be read

Clip couldn't decode it, so it's blind and blocked by default. Usual causes and fixes:

- `eth_sign` or a raw hash to sign: use `personal_sign` or EIP-712 typed data.
- Unusual calldata: the approval still names the function when it knows the selector, but can't promise every
  effect. Prefer standard token calls.
- The account can't pay the fee, or doesn't exist on the network yet (NEAR implicit accounts, unfunded Stellar or
  Aptos accounts). The approval shows that reason; fund the account. See [Fund a test wallet](../testing/test-wallet.md).

## The person rejected, or nothing happened

- Rejection is the ecosystem's standard error (`4001` on EVM). Let them try again.
- `-32002` means a request from your site is already waiting in the wallet.
- `-32005` means too many requests or too many waiting approvals from your site: slow down.

All codes: [Dapp-facing error codes](../reference/dapp-errors.md).

## WalletConnect doesn't offer Clip

Your dapp's WalletConnect needs your own project id. The wallet's side needs a build with
`CLIP_WALLETCONNECT_PROJECT_ID`; without it, WalletConnect (and Hedera's extension discovery) is off.
