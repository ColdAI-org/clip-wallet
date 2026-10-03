# Integration: settle-client (Phase 3 "settle on Hedera" client)

Branch `p25/settle-client`. Only `packages/route` changed. No shared file was edited.

## Nothing to wire today
`settleOnHedera()` (no options) is unchanged: it rejects with `ClipError("Not available yet", "phase3")`.
`SETTLE_DEPLOYMENTS` (`packages/route/src/phase3.ts`) is empty because no order book is deployed. Nothing in
apps/ or packages/ui calls the settle client yet, so no wiring is needed to merge this branch.

## When a deployment exists
1. Add it to `SETTLE_DEPLOYMENTS` in `packages/route/src/phase3.ts` (order book, Hedera chain id, `SettleDeposit`
   per source network, Connector directory).
2. Hedera EVM network for the claim/withdraw requests. `claimFromBond` / `withdrawOwed` return
   `eth_sendTransaction` requests with `networkId: "eip155:296"`. `packages/chains-evm/src/networks.ts` has no
   chain 296 entry today ("Hedera is its own module"), so the registry must list it for those requests to decode.
   Add to `EVM_NETWORK_SPECS` (testnets block):
   ```ts
   { slug: "hedera-testnet-evm", name: "Hedera Testnet (EVM)", chainId: 296, native: { symbol: "HBAR", name: "HBAR", decimals: 18, key: "hbar" }, rpcUrls: ["https://testnet.hashio.io/api"], explorerUrl: "https://hashscan.io/testnet", testnet: true },
   ```
   (decimals 18: the JSON-RPC relay exposes balances and `value` in weibars), plus a test in
   `packages/chains-evm/test/registry.test.ts`. Check with the chains-evm owner whether this should go behind the
   1Mask `familyForNetwork` hook instead.
3. Background (`apps/extension/src/background/real.ts` or `wiring.ts`), next to the existing `createRouteClient`:
   ```ts
   import { SETTLE_DEPLOYMENTS, settleOnHedera } from "@clip-wallet/route";
   import { MIRROR_NODE_URLS } from "@clip-wallet/chains-hedera";
   const dep = SETTLE_DEPLOYMENTS.find((d) => d.network === (config.mainnet ? "mainnet" : "testnet"));
   const settle = dep
     ? settleOnHedera({ ...dep, mirrorNodeUrl: MIRROR_NODE_URLS[config.mainnet ? "mainnet" : "testnet"], coverAssets: [
         { address: "0x0000000000000000000000000000000000000000", asset: { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "eip155:296" } },
       ] })
     : settleOnHedera();
   ```
   Cover amounts in HBAR are tinybars (8 decimals) inside the EVM.
4. After the wallet sends the deposit transaction, call `settle.markDeposited(order.id, txHash)` so the order
   shows "deposited" until Hedera opens it.
