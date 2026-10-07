# EVM: EIP-1193 and EIP-6963

Clip Wallet announces an EIP-1193 provider through **EIP-6963**, so every modern EVM library lists it next to the
other installed wallets. It does **not** take over `window.ethereum`: it never claims it and never pretends to be
MetaMask.

| | |
| --- | --- |
| EIP-6963 name | `Clip Wallet` |
| EIP-6963 rdns | `org.coldai.clipwallet` (kit-built wallets announce their own) |
| `window.ethereum` | left alone |
| Networks | the EVM test networks the wallet ships with: Sepolia, Base Sepolia, Arbitrum Sepolia, OP Sepolia, Arc, STRATO Helium, Hedera EVM and more (every mainnet: [Networks](../reference/networks.md)) |

## Without a library

<<< @/snippets/dapps/eip6963.ts

## With wagmi

wagmi discovers EIP-6963 wallets on its own; Clip's connector id is its rdns.

<<< @/snippets/dapps/wagmi-core.ts

React apps: see [wagmi and RainbowKit](./wagmi-rainbowkit.md). Reown AppKit: see [AppKit](./appkit.md).

## Methods

| Kind | Methods | Behaviour |
| --- | --- | --- |
| Connect | `eth_requestAccounts`, `wallet_requestPermissions` | One approval, then a per-site permission. A second connect while one is waiting gets `-32002`. |
| Local | `eth_accounts`, `eth_chainId`, `net_version`, `wallet_getPermissions`, `wallet_revokePermissions` | `eth_accounts` is `[]` until the site is connected. |
| Networks | `wallet_switchEthereumChain` | Chains the wallet ships with switch **without a prompt** and emit `chainChanged`. Others get `4902`. Remembered per site. |
| | `wallet_addEthereumChain` | Only for chains the wallet already has (it switches to them, with the wallet's own RPC). Others get `4001`. |
| Signing | `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` | Need the permission and one of the site's accounts. A transaction whose `chainId` differs from the site's network gets `-32602`. |
| Wallet calls | `wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`, `wallet_showCallsStatus` | EIP-5792 with ERC-7682 auxiliary funds. See [Wallet calls](../connect/wallet-calls.md). |
| Read-only | `eth_call`, `eth_getBalance`, `eth_blockNumber`, `eth_estimateGas`, `eth_getTransactionReceipt`, `eth_getLogs`, `eth_gasPrice`, `eth_feeHistory`, … | Sent to the wallet's RPC. No permission needed. |
| Refused | `eth_sign` | `4200`: it can authorise anything and Clip never signs it. |

Events: `connect`, `disconnect`, `chainChanged`, `accountsChanged`. Error codes: [Dapp-facing error codes](../reference/dapp-errors.md).

## What the person sees

Clip decodes transactions, permits and typed data into plain words before approval:

- transfers name the amount, token and recipient;
- **unlimited** token approvals, `setApprovalForAll` and permits are called out loudly;
- simulation (`eth_simulateV1`) shows the real balance changes where the RPC supports it;
- calldata it can't read is blind and blocked by default.

Send standard, readable requests: EIP-712 typed data instead of raw hashes, real transactions instead of `eth_sign`.

## Tested

- **Dapp matrix**, Sepolia: wagmi 3 + viem with EIP-6963 discovery connects, signs (verified with viem's
  `verifyMessage`), sends a transaction the testnet confirms, and the approval shows it decoded. The live MetaMask test
  dapp lists and connects Clip. [Results](../testing/results/dapp-matrix.md) ·
  [test page](repo:apps/extension/e2e/matrix/dapps/evm.ts)
- **Picker matrix**: RainbowKit, ConnectKit and Reown AppKit list Clip under "Installed" with its icon, connect,
  reconnect and restore after a reload; Reown AppKit Lab on Sepolia signs a message.
  [Results](../testing/results/picker-matrix.md)

## STRATO

STRATO's nodes take signed legacy (EIP-155) Ethereum transactions, so EIP-1193 dapps work unchanged: gas is unpriced,
and the flat per-transaction fee (0.01 USDST, or a voucher) shows on the approval as its own line. Contract calls are
matched to SolidVM functions by selector; STRATO's EIP-712 "function call" transactions aren't supported.
