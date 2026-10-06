import { describe, expect, it } from "vitest";
import { type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { Cbor, lookup_path, requestIdOf } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Secp256k1PublicKey } from "@dfinity/identity-secp256k1";
import { Principal } from "@dfinity/principal";
import {
  Account,
  C,
  ICP_MAINNET,
  ICP_METHODS,
  ICP_NETWORKS,
  ICP_TEST,
  LEDGERS,
  LegacyTransferArgs,
  TransferArg,
  TransferResult,
  accountIdFromHex,
  accountIdOf,
  accountIdentifier,
  callContent,
  candidDecode,
  candidEncode,
  cborDecode,
  derPublicKey,
  envelope,
  icrcAccountFromText,
  icrcAccountToText,
  lookup,
  named,
  parseRecipient,
  principalFromText,
  readStateContent,
  requestId,
  signDigest,
} from "../src/index.js";
import type { CborMap, CborValue } from "../src/cbor.js";
import { b64decode, fromHex, hex, utf8 } from "../src/util.js";
import { BOB, NOW, certificate, ctxFor, makeAccount, mockIc, module, signer } from "./helpers.js";
import { FIX } from "./signatures.js";

const TESTICP = LEDGERS.test[0]!;
/** @dfinity/agent 2.x takes ArrayBuffers. */
const ab = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;
const ckTESTBTC = LEDGERS.test[1]!;

// @dfinity/candid equivalents of the types in src/ledger.ts.
const dAccount = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
const dTransferArg = IDL.Record({
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: dAccount,
  amount: IDL.Nat,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  created_at_time: IDL.Opt(IDL.Nat64),
});
const dTransferError = IDL.Variant({
  BadFee: IDL.Record({ expected_fee: IDL.Nat }),
  BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
  TooOld: IDL.Null,
  CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
  TemporarilyUnavailable: IDL.Null,
  Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
  GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
});
const dTokens = IDL.Record({ e8s: IDL.Nat64 });
const dLegacyArgs = IDL.Record({
  memo: IDL.Nat64,
  amount: dTokens,
  fee: dTokens,
  from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
  to: IDL.Vec(IDL.Nat8),
  created_at_time: IDL.Opt(IDL.Record({ timestamp_nanos: IDL.Nat64 })),
});

describe("networks, principals and account ids", () => {
  it("mainnet and the test-token network, each with its ledgers", () => {
    expect(ICP_NETWORKS.map((n) => n.id)).toEqual(["icp:test", "icp:737ba355e855bd4b61279056603e0550"]);
    expect(ICP_TEST.testnet && !ICP_MAINNET.testnet).toBe(true);
    expect(ICP_MAINNET.nativeAsset).toMatchObject({ key: "icp", symbol: "ICP", decimals: 8 });
    expect(ICP_TEST.nativeAsset).toMatchObject({ key: "icp", symbol: "TESTICP", decimals: 8 });
    expect(LEDGERS.mainnet.map((l) => l.symbol)).toEqual(["ICP", "ckBTC", "ckUSDC", "ckETH"]);
    expect(LEDGERS.mainnet.filter((l) => l.bridged).map((l) => l.key)).toEqual(["ckbtc", "ckusdc", "cketh"]);
  });

  it("the abandon-about principal matches @dfinity (public key → DER → self-authenticating principal)", () => {
    expect(module.derivationPath(0)).toBe("m/44'/223'/0'/0/0");
    expect(module.curve).toBe("secp256k1");
    const pub = fromHex(FIX.publicKey);
    expect(module.addressFromPublicKey(pub, ICP_TEST)).toBe(FIX.me);
    const uncompressed = derPublicKey(pub).slice(-65);
    const dk = Secp256k1PublicKey.fromRaw(ab(uncompressed));
    expect(hex(derPublicKey(pub))).toBe(hex(new Uint8Array(dk.toDer())));
    expect(Principal.selfAuthenticating(new Uint8Array(dk.toDer())).toText()).toBe(FIX.me);
  });

  it("principal text round-trips with its checksum; account ids and ICRC-1 account text too", () => {
    expect(principalFromText(FIX.me)).not.toBeNull();
    expect(principalFromText(FIX.me.replace(/^t/, "u"))).toBeNull();
    expect(principalFromText("ryjl3-tyaaa-aaaaa-aaaba-cai")).toEqual(Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai").toUint8Array());
    // Vector from packages/vault: the anonymous principal's default account identifier.
    expect(hex(accountIdentifier(Uint8Array.of(4)))).toBe("1c7a48ba6a562aa9eaa2481a9049cdf0433b9738c992d698c31d8abf89cadc79");
    expect(accountIdOf(BOB)).toBe(FIX.bobAccountId);
    expect(accountIdFromHex(FIX.bobAccountId)).not.toBeNull();
    expect(accountIdFromHex(FIX.bobAccountId.replace(/^3/, "4"))).toBeNull();
    // ICRC-1 TextualEncoding.md examples.
    const owner = principalFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae")!;
    const sub = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    expect(icrcAccountToText({ owner, subaccount: sub })).toBe("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae-dfxgiyy.102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
    expect(icrcAccountFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae-6cc627i.01")).toBeNull();
    expect(icrcAccountFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae.1")).toBeNull();
    expect(icrcAccountFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae-q6bn32y.")).toBeNull();
    expect(icrcAccountFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae-6cc627i.1")?.subaccount?.[31]).toBe(1);
    expect(icrcAccountFromText("k2t6j-2nvnp-4zjm3-25dtz-6xhaa-c7boj-5gayf-oj3xs-i43lp-teztq-6ae-6cc627j.1")).toBeNull();
    expect(module.isAddress(FIX.me) && module.isAddress(FIX.bobAccountId)).toBe(true);
    expect(module.isAddress("0x" + FIX.bobAccountId)).toBe(false);
    expect(parseRecipient(FIX.bobAccountId)?.kind).toBe("accountId");
    expect(module.networksForAddress(FIX.bob, ICP_NETWORKS)).toHaveLength(2);
  });
});

describe("wire formats (cross-checked with @dfinity/agent and @dfinity/candid)", () => {
  it("request ids: the spec's example and @dfinity/agent requestIdOf", () => {
    const spec = callContent({ canisterId: fromHex("00000000000004d2"), method: "hello", arg: utf8("DIDL\x00\xfd*").slice(0, 7), sender: Uint8Array.of(4), ingressExpiry: 1685570400000000000n });
    // The spec's arg is the 7 bytes "DIDL", 0x00, 0xFD, "*".
    spec.arg = Uint8Array.of(0x44, 0x49, 0x44, 0x4c, 0x00, 0xfd, 0x2a);
    expect(hex(requestId(spec))).toBe("1d1091364d6bb8a6c16b203ee75467d59ead468f523eb058880ae8ec80e2b101");
    const call = callContent({ canisterId: principalFromText(TESTICP.canisterId)!, method: "icrc1_transfer", arg: utf8("DIDL"), sender: principalFromText(FIX.me)!, ingressExpiry: 1790000240000000000n, nonce: new Uint8Array(16).fill(7) });
    expect(hex(requestId(call))).toBe(hex(new Uint8Array(requestIdOf(call as never))));
    const rs = readStateContent({ requestId: requestId(call), sender: principalFromText(FIX.me)!, ingressExpiry: 1790000240000000000n });
    expect(hex(requestId(rs))).toBe(hex(new Uint8Array(requestIdOf(rs as never))));
  });

  it("Candid encoding equals IDL.encode; decoding reads IDL.encode's TransferResult", () => {
    const to = { owner: principalFromText(BOB)!, subaccount: [] };
    const arg = { from_subaccount: [], to, amount: 150000000n, fee: [10000n], memo: [], created_at_time: [1790000000000000000n] };
    const dArg = { ...arg, to: { owner: Principal.fromText(BOB), subaccount: [] } };
    expect(hex(candidEncode([TransferArg], [arg]))).toBe(hex(new Uint8Array(IDL.encode([dTransferArg], [dArg]))));
    expect(hex(candidEncode([Account], [to]))).toBe(hex(new Uint8Array(IDL.encode([dAccount], [{ owner: Principal.fromText(BOB), subaccount: [] }]))));
    const legacy = { memo: 0n, amount: { e8s: 150000000n }, fee: { e8s: 10000n }, from_subaccount: [], to: fromHex(FIX.bobAccountId), created_at_time: [{ timestamp_nanos: 1790000000000000000n }] };
    expect(hex(candidEncode([LegacyTransferArgs], [legacy]))).toBe(hex(new Uint8Array(IDL.encode([dLegacyArgs], [legacy]))));
    const ok = new Uint8Array(IDL.encode([IDL.Variant({ Ok: IDL.Nat, Err: dTransferError })], [{ Ok: 42n }]));
    expect(named(TransferResult, candidDecode(ok)[0]!)).toEqual({ Ok: 42n });
    const err = new Uint8Array(IDL.encode([IDL.Variant({ Ok: IDL.Nat, Err: dTransferError })], [{ Err: { GenericError: { error_code: 7n, message: "nope" } } }]));
    expect(named(TransferResult, candidDecode(err)[0]!)).toEqual({ Err: { GenericError: { error_code: 7n, message: "nope" } } });
    expect(named(C.nat8, candidDecode(new Uint8Array(IDL.encode([IDL.Nat8], [8])))[0]!)).toBe(8);
  });

  it("envelopes are CBOR @dfinity/agent reads back; certificate lookups agree with lookup_path", () => {
    const call = callContent({ canisterId: principalFromText(TESTICP.canisterId)!, method: "icrc1_transfer", arg: utf8("DIDL"), sender: principalFromText(FIX.me)!, ingressExpiry: 5n });
    const env = Cbor.decode<{ content: { method_name: string; ingress_expiry: unknown }; sender_sig: Uint8Array }>(ab(envelope(call, { publicKeyDer: derPublicKey(fromHex(FIX.publicKey)), signature: new Uint8Array(64).fill(1) })));
    expect(env.content.method_name).toBe("icrc1_transfer");
    expect(new Uint8Array(env.sender_sig)).toEqual(new Uint8Array(64).fill(1));
    const id = requestId(call);
    const cert = cborDecode(certificate(id, { status: utf8("replied"), reply: utf8("DIDL") })) as CborMap;
    const path = [utf8("request_status"), id, utf8("status")];
    expect(lookup(cert.tree as CborValue, path)).toEqual(utf8("replied"));
    const theirs = lookup_path(path.map(ab), Cbor.decode<{ tree: never }>(ab(certificate(id, { status: utf8("replied") }))).tree) as { status?: string; value?: Uint8Array } | Uint8Array;
    expect(new TextDecoder().decode(new Uint8Array((theirs as { value?: Uint8Array }).value ?? (theirs as Uint8Array)))).toBe("replied");
    expect(lookup(cert.tree as CborValue, [utf8("request_status"), new Uint8Array(32), utf8("status")])).toBe(null);
  });
});

function transferRequest(over: Partial<DappRequest> = {}, params: Record<string, unknown> = {}): DappRequest {
  return {
    id: "r1",
    origin: WALLET_ORIGIN,
    via: "injected",
    family: "icp",
    networkId: "icp:test",
    method: ICP_METHODS.callCanister,
    params: { canisterId: TESTICP.canisterId, sender: FIX.me, method: "icrc1_transfer", arg: "", ingressExpiry: String(BigInt(NOW + 240000) * 1000000n), ...params },
    ...over,
  };
}

const queries = { icrc1_fee: 10000n, icrc1_balance_of: 1000000000n };

describe("send (buildTransfer → decode → prepare → finalize)", () => {
  it("to a principal: plain words, two signatures, sent through the synchronous call endpoint", async () => {
    let callId: Uint8Array | undefined;
    const ok = new Uint8Array(IDL.encode([IDL.Variant({ Ok: IDL.Nat, Err: dTransferError })], [{ Ok: 1234n }]));
    const ic = mockIc({
      query: queries,
      call: (env) => {
        callId = requestId((env as CborMap).content as never);
        return { status: "replied", certificate: certificate(callId, { status: utf8("replied"), reply: ok }) };
      },
    });
    const ctx = ctxFor(ic.fetch);
    const r = await module.buildTransfer({ asset: ICP_TEST.nativeAsset, to: FIX.bob, amount: "150000000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: "icrc49_call_canister", params: { canisterId: TESTICP.canisterId, method: "icrc1_transfer", sender: FIX.me } });
    const d = await module.decode(r, ctx);
    expect(d.title).toBe("Send 1.5 TESTICP to mnnk5…yqe");
    expect(d.titleMsg?.id).toBe("bg.req.sendTo");
    expect(d.blind).toBe(false);
    expect(d.lines).toEqual([
      { label: "To", value: FIX.bob },
      { label: "Network fee", value: "0.0001 TESTICP" },
    ]);
    expect(d.balanceChanges).toEqual([{ asset: ICP_TEST.nativeAsset, delta: "-150010000" }]);
    expect(d.fee).toEqual({ asset: ICP_TEST.nativeAsset, amount: "10000" });
    const payloads = await module.prepare(r, ctx, "ap");
    expect(payloads.map((p) => [p.scheme, hex(p.bytes)])).toEqual(FIX.toPrincipalDigests.map((x) => ["ecdsa-secp256k1", x]));
    const out = (await module.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as Record<string, string>;
    expect(out).toMatchObject({ status: "replied", blockIndex: "1234", requestId: hex(callId!) });
    // The submitted envelope carries the DER key and the call signature; its content is what was decoded.
    const sent = ic.calls.find((c) => c.url.endsWith("/call"))!;
    expect(sent.url).toBe(`https://icp-api.io/api/v4/canister/${TESTICP.canisterId}/call`);
    const arg = named(TransferArg, candidDecode(sent.content.arg as Uint8Array)[0]!) as Record<string, unknown>;
    expect(arg).toMatchObject({ amount: 150000000n, fee: [10000n], created_at_time: [BigInt(NOW) * 1000000n] });
    expect(hex(signDigest(requestId(sent.content as never)))).toBe(FIX.toPrincipalDigests[0]);
  });

  it("to an exchange's account id: the ICP ledger's legacy transfer, with a note about account ids", async () => {
    const ok = new Uint8Array(IDL.encode([IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Variant({ TxCreatedInFuture: IDL.Null }) })], [{ Ok: 99n }]));
    let reads = 0;
    const ic = mockIc({
      query: queries,
      call: () => ({ status: 202 }),
      readState: (env) => {
        reads++;
        const c = (env as CborMap).content as CborMap;
        const id = ((c.paths as Uint8Array[][])[0]!)[1]!;
        return { certificate: certificate(id, reads < 2 ? { status: utf8("processing") } : { status: utf8("replied"), reply: ok }) };
      },
    });
    const ctx = ctxFor(ic.fetch);
    const r = await module.buildTransfer({ asset: ICP_TEST.nativeAsset, to: FIX.bobAccountId, amount: "150000000" }, ctx);
    expect((r.params as { method: string }).method).toBe("transfer");
    const d = await module.decode(r, ctx);
    expect(d.title).toBe("Send 1.5 TESTICP to 39837cd2…7a18");
    expect(d.warnings).toEqual([expect.objectContaining({ level: "info", code: "new-recipient", msg: expect.objectContaining({ id: "bg.icp.toAccountId" }) })]);
    const payloads = await module.prepare(r, ctx, "ap");
    expect(payloads.map((p) => hex(p.bytes))).toEqual([...FIX.toAccountIdDigests]);
    const out = await module.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    expect(out).toMatchObject({ status: "replied", blockIndex: "99" });
    expect(reads).toBe(2);
  });

  it("a bad signature is refused before anything is sent", async () => {
    const ic = mockIc({ query: queries, call: () => ({ status: 500 }) });
    const ctx = ctxFor(ic.fetch);
    const r = await module.buildTransfer({ asset: ICP_TEST.nativeAsset, to: FIX.bob, amount: "150000000" }, ctx);
    const sigs = (await module.prepare(r, ctx, "ap")).map((p) => signer.sign(p));
    await expect(module.finalize(r, [sigs[1]!, sigs[0]!], ctx)).rejects.toMatchObject({ code: "icp/bad-signature" });
    await expect(module.finalize(r, [sigs[0]!], ctx)).rejects.toMatchObject({ code: "icp/bad-signature" });
    const flipped = { ...sigs[0]!, bytes: Uint8Array.from(sigs[0]!.bytes, (b, i) => (i === 5 ? b ^ 1 : b)) };
    await expect(module.finalize(r, [flipped, sigs[1]!], ctx)).rejects.toMatchObject({ code: "icp/bad-signature" });
    expect(ic.calls.some((c) => c.url.endsWith("/call"))).toBe(false);
  });

  it("a ledger error comes back in plain words", async () => {
    const err = new Uint8Array(IDL.encode([IDL.Variant({ Ok: IDL.Nat, Err: dTransferError })], [{ Err: { InsufficientFunds: { balance: 5000n } } }]));
    const ic = mockIc({ query: queries, call: (env) => ({ status: "replied", certificate: certificate(requestId((env as CborMap).content as never), { status: utf8("replied"), reply: err }) }) });
    const ctx = ctxFor(ic.fetch);
    const r = await module.buildTransfer({ asset: ICP_TEST.nativeAsset, to: FIX.bob, amount: "150000000" }, ctx);
    const sigs = (await module.prepare(r, ctx, "ap")).map((p) => signer.sign(p));
    await expect(module.finalize(r, sigs, ctx)).rejects.toMatchObject({
      code: "icp/transfer-failed",
      userMessage: "You don't have enough TESTICP for this and its fee. Your balance is 0.00005 TESTICP. Nothing was sent.",
    });
  });

  it("refuses what it can't or shouldn't send", async () => {
    const ctx = ctxFor(mockIc({ query: queries }).fetch);
    const asset = ICP_TEST.nativeAsset;
    await expect(module.buildTransfer({ asset, to: FIX.me, amount: "1" }, ctx)).rejects.toMatchObject({ code: "icp/self-transfer" });
    await expect(module.buildTransfer({ asset, to: accountIdOf(FIX.me), amount: "1" }, ctx)).rejects.toMatchObject({ code: "icp/self-transfer" });
    await expect(module.buildTransfer({ asset, to: "not-a-principal", amount: "1" }, ctx)).rejects.toMatchObject({ code: "icp/bad-address" });
    await expect(module.buildTransfer({ asset, to: FIX.bob, amount: "0" }, ctx)).rejects.toMatchObject({ code: "icp/bad-amount" });
    await expect(module.buildTransfer({ asset, to: FIX.bob, amount: "999995000" }, ctx)).rejects.toMatchObject({ code: "icp/insufficient-funds" });
    const btc = { key: "ckbtc", symbol: "ckTESTBTC", name: "ckTESTBTC", decimals: 8, networkId: "icp:test", address: ckTESTBTC.canisterId };
    await expect(module.buildTransfer({ asset: btc, to: FIX.bobAccountId, amount: "1" }, ctx)).rejects.toMatchObject({ code: "icp/account-id-unsupported" });
  });

  it("refuses requests from sites, other networks, other accounts, unknown ledgers, unreadable or expired args", async () => {
    const ctx = ctxFor(mockIc({ query: queries }).fetch);
    const r = await module.buildTransfer({ asset: ICP_TEST.nativeAsset, to: FIX.bob, amount: "150000000" }, ctx);
    const p = r.params as Record<string, unknown>;
    await expect(module.decode({ ...r, origin: "https://app.example" }, ctx)).rejects.toMatchObject({ code: "icp/unsupported-method" });
    await expect(module.decode(r, ctxFor(ctx.fetch, ICP_MAINNET))).rejects.toMatchObject({ code: "icp/network-mismatch" });
    await expect(module.decode({ ...r, params: { ...p, sender: FIX.bob } }, ctx)).rejects.toMatchObject({ code: "icp/wrong-account" });
    await expect(module.decode({ ...r, params: { ...p, canisterId: LEDGERS.mainnet[0]!.canisterId } }, ctx)).rejects.toMatchObject({ code: "icp/unknown-ledger" });
    await expect(module.decode({ ...r, params: { ...p, method: "approve" } }, ctx)).rejects.toMatchObject({ code: "icp/unsupported-method" });
    await expect(module.decode(transferRequest({}, { arg: "RElETAAA" }), ctx)).rejects.toMatchObject({ code: "icp/bad-transaction" });
    const padded = new Uint8Array([...b64decode(p.arg as string), 0]);
    await expect(module.decode({ ...r, params: { ...p, arg: btoa(String.fromCharCode(...padded)) } }, ctx)).rejects.toMatchObject({ code: "icp/bad-transaction" });
    await expect(module.decode({ ...r, params: { ...p, ingressExpiry: String(BigInt(NOW - 1) * 1000000n) } }, ctx)).rejects.toMatchObject({ code: "icp/expired" });
  });
});

describe("balances", () => {
  it("TESTICP always, other ledgers only when held", async () => {
    const ic = mockIc({ query: { icrc1_balance_of: (arg) => (hex(arg).includes(hex(principalFromText(FIX.me)!)) ? 250000000n : 0n) } });
    const b = await module.getBalances(ctxFor(ic.fetch));
    expect(b).toEqual([{ asset: ICP_TEST.nativeAsset, amount: "250000000" }, ...LEDGERS.test.slice(1).map((l) => ({ asset: expect.objectContaining({ address: l.canisterId, bridged: true }), amount: "250000000" }))]);
    expect(ic.calls.every((c) => c.url.startsWith("https://icp-api.io/api/v3/canister/") && hex(c.content.sender as Uint8Array) === "04")).toBe(true);
    expect(makeAccount().address).toBe(FIX.me);
  });
});
