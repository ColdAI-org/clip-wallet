# Wallet calls (EIP-5792)

Clip Wallet serves the Wallet Call API, [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792), with the auxiliary funds
capability, [ERC-7682](https://eips.ethereum.org/EIPS/eip-7682). Clip Connect's `pay()` uses them for you; this page is
for dapps that call them directly, through viem, wagmi or a raw provider.

The methods are additive: they answer only when a site calls them, and nothing else in the EVM provider changed.

| Where | Served? |
| --- | --- |
| Browser extension (injected EIP-1193) | yes |
| Browser extension over WalletConnect | yes, when the session's proposal asks for the methods |
| Phone app and Clip Desktop | not yet: the methods answer `4200` there |

## wallet_getCapabilities

For connected sites and the site's own addresses (`4100` otherwise). Per chain:

- `atomic: { status: "unsupported" }`. Clip accounts are EOAs, so a batch is one approval whose calls then run one
  after another.
- `auxiliaryFunds: { supported: true, assets: [...] }` on chains where Clip can bring money in for those assets
  (settle on Hedera: a bonded Connector is paid in the same asset on another network). The native coin is the
  EIP-7528 address `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`.

The advertisement comes from the wallet's catalogue and Connector deployments, **never from the person's balances**.
Whether one payment can be funded is decided when it arrives.

## wallet_sendCalls

<<< @/snippets/connect/wallet-calls.ts

Clip checks the parameters before anything is shown:

| Check | Error |
| --- | --- |
| An unknown capability that isn't marked `optional` | `5700` |
| A chain the wallet doesn't have | `5710` |
| More than 10 calls | `5740` |
| `atomicRequired: true` | `5760` (Clip accounts can't run a batch atomically) |
| ERC-7682 `requiredAssets` Clip can't bring in, or malformed | `5772`, `5773` |

Then every call goes through the full decode pipeline (EVM calls are simulated on top of the earlier ones in the same
`eth_simulateV1` block), and **one approval** shows them all. After approval, call 1 is sent, and each next call once
the one before it is mined. A batch with a hardware-wallet account is refused with a plain message for now.

## wallet_getCallsStatus and wallet_showCallsStatus

Only the site that sent a batch can see it (`5730` for any other id). Statuses follow EIP-5792: `100` pending, `200`
confirmed, `400`/`500`/`600` failed or partly reverted; `atomic` is always `false`. `wallet_showCallsStatus` opens the
batch's activity in the wallet. Batches are kept for 24 hours per site.

## Over WalletConnect

When a session's proposal asks for the methods, the approved session carries each chain's capabilities in CAIP-25
`scopedProperties`, and `wallet_sendCalls` goes to the chain its params name (which must be in the session).

All codes: [Dapp-facing error codes](../reference/dapp-errors.md). The wire shapes and validation are in
[`packages/1mask/src/shared/calls.ts`](repo:packages/1mask/src/shared/calls.ts).
