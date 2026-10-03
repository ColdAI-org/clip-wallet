/**
 * Cross-checks of the hand-written HAPI codec against the Hiero SDK (a devDependency, used only here and in
 * the other tests): every transaction the wallet builds must be byte-identical to what the SDK writes for the
 * same transaction id and nodes, and everything the wallet reads must agree with the SDK's own decoding.
 */
import type { DappRequest } from "@clip-wallet/core";
import { proto } from "@hiero-ledger/proto";
import {
  AccountAllowanceApproveTransaction,
  AccountDeleteTransaction,
  AccountId,
  AccountUpdateTransaction,
  Client,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  KeyList,
  NftId,
  PublicKey,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  TokenId,
  TopicMessageSubmitTransaction,
  Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { describe, expect, it } from "vitest";
import {
  aliasAddress,
  attachSignatures,
  bodiesToSign,
  contractCallDraft,
  createHederaModule,
  entityChecksum,
  freezeDraft,
  freezeIfNeeded,
  freezeNew,
  hbarAllowanceDraft,
  hbarAsset,
  parseTransaction,
  submitTransaction,
  tokenAllowanceDraft,
  verifyTransaction,
} from "../src/index.js";
import { accountIdString, transactionIdString } from "../src/ids.js";
import {
  BODY_NAME,
  decodeApproveAllowance,
  decodeBody,
  decodeContractCall,
  decodeCryptoTransfer,
  decodeCryptoUpdate,
  decodeScheduleCreate,
  encodeSchedulableBody,
  queryKind,
} from "../src/proto/hapi.js";
import { grpcWebFrame, parseGrpcWebResponse } from "../src/submit.js";
import { ecdsaPublicKey, serializeTransaction, signatureMapBase64 } from "../src/tx.js";
import { b64decode, b64encode, hex } from "../src/util.js";
import { ctxFor, makeAccount, mockFetch } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = "0.0.1001";
const BOB = "0.0.1234";
const SAUCE = { key: "hts:0.0.731861", symbol: "SAUCE", name: "SAUCE", decimals: 6, networkId: "hedera:testnet", address: "0.0.731861" };
const TX_ID = "0.0.1001@1790000000.123456789";
const NODES = ["0.0.3", "0.0.4", "0.0.5"];

const ctx = () => ctxFor(makeAccount(FIX.alicePublicKey, ME), mockFetch([]).fetch);
const listOf = (r: DappRequest) => b64decode((r.params as { transactionList: string }).transactionList);

/** Rebuilds `build()` with the SDK for the same transaction id and nodes as `mine`, and compares bytes. */
function expectSdkIdentical(mine: Uint8Array, build: () => Transaction) {
  const parsed = Transaction.fromBytes(mine);
  const sdk = build().setTransactionId(parsed.transactionId!).setNodeAccountIds(parsed.nodeAccountIds!).freeze();
  expect(hex(mine)).toBe(hex(sdk.toBytes()));
}

describe("builders are byte-identical to the SDK", () => {
  it("buildTransfer: HBAR to 0.0.x", async () => {
    const mine = listOf(await createHederaModule().buildTransfer({ asset: hbarAsset("hedera:testnet"), to: BOB, amount: "1000000000" }, ctx()));
    expect(parseTransaction(mine).entries.length).toBe(5);
    expectSdkIdentical(mine, () => new TransferTransaction().addHbarTransfer(ME, Hbar.fromTinybars(-1000000000)).addHbarTransfer(BOB, Hbar.fromTinybars(1000000000)));
  });

  it("buildTransfer: HBAR to a new EVM alias (HIP-583), and to a recipient that sorts first", async () => {
    const to = "0x1111111111111111111111111111111111111111";
    const mine = listOf(await createHederaModule().buildTransfer({ asset: hbarAsset("hedera:testnet"), to, amount: "5" }, ctx()));
    expectSdkIdentical(mine, () => new TransferTransaction().addHbarTransfer(ME, Hbar.fromTinybars(-5)).addHbarTransfer(AccountId.fromEvmAddress(0, 0, to), Hbar.fromTinybars(5)));
    const low = listOf(await createHederaModule().buildTransfer({ asset: hbarAsset("hedera:testnet"), to: "0.0.98", amount: "7" }, ctx()));
    expectSdkIdentical(low, () => new TransferTransaction().addHbarTransfer(ME, Hbar.fromTinybars(-7)).addHbarTransfer("0.0.98", Hbar.fromTinybars(7)));
  });

  it("buildTransfer: HTS token with expected decimals", async () => {
    const mine = listOf(await createHederaModule().buildTransfer({ asset: SAUCE, to: BOB, amount: "3000000" }, ctx()));
    expectSdkIdentical(mine, () => new TransferTransaction().addTokenTransferWithDecimals("0.0.731861", ME, -3000000, 6).addTokenTransferWithDecimals("0.0.731861", BOB, 3000000, 6));
  });

  it("buildNftTransfer", async () => {
    const mine = listOf(await createHederaModule().buildNftTransfer({ tokenId: "0.0.8888", serial: "7", to: BOB }, ctx()));
    expectSdkIdentical(mine, () => new TransferTransaction().addNftTransfer("0.0.8888", 7, ME, BOB));
  });

  it("buildAssociate / buildDissociate (one and several tokens)", async () => {
    const m = createHederaModule();
    expectSdkIdentical(listOf(await m.buildAssociate("0.0.731861", ctx())), () => new TokenAssociateTransaction().setAccountId(ME).setTokenIds(["0.0.731861"]));
    expectSdkIdentical(listOf(await m.buildAssociate(["0.0.731861", "0.0.429274"], ctx())), () =>
      new TokenAssociateTransaction().setAccountId(ME).setTokenIds(["0.0.731861", "0.0.429274"]),
    );
    expectSdkIdentical(listOf(await m.buildDissociate(["0.0.731861"], ctx())), () => new TokenDissociateTransaction().setAccountId(ME).setTokenIds(["0.0.731861"]));
  });

  it("buildStakeUpdate: node, account, stop, decline rewards", async () => {
    const m = createHederaModule();
    expectSdkIdentical(listOf(await m.buildStakeUpdate({ nodeId: 3 }, ctx())), () => new AccountUpdateTransaction().setAccountId(ME).setStakedNodeId(3));
    expectSdkIdentical(listOf(await m.buildStakeUpdate({ nodeId: 0 }, ctx(), false)), () => new AccountUpdateTransaction().setAccountId(ME).setStakedNodeId(0).setDeclineStakingReward(false));
    expectSdkIdentical(listOf(await m.buildStakeUpdate({ accountId: "0.0.800" }, ctx())), () => new AccountUpdateTransaction().setAccountId(ME).setStakedAccountId("0.0.800"));
    expectSdkIdentical(listOf(await m.buildStakeUpdate({ stop: true }, ctx(), true)), () => new AccountUpdateTransaction().setAccountId(ME).clearStakedNodeId().setDeclineStakingReward(true));
  });

  it("buildAtomicSwap direct: HBAR ⇄ token, 180 s validity, memo", async () => {
    const r = await createHederaModule().buildAtomicSwap(
      { give: { asset: hbarAsset("hedera:testnet"), amount: "1000000000" }, get: { asset: SAUCE, amount: "5000000" }, counterparty: BOB, memo: "swap #1" },
      ctx(),
    );
    expectSdkIdentical(listOf(r), () =>
      new TransferTransaction()
        .addHbarTransfer(ME, Hbar.fromTinybars(-1000000000))
        .addHbarTransfer(BOB, Hbar.fromTinybars(1000000000))
        .addTokenTransferWithDecimals("0.0.731861", BOB, -5000000, 6)
        .addTokenTransferWithDecimals("0.0.731861", ME, 5000000, 6)
        .setTransactionMemo("swap #1")
        .setTransactionValidDuration(180),
    );
  });

  it("buildAtomicSwap direct: NFT ⇄ token and NFT ⇄ NFT in one transfer list", async () => {
    const r = await createHederaModule().buildAtomicSwap({ give: { nft: { tokenId: "0.0.8888", serial: 7 } }, get: { asset: SAUCE, amount: "1" }, counterparty: BOB }, ctx());
    expectSdkIdentical(listOf(r), () =>
      new TransferTransaction()
        .addNftTransfer("0.0.8888", 7, ME, BOB)
        .addTokenTransferWithDecimals("0.0.731861", BOB, -1, 6)
        .addTokenTransferWithDecimals("0.0.731861", ME, 1, 6)
        .setTransactionValidDuration(180),
    );
    const n = await createHederaModule().buildAtomicSwap({ give: { nft: { tokenId: "0.0.8888", serial: 7 } }, get: { nft: { tokenId: "0.0.8888", serial: 9 } }, counterparty: BOB }, ctx());
    expectSdkIdentical(listOf(n), () => new TransferTransaction().addNftTransfer("0.0.8888", 7, ME, BOB).addNftTransfer("0.0.8888", 9, BOB, ME).setTransactionValidDuration(180));
  });

  it("buildAtomicSwap scheduled: ScheduleCreate with inner transfer, payer, memo, expiry", async () => {
    const expiresAt = new Date("2026-12-01T10:20:30.456Z");
    const r = await createHederaModule().buildAtomicSwap(
      { give: { nft: { tokenId: "0.0.8888", serial: 7 } }, get: { asset: hbarAsset("hedera:testnet"), amount: "2500000000" }, counterparty: BOB, schedule: { memo: "trade", expiresAt } },
      ctx(),
    );
    expectSdkIdentical(listOf(r), () =>
      new ScheduleCreateTransaction()
        .setScheduledTransaction(new TransferTransaction().addNftTransfer("0.0.8888", 7, ME, BOB).addHbarTransfer(BOB, Hbar.fromTinybars(-2500000000)).addHbarTransfer(ME, Hbar.fromTinybars(2500000000)))
        .setPayerAccountId(AccountId.fromString(ME))
        .setScheduleMemo("trade")
        .setExpirationTime(Timestamp.fromDate(expiresAt))
        .setWaitForExpiry(false),
    );
    const plain = await createHederaModule().buildAtomicSwap({ give: { asset: SAUCE, amount: "1" }, get: { asset: hbarAsset("hedera:testnet"), amount: "2" }, counterparty: BOB, schedule: {}, memo: "m" }, ctx());
    expectSdkIdentical(listOf(plain), () =>
      new ScheduleCreateTransaction()
        .setScheduledTransaction(
          new TransferTransaction()
            .addTokenTransferWithDecimals("0.0.731861", ME, -1, 6)
            .addTokenTransferWithDecimals("0.0.731861", BOB, 1, 6)
            .addHbarTransfer(BOB, Hbar.fromTinybars(-2))
            .addHbarTransfer(ME, Hbar.fromTinybars(2))
            .setTransactionMemo("m"),
        )
        .setPayerAccountId(AccountId.fromString(ME)),
    );
  });

  it("buildScheduleSign", async () => {
    expectSdkIdentical(listOf(await createHederaModule().buildScheduleSign("0.0.7777", ctx())), () => new ScheduleSignTransaction().setScheduleId("0.0.7777"));
  });

  it("drafts for features: contract call (SaucerSwap), token and HBAR allowances", () => {
    const opts = { payer: ME, ledger: "testnet" as const, nodes: NODES, validStart: { seconds: 1790000000n, nanos: 5 } };
    const data = Uint8Array.from([0x41, 0x4b, 0xf3, 0x89, 1, 2, 3]);
    expectSdkIdentical(freezeDraft(contractCallDraft({ contractId: "0.0.1414040", gas: 300000, functionParameters: data, payableTinybars: 10n ** 10n }), opts), () =>
      new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.1414040")).setGas(300000).setFunctionParameters(data).setPayableAmount(Hbar.fromTinybars(10 ** 10)),
    );
    expectSdkIdentical(freezeDraft(contractCallDraft({ contractId: "0.0.1414040", gas: 400000, functionParameters: data }), opts), () =>
      new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.1414040")).setGas(400000).setFunctionParameters(data),
    );
    expectSdkIdentical(freezeDraft(tokenAllowanceDraft({ tokenId: "0.0.731861", owner: ME, spender: "0.0.1414040", amount: 123456 }), opts), () =>
      new AccountAllowanceApproveTransaction().approveTokenAllowance("0.0.731861", ME, AccountId.fromString("0.0.1414040"), 123456),
    );
    expectSdkIdentical(freezeDraft(hbarAllowanceDraft({ owner: ME, spender: BOB, tinybars: 99 }), opts), () =>
      new AccountAllowanceApproveTransaction().approveHbarAllowance(ME, BOB, Hbar.fromTinybars(99)),
    );
  });

  it("HIP-745: an unfrozen SDK transaction is frozen like freezeWith (same id and nodes)", () => {
    const unfrozen = () => new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.5555")).setGas(100000).setFunctionParameters(Uint8Array.from([1, 2]));
    const mine = freezeIfNeeded(unfrozen().toBytes(), { payer: ME, ledger: "testnet", nodes: NODES, validStart: { seconds: 1790000000n, nanos: 42 } });
    expectSdkIdentical(mine, unfrozen);
    // the old call shape: an unfrozen SDK transaction handed to freezeNew
    const viaFreezeNew = freezeNew(new TokenAssociateTransaction().setAccountId(ME).setTokenIds(["0.0.1"]), ME, ctx());
    expectSdkIdentical(viaFreezeNew, () => new TokenAssociateTransaction().setAccountId(ME).setTokenIds(["0.0.1"]));
    // already frozen: untouched
    expect(hex(freezeIfNeeded(b64decode(FIX.transferList), { payer: ME, ledger: "testnet" }))).toBe(hex(b64decode(FIX.transferList)));
  });
});

describe("reading agrees with the SDK", () => {
  const frozenSdk = <T extends Transaction>(tx: T, payer = ME): T => tx.setTransactionId(TransactionId.fromString(TX_ID.replace(ME, payer))).setNodeAccountIds(NODES.map((n) => AccountId.fromString(n))).freeze();

  it("re-encoding a frozen list is the identity, and the header fields match", () => {
    const tx = frozenSdk(new TransferTransaction().addHbarTransfer(ME, new Hbar(-1)).addHbarTransfer(BOB, new Hbar(1)).setTransactionMemo("hi").setMaxTransactionFee(new Hbar(3)));
    const bytes = tx.toBytes();
    const p = parseTransaction(bytes);
    expect(hex(serializeTransaction(p.entries))).toBe(hex(bytes));
    expect(p.frozen).toBe(true);
    expect(transactionIdString(p.body.transactionId!)).toBe(tx.transactionId!.toString());
    expect(p.entries.map((e) => accountIdString(e.body.nodeAccountId!))).toEqual(tx.nodeAccountIds!.map(String));
    expect(p.body.fee).toBe(300000000n);
    expect(p.body.memo).toBe("hi");
    expect(p.body.validDuration).toBe(120n);
    expect(BODY_NAME.get(p.body.kind)).toBe("cryptoTransfer");
  });

  it("transfers: hbar, approved token legs, NFTs, decimals", () => {
    const tx = frozenSdk(
      new TransferTransaction()
        .addHbarTransfer(ME, Hbar.fromTinybars(-5))
        .addApprovedHbarTransfer(BOB, Hbar.fromTinybars(5))
        .addApprovedTokenTransfer("0.0.731861", BOB, -10)
        .addTokenTransferWithDecimals("0.0.429274", ME, 10, 6)
        .addTokenTransferWithDecimals("0.0.429274", BOB, -10, 6)
        .addApprovedNftTransfer(new NftId(TokenId.fromString("0.0.8888"), 3), BOB, ME),
    );
    const t = decodeCryptoTransfer(parseTransaction(tx.toBytes()).body.data);
    expect(t.hbar.map((a) => [accountIdString(a.accountId!), a.amount, a.isApproval])).toEqual(
      tx.hbarTransfersList.map((a) => [a.accountId.toString(), BigInt(a.amount.toTinybars().toString()), a.isApproved]),
    );
    const sdkTokens = tx.tokenTransfers;
    const fungible = t.tokens.flatMap((l) => l.transfers.map((a) => [accountIdString(l.token ? { ...l.token } : { shard: 0n, realm: 0n }), accountIdString(a.accountId!), a.amount, a.isApproval, l.expectedDecimals ?? null]));
    expect(fungible).toEqual([
      ["0.0.429274", ME, 10n, false, 6],
      ["0.0.429274", BOB, -10n, false, 6],
      ["0.0.731861", BOB, -10n, true, null],
    ]);
    expect(sdkTokens.get("0.0.731861")?.get(BOB)?.toString()).toBe("-10");
    const nft = t.tokens.flatMap((l) => l.nfts)[0]!;
    expect([accountIdString(nft.sender!), accountIdString(nft.receiver!), nft.serial, nft.isApproval]).toEqual([BOB, ME, 3n, true]);
  });

  it("allowances, contract call, account update, schedule create", () => {
    const allow = frozenSdk(
      new AccountAllowanceApproveTransaction()
        .approveHbarAllowance(ME, BOB, new Hbar(4))
        .approveTokenAllowance("0.0.731861", ME, BOB, 77)
        .approveTokenNftAllowance(new NftId(TokenId.fromString("0.0.8888"), 2), ME, BOB)
        .approveTokenNftAllowanceAllSerials("0.0.9999", ME, BOB),
    );
    const a = decodeApproveAllowance(parseTransaction(allow.toBytes()).body.data);
    expect(a.hbar.map((x) => [accountIdString(x.owner!), accountIdString(x.spender!), x.amount])).toEqual([[ME, BOB, 400000000n]]);
    expect(a.token.map((x) => [accountIdString(x.spender!), x.amount])).toEqual([[BOB, 77n]]);
    expect(a.nft.map((x) => [x.serials, x.approvedForAll ?? null])).toEqual([
      [[2n], null],
      [[], true],
    ]);

    const call = frozenSdk(new ContractExecuteTransaction().setContractId(ContractId.fromString("0.0.5555")).setGas(21000).setPayableAmount(Hbar.fromTinybars(9)).setFunctionParameters(Uint8Array.from([9, 8])));
    const c = decodeContractCall(parseTransaction(call.toBytes()).body.data);
    expect([accountIdString({ ...c.contractId!, alias: undefined }), c.gas, c.amount, [...c.params]]).toEqual(["0.0.5555", 21000n, 9n, [9, 8]]);

    const upd = frozenSdk(
      new AccountUpdateTransaction()
        .setAccountId(ME)
        .setStakedAccountId("0.0.800")
        .setDeclineStakingReward(true)
        .setMaxAutomaticTokenAssociations(-1)
        .setAccountMemo("note")
        .setReceiverSignatureRequired(true)
        .setKey(new KeyList([PublicKey.fromStringECDSA(FIX.alicePublicKey)])),
    );
    const u = decodeCryptoUpdate(parseTransaction(upd.toBytes()).body.data);
    expect(u).toMatchObject({ hasKey: true, declineReward: true, maxAutoAssociations: -1, memo: "note", receiverSigRequired: true });
    expect(accountIdString(u.stakedAccount!)).toBe("0.0.800");
    expect(u.stakedNode).toBeUndefined();

    const sched = frozenSdk(new ScheduleCreateTransaction().setScheduledTransaction(new TokenAssociateTransaction().setAccountId(BOB).setTokenIds(["0.0.1"])).setScheduleMemo("x"));
    const s = decodeScheduleCreate(parseTransaction(sched.toBytes()).body.data);
    const inner = decodeBody(s.scheduled!, true);
    expect([BODY_NAME.get(inner.kind), inner.fee, s.memo]).toEqual(["tokenAssociate", 500000000n, "x"]);
  });

  it("SchedulableTransactionBody: our encoding matches the SDK's protobufs for the inner transfer", () => {
    const transfer = new TransferTransaction().addHbarTransfer(ME, Hbar.fromTinybars(-1)).addHbarTransfer(BOB, Hbar.fromTinybars(1));
    const sdkInner = proto.SchedulableTransactionBody.encode(
      (transfer as unknown as { _getScheduledTransactionBody(): proto.ISchedulableTransactionBody })._getScheduledTransactionBody(),
    ).finish();
    const body = decodeBody(sdkInner, true);
    expect(hex(encodeSchedulableBody({ fee: body.fee!, memo: body.memo!, kind: body.kind, data: body.data }))).toBe(hex(sdkInner));
  });

  it("every TransactionBody / SchedulableTransactionBody / Query case number matches the generated protobufs", () => {
    for (const [n, name] of BODY_NAME) {
      expect([name, decodeBody(proto.TransactionBody.encode({ [name]: {} } as proto.ITransactionBody).finish()).kind]).toEqual([name, n]);
    }
    const sched = proto.SchedulableTransactionBody.encode({ cryptoTransfer: {} }).finish();
    expect(BODY_NAME.get(decodeBody(sched, true).kind)).toBe("cryptoTransfer");
    for (const name of ["cryptogetAccountBalance", "cryptoGetInfo", "tokenGetInfo", "transactionGetReceipt", "accountDetails"]) {
      expect(queryKind(proto.Query.encode({ [name]: {} } as proto.IQuery).finish())).toBe(name);
    }
  });

  it("AccountDelete and TopicMessageSubmit decode (described) like the SDK sees them", async () => {
    const m = createHederaModule();
    const del = frozenSdk(new AccountDeleteTransaction().setAccountId(ME).setTransferAccountId(BOB));
    const d = await m.decode({ id: "1", origin: "https://x", via: "walletconnect", family: "hedera", networkId: "hedera:testnet", method: "hedera_signAndExecuteTransaction", params: { signerAccountId: `hedera:testnet:${ME}`, transactionList: b64encode(del.toBytes()) } }, ctx());
    expect(d.title).toBe(`Close account ${ME} and send what's left to ${BOB}`);
    const topic = frozenSdk(new TopicMessageSubmitTransaction().setTopicId("0.0.42").setMessage("gm"));
    const t = await m.decode({ id: "2", origin: "https://x", via: "walletconnect", family: "hedera", networkId: "hedera:testnet", method: "hedera_signAndExecuteTransaction", params: { signerAccountId: `hedera:testnet:${ME}`, transactionList: b64encode(topic.toBytes()) } }, ctx());
    expect(t.title).toBe("Post a message to topic 0.0.42");
    expect(t.lines[0]).toEqual({ label: "Message", value: "gm" });
  });
});

describe("signatures agree with the SDK", () => {
  const sigFor = (pkHex: string, sigs: readonly string[]) => {
    const pk = PublicKey.fromStringECDSA(pkHex);
    return async (body: Uint8Array) => {
      const s = sigs.map((x) => Uint8Array.from(x.match(/../g)!.map((h) => parseInt(h, 16)))).find((sig) => pk.verify(body, sig));
      if (!s) throw new Error("no fixture signature");
      return s;
    };
  };

  it("attaching fixture signatures gives the SDK's signWith bytes, and a second signer stacks the same way", async () => {
    const alice = ecdsaPublicKey(FIX.alicePublicKey);
    const bob = ecdsaPublicKey(FIX.bobPublicKey);
    const raw = b64decode(FIX.tradeList);
    const bodies = bodiesToSign(raw, alice);
    expect(bodies).toHaveLength(3);
    const aliceSigs = await Promise.all(bodies.map(sigFor(FIX.alicePublicKey, FIX.tradeSigsAlice)));
    const mine = attachSignatures(raw, alice, aliceSigs.reverse());
    const sdk = await Transaction.fromBytes(raw).signWith(PublicKey.fromStringECDSA(FIX.alicePublicKey), sigFor(FIX.alicePublicKey, FIX.tradeSigsAlice));
    expect(hex(mine)).toBe(hex(sdk.toBytes()));
    expect(bodiesToSign(mine, alice)).toEqual([]);

    const bobSigs = await Promise.all(bodiesToSign(mine, bob).map(sigFor(FIX.bobPublicKey, FIX.tradeSigsBob)));
    const both = attachSignatures(mine, bob, bobSigs);
    const sdkBoth = await Transaction.fromBytes(sdk.toBytes()).signWith(PublicKey.fromStringECDSA(FIX.bobPublicKey), sigFor(FIX.bobPublicKey, FIX.tradeSigsBob));
    expect(hex(both)).toBe(hex(sdkBoth.toBytes()));
    expect(verifyTransaction(both, alice) && verifyTransaction(both, bob)).toBe(true);
    expect(PublicKey.fromStringECDSA(FIX.bobPublicKey).verifyTransaction(Transaction.fromBytes(both))).toBe(true);
    expect(() => attachSignatures(raw, alice, bobSigs)).toThrow(/missing signature/);
  });

  it("SignatureMap result matches the SDK protobuf encoding", () => {
    const sig = Uint8Array.from(FIX.messageSigAlice.match(/../g)!.map((h) => parseInt(h, 16)));
    const pk = ecdsaPublicKey(FIX.alicePublicKey);
    const sdk = proto.SignatureMap.encode({ sigPair: [{ pubKeyPrefix: PublicKey.fromStringECDSA(FIX.alicePublicKey).toBytesRaw(), ECDSASecp256k1: sig }] }).finish();
    expect(signatureMapBase64(pk, sig)).toBe(b64encode(sdk));
  });

  it("EVM alias and HIP-15 checksums match the SDK on every network", () => {
    for (const k of [FIX.alicePublicKey, FIX.bobPublicKey]) expect(aliasAddress(k)).toBe(`0x${PublicKey.fromStringECDSA(k).toEvmAddress()}`);
    const ledgers = [
      ["mainnet", 0],
      ["testnet", 1],
      ["previewnet", 2],
    ] as const;
    for (const [name, id] of ledgers) {
      const c = Client.forName(name, { scheduleNetworkUpdate: false });
      try {
        for (const acct of ["0.0.1", "0.0.3", "0.0.98", "0.0.1234", "0.0.4815162", "1.2.3456789", "0.0.123456789012"]) {
          expect(`${acct}-${entityChecksum(id, acct)}`).toBe(AccountId.fromString(acct).toStringWithChecksum(c));
        }
      } finally {
        c.close();
      }
    }
  });
});

describe("gRPC-Web submit", () => {
  const OK = (code = 0) => {
    const msg = proto.TransactionResponse.encode({ nodeTransactionPrecheckCode: code }).finish();
    const trailer = new TextEncoder().encode("grpc-status:0\r\ngrpc-message:\r\n");
    const t = new Uint8Array(trailer.length + 5);
    t[0] = 0x80;
    new DataView(t.buffer).setUint32(1, trailer.length);
    t.set(trailer, 5);
    return new Uint8Array([...grpcWebFrame(msg), ...t]);
  };

  it("frames the request like the SDK's WebChannel, retries BUSY on the next node, returns the SDK's response JSON", async () => {
    const signed = b64decode(FIX.transferList);
    const calls: { url: string; body: Uint8Array; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as Uint8Array, headers: init.headers as Record<string, string> });
      return new Response(OK(calls.length === 1 ? 12 : 0), { status: 200, headers: { "content-type": "application/grpc-web+proto" } });
    }) as unknown as typeof fetch;
    const res = await submitTransaction(signed, "testnet", { fetch: fetchImpl });

    const sdkTx = Transaction.fromBytes(signed);
    const list = proto.TransactionList.decode(signed).transactionList;
    expect(calls.map((c) => c.url)).toEqual([
      "https://testnet-node00-00-grpc.hedera.com:443/proto.CryptoService/cryptoTransfer",
      "https://testnet-node01-00-grpc.hedera.com:443/proto.CryptoService/cryptoTransfer",
    ]);
    expect(calls[0]!.headers).toMatchObject({ "content-type": "application/grpc-web+proto", "x-grpc-web": "1" });
    const sdkFrame = proto.Transaction.encode({ signedTransactionBytes: list[1]!.signedTransactionBytes! }).finish();
    expect(hex(calls[1]!.body)).toBe(`00${sdkFrame.length.toString(16).padStart(8, "0")}${hex(sdkFrame)}`);
    const hashes = await sdkTx.getTransactionHashPerNode();
    expect(res).toEqual({ nodeId: "0.0.4", transactionHash: hex(hashes.get(AccountId.fromString("0.0.4"))!), transactionId: sdkTx.transactionId!.toString() });
  });

  it("a failing precheck becomes a plain error; an unsupported type is refused", async () => {
    const fetchImpl = (async () => new Response(OK(10), { status: 200 })) as unknown as typeof fetch;
    await expect(submitTransaction(b64decode(FIX.transferList), "testnet", { fetch: fetchImpl })).rejects.toMatchObject({ status: "INSUFFICIENT_PAYER_BALANCE" });
    const m = createHederaModule();
    const req: DappRequest = { id: "x", origin: "https://x", via: "walletconnect", family: "hedera", networkId: "hedera:testnet", method: "hedera_executeTransaction", params: { transactionList: FIX.transferList } };
    const c = ctxFor(makeAccount(FIX.alicePublicKey, ME), fetchImpl);
    await expect(m.finalize(req, [], c)).rejects.toThrow("You don't have enough HBAR to pay the network fee.");
  });

  it("parses data + trailer frames", () => {
    const p = parseGrpcWebResponse(OK(7));
    expect(p.status).toBe(0);
    expect(proto.TransactionResponse.decode(p.message!).nodeTransactionPrecheckCode).toBe(7);
  });

  it("every RPC name exists on the generated service clients", async () => {
    const services = proto as unknown as Record<string, { prototype: Record<string, unknown> }>;
    const rpc = (await import("node:fs")).readFileSync(new URL("../src/submit.ts", import.meta.url), "utf8").match(/"(\w+Service)\/(\w+)"/g)!;
    expect(rpc.length).toBeGreaterThan(40);
    for (const r of rpc) {
      const [svc, method] = r.slice(1, -1).split("/");
      expect(typeof services[svc!]?.prototype[method!], r).toBe("function");
    }
  });
});

describe.runIf(process.env.LIVE === "1")("live testnet gRPC-Web (no signatures, so nothing can execute)", () => {
  it("an unsigned transfer reaches a node and is refused at precheck", async () => {
    const list = freezeDraft(
      { kind: 14, data: decodeBody(parseTransaction(b64decode(FIX.transferList)).entries[0]!.bodyBytes).data },
      { payer: ME, ledger: "testnet", nodes: ["0.0.3", "0.0.4", "0.0.5"] },
    );
    await expect(submitTransaction(list, "testnet", { timeoutMs: 20_000 })).rejects.toMatchObject({ status: expect.stringMatching(/SIGNATURE|PAYER/) });
  }, 90_000);
});


describe("runtime has no SDK", () => {
  it("no file under src/ imports @hiero-ledger/* or @hashgraph/*", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const root = new URL("../src/", import.meta.url);
    const files = readdirSync(root, { recursive: true }).map(String).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(new URL(f, root), "utf8"), f).not.toMatch(/from\s+["'](@hiero-ledger|@hashgraph)\//);
  });
});
