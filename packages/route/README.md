# @clip-wallet/route

"Route and fund": CLPRouter quotes and payments (Phase 1, `src/client.ts`), and "settle on Hedera" through
bonded Connectors (Phase 3, `src/settle.ts`). Nothing in this package signs; it builds `DappRequest`s that go
through the wallet's normal decode/approve path.

> Pre-release: Clip Wallet runs on test networks only and has had no external audit.

## Install

```sh
npm i @clip-wallet/route
```

## Example

```ts
import { findShortfall } from "@clip-wallet/route";
import type { AssetRef, TokenBalance } from "@clip-wallet/core";

const hbar: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "hedera:testnet" };
const portfolio: TokenBalance[] = [{ asset: hbar, amount: "500000000" }]; // 5 HBAR

// A request needs 25 HBAR on Hedera: what's missing, and where else the person holds money.
const [shortfall] = findShortfall([{ asset: hbar, amount: "2500000000" }], portfolio);
console.log(shortfall?.missing); // "2000000000" (20 HBAR)
```

Then `createRouteClient().quote({ to, asset, amount, portfolio })` turns routes into plain words (fee as an asset
amount, p90 time, emissions, the weakest verification on the route, steps), and `planPayOnHedera()` builds the
request to approve.

## Documentation

- [Route and settle](https://coldai.org/clip/docs/architecture/route-settle.html)
- [Wallet calls (EIP-5792, ERC-7682)](https://coldai.org/clip/docs/connect/wallet-calls.html)
- [API reference](https://coldai.org/clip/docs/reference/api/route.html)

## Settle on Hedera (Phase 3)

The user pays a bonded Connector on network Y through `SettleDeposit`, the Connector delivers on network X through
`SettleDelivery`, and both are proven over CLPR to `SettleOrderBook` on Hedera. If no delivery is proven by
`deadline + PROOF_GRACE` (Hedera's clock), anyone can call `claimDefault(orderId)` and the user's `refundTo`
receives cover + penalty from the Connector's bond.

```ts
import { SETTLE_DEPLOYMENTS, settleOnHedera, type ConnectorQuoteRequest } from "@clip-wallet/route";
import type { AssetRef } from "@clip-wallet/core";

const deployment = SETTLE_DEPLOYMENTS.find((d) => d.network === "testnet")!;
const hbar: AssetRef = { key: "hbar", symbol: "HBAR", name: "HBAR", decimals: 8, networkId: "eip155:296" };
const settle = settleOnHedera({
  ...deployment,
  mirrorNodeUrl: "https://testnet.mirrornode.hedera.com",
  coverAssets: [{ address: "0x0000000000000000000000000000000000000000", asset: hbar }], // HBAR as cover
});

export async function payThroughAConnector(req: ConnectorQuoteRequest, user: string) {
  const [best] = await settle.quoteConnectors(req); // every quote is checked before it is returned
  if (!best) return null;
  const { order, requests } = await settle.createOrder(best, user); // approve (ERC-20 only) + deposit
  return { order, requests }; // each request goes through the wallet's normal approval
}
```

`SETTLE_DEPLOYMENTS` lists the testnet deployment. `settleOnHedera()` without options still rejects every call with
`ClipError("Not available yet", "phase3")`.

What `quoteConnectors` checks before a quote is shown (a quote failing any check is dropped; one Connector failing
never fails the call):
- the order id is the quote's EIP-712 digest and the signature recovers to a signer the order book accepts for that
  Connector (`isValidSigner(connector, signer, issuedAt, expiry)`), so the deposit can't end up `REJECTED`
  (money to the Connector with no cover);
- every field matches the request: ledgers, assets, `amountOut`, recipient, payer, `refundTo`, `deadline` ≥ asked,
  `depositApp` = our known `SettleDeposit` for that network (and the one the order book's source for that ledger
  accepts), `expiry` at least 60 s away;
- on Hedera: Connector registered, cover asset accepted, `freeCapacity ≥ owedFor(coverAmount)`,
  `owedOnDefault == owedFor(coverAmount)`, both ledgers' sources active, the order id unused.

Status mapping (`orders(orderId).status`): `NONE` → `awaiting-deposit` (or `deposited` once `markDeposited` recorded
the deposit transaction), `OPEN` → `deposited` (`defaulted` once Hedera's clock is past `deadline + PROOF_GRACE`),
`DELIVERED` → `settled`, `DEFAULTED`/`CANCELLED` → `paid-from-bond`, `REJECTED` → `rejected`.

### Sources
- Contracts: CLPRouter repo, branch `feat/settle-on-hedera` (commit a56cf60, quote vector from 7593128):
  `src/settle/SettleTypes.sol` (quote, EIP-712 domain `ClprSettle`/`1`, ledger = keccak256 of the CAIP-2 id),
  `src/settle/SettleDeposit.sol`, `src/settle/SettleDelivery.sol`, `src/settle/SettleOrderBook.sol`,
  `src/settle/interfaces/ISettlePaymentProver.sol`. ABI subsets in `src/settle-abi.ts` come from
  `out/SettleOrderBook.sol/SettleOrderBook.json` and `out/SettleDeposit.sol/SettleDeposit.json` (`forge build`).
- Cross-language vector: CLPRouter `sdk/test/vectors/settle-quote.json`, copied to `test/fixtures/` (signed there by
  the public BIP-39 "abandon … about" test account; this repo never signs).
- EIP-712: https://eips.ethereum.org/EIPS/eip-712 (viem `hashTypedData`, `recoverAddress`).
- Hedera mirror node REST API, OpenAPI 0.164.0 (https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml,
  https://docs.hedera.com/hedera/sdks-and-apis/rest-api), primary read path:
  `POST /api/v1/contracts/call` (`{ to, data, block }` → `{ result }`), `GET /api/v1/blocks?limit=1&order=desc`
  (`timestamp.to`, Hedera's clock), `GET /api/v1/contracts/{address}/results/logs` with `topic0`, `topic2` and a
  `timestamp=gte:…&timestamp=lt:…` range of at most 7 days (topic filters require it; checked live 2026-10-03).
- Hedera JSON-RPC relay (https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay): fallback
  for `eth_call` and `eth_getBlockByNumber`; no log listing through it.
- Hedera EVM requests are `eth_sendTransaction` on `eip155:296` handled by `@clip-wallet/chains-evm`
  (`packages/chains-hedera/src/networks.ts` header, `packages/1mask/README.md` "Hedera").

## Phase 1 sources
See `src/clprouter.ts` (vendored CLPRouter SDK planner, commit 564e29e), `src/abi.ts` (ClprRouter ABI) and
`src/deployments.ts` (testnet deployment).

## Versioning and provenance

Published from [ColdAI-org/clip-wallet](https://github.com/ColdAI-org/clip-wallet) by CI with npm provenance: every
tarball is signed and traceable to the commit that built it (`npm audit signatures` checks it). All `@clip-wallet/*`
packages share one version; pin it exactly.

## Licence

See [LICENSE](./LICENSE).
