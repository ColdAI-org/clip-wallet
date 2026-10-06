# pay(), canPay(), balances()

These three let a dapp speak in assets, never networks.

## pay()

`connection.pay({ asset, amount, to, chain? })` sends a payment and returns a `PayResult`.

<<< @/snippets/connect/pay.ts

1. **Which chain.** With `chain`, that one. Without it, the first of your `chains` (starting with the wallet's current
   one) where the person holds enough of the asset; else the first where the wallet says it can bring the money in;
   else the wallet's current chain.
2. **What it sends.** A native transfer, or an ERC-20 `transfer`. If the wallet speaks EIP-5792 it goes as
   `wallet_sendCalls` (`atomicRequired: false`), with ERC-7682 `auxiliaryFunds` marked optional and the required
   asset listed when the wallet advertises the capability for that chain and asset. Otherwise it is a plain
   `eth_sendTransaction`.
3. **What you get back.**

| `PayResult` field | |
| --- | --- |
| `chain` | the CAIP-2 chain it was sent on |
| `method` | `"wallet_sendCalls"` or `"eth_sendTransaction"` |
| `id` | the EIP-5792 batch id, or the transaction hash |
| `auxiliaryFunds` | `true` when the wallet was told what's needed and can bring it in |
| `fallback` | `"no-eip5792"` or `"no-auxiliary-funds"` when it fell back; tell the person the balance on `chain` must cover it |
| `wait({ timeoutMs?, pollMs? })` | resolves `{ status: "confirmed" \| "failed", transactionHashes }`; polls `wallet_getCallsStatus` or the receipt (default 10 minutes, every 2 s) |

`amount` is human units (`"25"`, `"0.5"`, a number) or base units as a `bigint`. More decimals than the asset has throw:
money is never rounded silently.

## canPay() and balances()

<<< @/snippets/connect/can-pay.ts

- `canPay({ asset, amount })` returns `{ ok, how, chain? }`: `how` is `"balance"`, `"auxiliaryFunds"` or `"none"`.
- `balances()` reads each asset on each of your `chains` (through the wallet on its current chain, or the `rpc` URLs
  you passed for the others) and returns `{ [key]: { key, symbol, decimals, total, formatted, byChain } }`. Assets
  with nothing anywhere are left out.

## Assets

Built in: native coins (`eth` on Ethereum, Optimism, Base, Arbitrum and their Sepolia testnets; `hbar` on Hedera's EVM,
295 and 296; `pol`; `avax`) and Circle's USDC (`usdc`) on Ethereum, Optimism, Polygon, Base, Arbitrum and Avalanche,
and on Sepolia, Base Sepolia, Arbitrum Sepolia and OP Sepolia. Add your own with `assets`, keyed so the same key
means the same asset everywhere:

<<< @/snippets/connect/custom-asset.ts

Helpers you can use directly: `parseAmount(value, decimals)`, `formatAmount(units, decimals)`, `erc20Transfer(to,
amount)`, `assetRegistry(extra)`, and the CAIP helpers `caip10`, `parseCaip10`, `evmCaip2`, `evmChainId`, `toCaip2`.
