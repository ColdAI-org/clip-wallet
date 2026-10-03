# @clip-wallet/chains-starknet

Starknet `ChainModule` for Clip Wallet. It builds, decodes, simulates and broadcasts, but it never touches keys.
`prepare()` returns the transaction hash (or SNIP-12 message hash) as a 32-byte `stark-ecdsa` payload. The vault
signs it. `finalize()` checks `[r, s]` against the account's Stark key and sends the transaction.

It's built on `starknet` (starknet.js) **10.8.0**, the current release (npm, 2026-09-10; the brief said v6/v7). The
module uses it for hashing, calldata, typed data and verification only. JSON-RPC goes over `ctx.fetch` to a spec
0.10 node.

## Networks

| network | NetworkId (CAIP-2) | wallet API chain id (felt) | public RPCs (no key) |
|---|---|---|---|
| Sepolia | `starknet:SN_SEPOLIA` | `0x534e5f5345504f4c4941` | `api.zan.top/public/starknet-sepolia/rpc/v0_10`, `starknet-sepolia-rpc.publicnode.com` |
| Mainnet | `starknet:SN_MAIN` | `0x534e5f4d41494e` | `api.zan.top/public/starknet-mainnet/rpc/v0_10`, `starknet-rpc.publicnode.com` |

Sources:
- CAIP-2 `starknet:<chain id string>`: ChainAgnostic namespaces, `starknet/caip2.md`. It lists `SN_MAIN`; Sepolia
  follows the same rule.
- Felt chain ids: checked with `starknet_chainId` on each RPC (2026-10-03). Both RPCs report spec `0.10.x`.
- ZAN is starknet.js's own `RPC_DEFAULT_NODES` host. Blast and Lava public endpoints are shut down, so they
  aren't listed.

Asset keys:
- STRK = `strk`. It's the native asset and pays v3 fees.
- ETH (StarkGate, the canonical bridge) = `eth`.
- Circle USDC = `usdc`: `0x0330…35fb` on mainnet, `0x0512…8343` on Sepolia, from developers.circle.com.
- StarkGate USDC.e = `usdc.e` (`bridged`).
- Other tokens = `starknet:<address>`. A look-alike symbol gets `spam`.

All symbols and decimals were checked on-chain.

## Account

- **Default: OpenZeppelin account, class `0x0540d7f5…f8e688` (v0.17.0).** This is the class `@clip-wallet/vault`
  uses for its default Starknet address (`STARKNET_OZ_ACCOUNT_CLASS_HASH`), so module and vault addresses match.
  A test cross-checks them.
- Why OpenZeppelin:
  - The constructor takes only the Stark public key, so the counterfactual address
    (`salt = key, calldata = [key], deployer = 0`) depends on the key and nothing else.
  - The account deploys itself with `DEPLOY_ACCOUNT`; no factory or relayer is needed.
  - The signature is plain `[r, s]`.
  - It's audited and upgradeable, and it implements SRC-9 v2 outside execution, which leaves room for a paymaster
    later.
  - The class is declared on both networks (`starknet_getClass`).
- `account: "argent"` switches to **Argent account 0.4.0** (`0x0360…927f`, what Argent X deploys). Its constructor
  calldata is `[0, key, 1]` (owner `Signer::Starknet(key)`, guardian `None`), and it accepts `[r, s]`.
  `accountAddress(pk, { kind: "argent", classHash })` fits the vault's `addressOf` injection.
- `OZ_V3_ACCOUNT_CLASS_HASH` (contracts-cairo 3.x preset `0x01d1…2381`) can be passed as `accountClassHash`.
- Braavos accounts aren't supported. Their deployment uses a base class plus signed chain-specific calldata.
- Derivation path recorded: `m/44'/9004'/0'/0/i`. This is Argent X's scheme; the vault owns derivation (see its
  README "Starknet").
- **Not active yet**: until the first transaction, `starknet_getClassHashAt` returns "contract not found".
  - `accountStatus(ctx)` returns `"not-deployed"`.
  - `decode()` adds "Not active yet. This first transaction also activates it (one-time fee)."
  - `prepare()` returns two payloads: DEPLOY_ACCOUNT (nonce 0), then INVOKE (nonce 1).
  - `finalize()` sends the deploy, waits until the node has received it, then sends the invoke.
  - `deploymentDataFor(ctx)` answers `wallet_deploymentData`.

**Validated against the network.** The DEPLOY_ACCOUNT + INVOKE pairs built by `prepare()`/`finalize()` were
simulated on Sepolia with validation on, for both the OpenZeppelin and Argent classes. The node accepted them, and
it rejected the same transactions with a corrupted signature ("invalid signature"). So the v3 Poseidon transaction
hashes match the network's. The test fixtures come from that run.

## Requests

| method | params | result |
|---|---|---|
| `wallet_addInvokeTransaction` | `{ calls: [{ contract_address, entry_point, calldata }] }` | `{ transaction_hash }` |
| `wallet_signTypedData` | SNIP-12 `TypedData` | `[r, s]` (felt hex) |
| `starknet_requestAddInvokeTransaction` (WalletConnect) | `{ accountAddress, executionRequest: { calls: [{ contractAddress, entrypoint, calldata }] } }` | `{ transaction_hash }` |
| `starknet_signTypedData` (WalletConnect) | `{ accountAddress, typedData }` | `{ signature }` |
| `wallet_addDeclareTransaction` | — | refused in plain words |

Method names and shapes come from `@starknet-io/types-js` 0.10.4 (`wallet-api/methods.d.ts`) and Reown's "Starknet
RPC" reference. 1Mask answers connect, chain and permission methods itself.

### decode()

- **Multicall**: every call is listed.
  - ERC-20 `transfer` / `transfer_from` (from you): "Send 2.5 USDC to 0x0000…b0b0".
  - `approve` / `increase_allowance`: `unlimited-approval`, danger at ≥ u256::MAX or 2^255, caution otherwise.
  - `set_approval_for_all`: `approval-for-all` danger.
  - Other entry points show by name ("Swap exact tokens for tokens on app.example"). The function name is in
    the request, and the selector is computed from it, so those calls aren't treated as blind.
  - Calls into your own account (upgrade, key change) are **blind** with a danger warning.
  - Calldata felts must be below the field prime.
- **Simulation**: `starknet_simulateTransactions` with `SKIP_VALIDATE`, `SKIP_FEE_CHARGE` and the query version
  `0x1…03`. It prepends DEPLOY_ACCOUNT while the account isn't active.
  - Balance changes come from ERC-20 `Transfer` events touching you, in the Cairo 1 and Cairo 0 layouts.
  - A revert becomes a plain `simulation-failed` warning.
- **Fee**: in STRK, from the simulation (or `starknet_estimateFee`). If your STRK can't cover it, you get a
  `high-fee` danger.
- `prepare()` re-estimates with `starknet_estimateFee` and sets the v3 resource bounds (l1_gas, l1_data_gas,
  l2_gas) to estimate + 50%. Tip is 0, DA modes are L1, `paymaster_data` is empty.
- **SNIP-12**:
  - A domain `chainId` for another network is refused (`starknet/network-mismatch`).
  - SNIP-9 `OutsideExecution` (someone else can run calls from your account later) is blind with a danger warning.
  - Other typed data shows the app name, type and up to 8 message fields.

## Balances and NFTs

`getBalances` reads `balanceOf` for the curated tokens. STRK is always listed; other tokens are listed when held.

`getNfts` returns `[]` by default. There's no public, keyless Starknet NFT indexer: NFTScan and Voyager need API
keys, and Starkscan is gone. Plug one in with the `nfts` option.

## AVNU helpers (`src/avnu.ts`)

For wallet-built AVNU swaps in `@clip-wallet/features`:
- `AVNU_EXCHANGE`: Exchange contract per network, from the avnu-labs/avnu-contracts-v2 README (mainnet
  `0x0427…3b0f`, Sepolia `0x02c5…e7c2`), read 2026-10-03.
- `parseMultiRouteSwap(calldata)`: reads the fixed head of `multi_route_swap` (`src/exchange.cairo`): sell token and
  amount, buy token and amount, minimum out, beneficiary, integrator fee, route count. A test checks it against
  calldata starknet.js compiles from the ABI.
- `approveCall(token, spender, amount)` / `parseApprove`: exact-amount ERC-20 approve (u256 split as starknet.js does).

## Gaps

- No paymaster flow yet. AVNU's SNIP-29 paymaster (`sepolia.paymaster.avnu.fi`) is gasless only with an API key.
  OZ/Argent SRC-9 support makes it a later addition.
- Braavos accounts.
- No declare.
- `wallet_watchAsset` answers `false`, because token lists are curated.
- Tip is fixed at 0. Starknet 0.14's tip market may slow inclusion when blocks are busy.
