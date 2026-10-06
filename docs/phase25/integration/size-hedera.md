# size-hedera: Hedera without the Hiero SDK

`@clip-wallet/chains-hedera` no longer loads `@hiero-ledger/sdk` or `@hiero-ledger/proto` at runtime. Both are
devDependencies now, used only by its tests to prove the new code produces the same bytes. Details are in
`packages/chains-hedera/README.md` ("Submitting", "Protobuf codec", "Tests").

## What changed in chains-hedera

- `src/proto/wire.ts`, `src/proto/hapi.ts`: a hand-written protobuf codec for exactly the HAPI messages the
  wallet reads or builds. Field numbers come from hashgraph/hedera-protobufs **v0.77.2**, with each file cited.
- `src/tx.ts`: parse, freeze (builders and HIP-745), sign and verify, all on bytes with `@noble/curves`
  and `@noble/hashes`.
- `src/submit.ts`: submits over gRPC-Web, one `fetch` per node to the proxies the SDK's own browser client
  uses (`GRPC_WEB_NODES` in `src/networks.ts`). It retries the next node on the same precheck codes as the
  SDK. This was checked against live testnet with an unsigned transaction: every node answered
  `INVALID_SIGNATURE` at precheck in about 0.5 s.
- `src/ids.ts`: entity and transaction ids, plus HIP-15 checksums.
- Builders now freeze for 5 random nodes. Before, the SDK used every node of its client: 7 on testnet and
  25 on mainnet in the browser build. So the vault now signs at most 5 digests per transaction.

## API changes (all callers in the repo still compile)

- `Submitter` is now `(signedTransactionList: Uint8Array, ledger, ctx) => Promise<HederaTransactionResponse>`.
  It used to take an SDK `Transaction`. The response shape is unchanged: the SDK's `TransactionResponse.toJSON()`.
  No package outside chains-hedera passes a custom submitter.
- `freezeNew(tx, payer, ctx)` now returns TransactionList bytes. `requestFor(bytes, payer, ctx)` takes them.
  `freezeNew` still accepts an unfrozen SDK transaction, which it reads through its own `toBytes()`. So
  `packages/features` compiles and works unchanged, but it still bundles the SDK until the patch below is applied.
- `resolveRecipient` returns the codec's `AccountIdP` instead of an SDK `AccountId`. It has no callers outside
  the package.
- New exports: `TransferDraft`, `associateDraft`, `contractCallDraft`, `tokenAllowanceDraft`,
  `hbarAllowanceDraft`, `freezeDraft`, `freezeIfNeeded`, `parseTransaction`, `transactionIdString`,
  `accountIdString`, `parseAccountId`, `parseEntityId`, `entityChecksum`, `attachSignatures`, `bodiesToSign`,
  `verifyTransaction`, `submitTransaction`, `PrecheckError`, `GRPC_WEB_NODES`.

## Integration step: apply `size-hedera.patch` (packages/features)

`packages/features` was outside this stream's scope, and it still imports the SDK in two places:

- `swap/saucerswap.ts` builds an `AccountAllowanceApproveTransaction` and a `ContractExecuteTransaction`.
- `trade/service.ts` calls `Transaction.fromBytes(...).transactionId`.

While those imports stay, the extension and mobile bundles keep most of the SDK. The patch replaces them with
`tokenAllowanceDraft`, `contractCallDraft`, and `parseTransaction` plus `transactionIdString`. It also moves
`@hiero-ledger/sdk` to features' devDependencies, because its tests still use the SDK to check outputs.
About 20 lines change.

```sh
git apply docs/phase25/integration/size-hedera.patch
pnpm install          # updates the features importer in pnpm-lock.yaml
pnpm -C packages/features test && pnpm -r typecheck
```

The patch was verified on this branch: features 63/63 tests pass, `pnpm -r typecheck` is green, and the
outputs are byte-identical to what the SDK produced before. `test/codec.test.ts` in chains-hedera checks both
drafts against `ContractExecuteTransaction` and `AccountAllowanceApproveTransaction`.

No changes are needed in `apps/extension`: the extension needs no new host permission (the proxies send CORS
headers) and no build-config change.

## Measured

Extension: `wxt build`, `.output/chrome-mv3/background.js`.

| | bytes | gzip -9 |
|---|---|---|
| before (f1058eb) | 9,999,949 | 3,015,283 |
| chains-hedera only (this branch as committed) | 9,265,076 | |
| + `size-hedera.patch` (features) | **7,722,066** (−2.28 MB, −22.8 %) | **2,666,306** (−349 KB) |

The final bundle contains no `@hiero-ledger`, protobufjs or HAPI-generated code. The only Hedera strings left are
the node proxy host names.

Mobile: `expo export --platform ios`, Hermes bytecode.

| | bytes |
|---|---|
| before (f1058eb) | 23,071,148 |
| + this branch + `size-hedera.patch` | **15,728,272** (−7.3 MB) |

The source map of the patched bundle lists 4,626 modules. None comes from `@hiero-ledger`; chains-hedera
contributes 16 of its own files.

## Mobile note (supersedes the Hedera note in docs/phase2/integration/mobile.md)

The React Native issue was the SDK's `"react-native"` export (`lib/native.js`, `Client.forName` taking a single
argument). It no longer applies: chains-hedera never creates an SDK client, and once the patch is applied no
SDK code reaches Metro at all.

Submission uses `ctx.fetch` with a `Uint8Array` body and `response.arrayBuffer()`. React Native's fetch supports
both. `apps/mobile/tsconfig.json`'s `customConditions: []` was only there for the SDK's types. It can stay; it
is harmless.

## Gaps

- The gRPC-Web proxy list is static, copied from the SDK's address book. The mirror node's
  `grpc_proxy_endpoint` (HIP-1046) is still null on every network. When it is filled in, read it from
  `/api/v1/network/nodes`.
- Transaction types outside the codec are still shown, but blind (with their type name). They can still be
  signed, and submitted if their RPC is in `submit.ts`.
- `pnpm -r test`: `packages/hardware` `ledger.test.ts › EVM EIP-712` timed out at 5 s twice under the parallel
  run, and passes alone (47/47). It has nothing to do with Hedera.
