# request()

`connection.request({ chain, method, params })` sends any method on any connected chain.

- **EVM chains** (a chain id or `eip155:<id>`): any EIP-1193 JSON-RPC method. If the wallet is on another chain, Clip
  Connect switches first (`wallet_switchEthereumChain`).
- **Other families** (a CAIP-2 id): a Wallet Standard feature by name, such as `solana:signMessage`. `params` is the
  feature's input, or an array of inputs.

<<< @/snippets/connect/request-evm.ts

<<< @/snippets/connect/request-solana.ts

If no connected wallet offers the method on that chain, `request()` throws with `code: 4200`. Wallet errors pass
through unchanged: rejection is still `4001`.

For viem or ethers, hand them `connection.evm.provider` instead; it is the wallet's own EIP-1193 provider.
