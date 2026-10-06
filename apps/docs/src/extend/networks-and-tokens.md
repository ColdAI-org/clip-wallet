# Add a network or token

Most "add a chain" work doesn't need a new chain module: if the network belongs to a family Clip already speaks, it is
a data change.

## Turn a network on in a wallet

If the kit already ships the network, a wallet just lists it in `clip.config.ts`:

- `"evm:*"`: every EVM network the kit ships, or `"evm:<chain id>"` / `"evm:<slug>"` for one;
- a family name (`"hedera"`, `"solana"`, `"cardano"`…) for its networks.

Test networks only, while `mainnet` is `false`. See [Configure clip.config.ts](../kit/config.md#networks).

## Add an EVM network to the kit

1. An `EvmNetworkSpec` in `EVM_NETWORK_SPECS` ([`packages/chains-evm/src/networks.ts`](repo:packages/chains-evm/src/networks.ts)):
   the testnet flag, public RPCs (several, no API keys), the explorer and, if it has one, the Blockscout instance.
2. Tokens in `CURATED_TOKENS` ([`packages/chains-evm/src/tokens.ts`](repo:packages/chains-evm/src/tokens.ts)).
3. A test in `packages/chains-evm/test/registry.test.ts`: the chain id resolves, and a look-alike token stays `spam`.

<<< @/snippets/extend/evm-network.ts

The native coin's key decides what merges: real ETH on every rollup is `eth`; test ETH is `eth-testnet`, so test funds
never sum into a real balance.

## Add a network to another family

Each family keeps its networks in its package's `src/networks.ts` (for example
[`packages/chains-substrate/src/networks.ts`](repo:packages/chains-substrate/src/networks.ts)), and the catalogue in
[`packages/engine/src/catalog.ts`](repo:packages/engine/src/catalog.ts) picks them up. Token metadata lives next to the
module (for Hedera, `packages/chains-hedera/src/metadata.ts`).

## Token rules

- **One key per issuer's asset.** The same issuer's token shares a `key` on every network (Circle's USDC is `usdc`
  everywhere). That's what lets Home show one balance.
- **Bridged copies are separate.** A wrapped or bridged copy gets its own key and `bridged: true`; it never merges.
- **Look-alikes are spam.** A token with a curated symbol (USDC, USDT, ETH, WETH, DAI, WBTC) that isn't the curated
  contract is spam and hidden by default. Test it.

## Make it routable

If CLPRouter can route to or from the network: its Router in
[`packages/route/src/deployments.ts`](repo:packages/route/src/deployments.ts), and its ledger and Channels in
`packages/route/src/graph.ts`, with a fixture test. Never allow test verifiers outside testnet.

## Then

`pnpm typecheck && pnpm test && pnpm harness`, and a changeset for the packages you touched.
