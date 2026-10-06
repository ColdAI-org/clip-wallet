import { ClipError, type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { encodeMessage, hashMessage, verifyMessageSignatureRsv } from "@stacks/encryption";
import {
  AuthType,
  Cl,
  Pc,
  PostConditionMode,
  deserializeTransaction,
  encodeStructuredDataBytes,
  getAddressFromPublicKey,
  makeUnsignedContractCall,
  makeUnsignedContractDeploy,
  makeUnsignedSTXTokenTransfer,
  postConditionToHex,
  sigHashPreSign,
} from "@stacks/transactions";
import { sha256 } from "@noble/hashes/sha2.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { describe, expect, it } from "vitest";
import {
  STACKS_METHODS,
  STACKS_NETS,
  createStacksModule,
  cvFrom,
  deserializeTx,
  initialSighash,
  messageHash,
  netOf,
  originPresignDigest,
  parseAddress,
  postConditionFrom,
  serializeCV,
  serializeTx,
  structuredHash,
  tokenAsset,
  txidOf,
  withOriginSignature,
} from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { ACCOUNT, FEES, NONCES, STACKS_MAINNET, STACKS_TESTNET, ctxFor, mockFetch, reply, signer } from "./helpers.js";
import { FIX } from "./signatures.js";

const API = STACKS_NETS.testnet.api.replace(/\./g, "\\.");
const ME = FIX.testnet;
const OTHER = FIX.otherTestnet;
const mod = createStacksModule();

const req = (method: string, params: unknown, extra: Partial<DappRequest> = {}): DappRequest => ({
  id: `r-${Math.random().toString(36).slice(2)}`,
  origin: "https://app.example",
  via: "injected",
  family: "stacks",
  networkId: STACKS_TESTNET.id,
  method,
  params,
  ...extra,
});

function routes(over: [RegExp, unknown][] = []) {
  return mockFetch([
    ...over,
    [new RegExp(`${API}/extended/v1/address/${ME}/nonces`), NONCES(7)],
    [new RegExp(`${API}/v2/accounts/${ME}`), ACCOUNT(5_000_000n, 7)],
    [new RegExp(`${API}/v2/fees/transaction`), FEES],
    [new RegExp(`${API}/metadata/v1/ft/`), reply(404, { error: "not found" })],
  ] as [RegExp, unknown][]);
}

/** Runs decode → prepare → (fixture) sign → finalize. */
async function run(r: DappRequest, ctx = ctxFor(routes().fetch)) {
  const d = await mod.decode(r, ctx);
  const payloads = await mod.prepare(r, ctx, "approval-1");
  const sigs = payloads.map((p) => signer.sign(p));
  const result = await mod.finalize(r, sigs, ctx);
  return { d, payloads, result };
}

describe("addresses and networks", () => {
  it("derives the SP/ST addresses of the abandon vector, as stacks.js does", () => {
    const pub = fromHex(FIX.publicKey);
    expect(mod.addressFromPublicKey(pub, STACKS_MAINNET)).toBe(FIX.mainnet);
    expect(mod.addressFromPublicKey(pub, STACKS_TESTNET)).toBe(FIX.testnet);
    expect(getAddressFromPublicKey(FIX.publicKey, "mainnet")).toBe(FIX.mainnet);
    expect(getAddressFromPublicKey(FIX.publicKey, "testnet")).toBe(FIX.testnet);
    // an uncompressed key gives the same (compressed-key P2PKH) address
    expect(mod.addressFromPublicKey(secp256k1.Point.fromHex(FIX.publicKey).toBytes(false), STACKS_MAINNET)).toBe(FIX.mainnet);
    expect(mod.derivationPath(3)).toBe("m/44'/5757'/0'/0/3");
    expect(mod.curve).toBe("secp256k1");
  });

  it("checks c32check checksums and spells network per version", () => {
    expect(mod.isAddress(FIX.mainnet)).toBe(true);
    expect(mod.isAddress(`${FIX.testnet}.my-contract`)).toBe(true);
    expect(mod.isAddress(FIX.mainnet.slice(0, -1) + (FIX.mainnet.endsWith("J") ? "K" : "J"))).toBe(false);
    expect(mod.isAddress("0x1234")).toBe(false);
    expect(parseAddress(FIX.mainnet)?.version).toBe(22);
    expect(parseAddress(FIX.testnet)?.version).toBe(26);
    // leading zero bytes in the hash shorten the address (the testnet boot address)
    expect(parseAddress("ST000000000000000000002AMW42H")?.hash160).toEqual(new Uint8Array(20));
    expect(mod.isAddress("SP000000000000000000002Q6VF78")).toBe(true);
    expect(mod.isAddress("ST000000000000000000002AMW42J")).toBe(false);
    expect(mod.networksForAddress(FIX.mainnet, [STACKS_TESTNET, STACKS_MAINNET]).map((n) => n.id)).toEqual(["stacks:1"]);
    expect(mod.networksForAddress(FIX.testnet, [STACKS_TESTNET, STACKS_MAINNET]).map((n) => n.id)).toEqual(["stacks:2147483648"]);
  });

  it("uses the CAIP-2 ids of the ChainAgnostic stacks namespace", async () => {
    expect(STACKS_MAINNET.id).toBe("stacks:1");
    expect(STACKS_TESTNET.id).toBe("stacks:2147483648");
    expect(netOf("testnet")).toBe("testnet");
    expect(netOf(1)).toBe("mainnet");
    expect(await mod.receiveAddress(ctxFor(routes().fetch))).toBe(FIX.testnet);
    expect(await mod.receiveAddress(ctxFor(routes().fetch, STACKS_MAINNET))).toBe(FIX.mainnet);
  });
});

describe("serialization matches @stacks/transactions", () => {
  it("STX transfer with memo, its sighash and presign digest", async () => {
    const theirs = await makeUnsignedSTXTokenTransfer({ recipient: OTHER, amount: 12345n, memo: "hello", fee: 300n, nonce: 9n, publicKey: FIX.publicKey, network: "testnet" });
    const ours = deserializeTx(theirs.serializeBytes());
    expect(hex(serializeTx(ours))).toBe(theirs.serialize());
    expect(hex(initialSighash(ours))).toBe(theirs.signBegin());
    expect(hex(originPresignDigest(ours))).toBe(sigHashPreSign(theirs.signBegin(), AuthType.Standard, 300n, 9n));
    expect(hex(txidOf(ours))).toBe(theirs.txid());
  });

  it("contract call with Clarity args and every post-condition kind", async () => {
    const pcs = [
      Pc.principal(ME).willSendEq(1000n).ustx(),
      Pc.principal(ME).willSendLte(5n).ft("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx", "usdcx-token"),
      Pc.principal(`${OTHER}.pool`).willSendGte(1n).ft("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx", "usdcx-token"),
      Pc.principal(ME).willNotSendAsset().nft(`${OTHER}.nfts::nft`, Cl.uint(7)),
    ];
    const theirs = await makeUnsignedContractCall({
      contractAddress: OTHER,
      contractName: "pool",
      functionName: "swap-x-for-y",
      functionArgs: [
        Cl.uint(1000),
        Cl.int(-5),
        Cl.principal(ME),
        Cl.contractPrincipal(OTHER, "token-x"),
        Cl.some(Cl.bufferFromUtf8("memo")),
        Cl.none(),
        Cl.list([Cl.bool(true), Cl.bool(false)]),
        Cl.tuple({ b: Cl.stringUtf8("héllo"), a: Cl.stringAscii("hi"), c: Cl.ok(Cl.uint(1)), d: Cl.error(Cl.int(2)) }),
      ],
      postConditions: pcs,
      postConditionMode: PostConditionMode.Deny,
      fee: 2000n,
      nonce: 3n,
      publicKey: FIX.publicKey,
      network: "testnet",
    });
    const ours = deserializeTx(theirs.serializeBytes());
    expect(hex(serializeTx(ours))).toBe(theirs.serialize());
    expect(hex(originPresignDigest(ours))).toBe(sigHashPreSign(theirs.signBegin(), AuthType.Standard, 2000n, 3n));
    // post-conditions from stacks.js hex and from SIP-030 JSON give the same bytes
    for (const pc of pcs) expect(postConditionFrom(postConditionToHex(pc))).toEqual(postConditionFrom(pc));
    // Clarity values: hex and SIP-030 JSON agree with Cl.serialize
    const v = Cl.tuple({ amount: Cl.uint(5), to: Cl.principal(OTHER), m: Cl.some(Cl.bufferFromHex("beef")) });
    expect(hex(serializeCV(cvFrom(Cl.serialize(v))))).toBe(Cl.serialize(v));
    expect(hex(serializeCV(cvFrom(JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))))))).toBe(Cl.serialize(v));
  });

  it("sponsored contract deploy: origin signs with the standard flag over a cleared sponsor", async () => {
    const theirs = await makeUnsignedContractDeploy({ contractName: "hello", codeBody: "(define-read-only (hi) u1)", fee: 0n, nonce: 1n, publicKey: FIX.publicKey, network: "testnet", sponsored: true });
    const ours = deserializeTx(theirs.serializeBytes());
    expect(hex(serializeTx(ours))).toBe(theirs.serialize());
    expect(hex(initialSighash(ours))).toBe(theirs.signBegin());
    expect(hex(originPresignDigest(ours))).toBe(sigHashPreSign(theirs.signBegin(), AuthType.Standard, 0n, 1n));
  });

  it("an origin signature made over our digest verifies in stacks.js", async () => {
    const theirs = await makeUnsignedSTXTokenTransfer({ recipient: OTHER, amount: 1n, fee: 180n, nonce: 0n, publicKey: FIX.publicKey, network: "testnet" });
    const ours = deserializeTx(theirs.serializeBytes());
    const sig = signer.sign({ accountId: "stacks:0", scheme: "ecdsa-secp256k1", bytes: originPresignDigest(ours), approvalId: "x" });
    const vrs = new Uint8Array([sig.recovery!, ...sig.bytes]);
    const signed = deserializeTransaction(hex(serializeTx(withOriginSignature(ours, vrs))));
    expect(() => signed.verifyOrigin()).not.toThrow();
  });
});

describe("message signing", () => {
  it("plain messages hash like @stacks/encryption and verify with verifyMessageSignatureRsv", async () => {
    const text = "Clip Wallet dapp matrix: sign-in check (testnet)";
    expect(hex(messageHash(text))).toBe(hex(hashMessage(text)));
    expect(hex(encodeMessage(text)).startsWith("17537461636b73")).toBe(true);
    const r = req(STACKS_METHODS.signMessage, { message: text });
    const { d, result } = await run(r);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toEqual([{ label: "Message", value: text }]);
    const out = result as { signature: string; publicKey: string };
    expect(out.publicKey).toBe(FIX.publicKey);
    expect(verifyMessageSignatureRsv({ signature: out.signature, message: text, publicKey: FIX.publicKey })).toBe(true);
  });

  it("SIP-018 structured data hashes like stacks.js and verifies", async () => {
    const domain = Cl.tuple({ name: Cl.stringAscii("Clip"), version: Cl.stringAscii("1.0.0"), "chain-id": Cl.uint(2147483648) });
    const message = Cl.tuple({ action: Cl.stringAscii("login"), nonce: Cl.uint(42) });
    expect(hex(structuredHash(cvFrom(Cl.serialize(domain)), cvFrom(Cl.serialize(message))))).toBe(hex(sha256(encodeStructuredDataBytes({ domain, message }))));
    const r = req(STACKS_METHODS.signStructuredMessage, { domain: Cl.serialize(domain), message: Cl.serialize(message) });
    const { d, result } = await run(r);
    expect(d.title).toBe("Sign data for app.example");
    expect(d.warnings).toEqual([]);
    const out = result as { signature: string };
    expect(verifyMessageSignatureRsv({ signature: out.signature, message: sha256(encodeStructuredDataBytes({ domain, message })), publicKey: FIX.publicKey })).toBe(true);
  });

  it("warns when the SIP-018 domain names another chain", async () => {
    const domain = Cl.tuple({ name: Cl.stringAscii("Clip"), version: Cl.stringAscii("1"), "chain-id": Cl.uint(1) });
    const d = await mod.decode(req(STACKS_METHODS.signStructuredMessage, { domain: Cl.serialize(domain), message: Cl.serialize(Cl.uint(1)) }), ctxFor(routes().fetch));
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "network-matters" });
  });
});

describe("dapp transactions", () => {
  it("stx_transferStx: decodes, signs the presign digest and broadcasts", async () => {
    const posted: Uint8Array[] = [];
    const m = routes([
      [
        new RegExp(`${API}/v2/transactions$`),
        (_u: string, init?: RequestInit) => {
          const raw = init!.body as Uint8Array;
          posted.push(raw);
          return JSON.stringify(hex(txidOf(raw)));
        },
      ],
    ]);
    const r = req(STACKS_METHODS.transferStx, { recipient: OTHER, amount: "1", memo: "hi", network: "testnet" });
    const { d, payloads, result } = await run(r, ctxFor(m.fetch));
    expect(d.title).toBe(`Send 0.000001 STX to ${OTHER.slice(0, 5)}…${OTHER.slice(-4)}`);
    expect(d.titleMsg?.id).toBe("bg.req.sendTo");
    expect(d.lines).toContainEqual({ label: "Memo", value: "hi" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "stx" }), delta: "-1" }]);
    expect(d.fee).toMatchObject({ amount: "600" });
    expect(d.blind).toBe(false);
    expect(payloads).toHaveLength(1);
    expect(posted).toHaveLength(1);
    const tx = deserializeTransaction(posted[0]!);
    expect(() => tx.verifyOrigin()).not.toThrow();
    expect(tx.auth.spendingCondition.nonce).toBe(7n);
    expect(tx.auth.spendingCondition.fee).toBe(600n);
    expect(result).toEqual({ txid: tx.txid(), transaction: tx.serialize() });
  });

  it("refuses a bad signature before broadcasting", async () => {
    const m = routes([[new RegExp(`${API}/v2/transactions$`), "\"00\""]]);
    const ctx = ctxFor(m.fetch);
    const r = req(STACKS_METHODS.transferStx, { recipient: OTHER, amount: "1" });
    await mod.decode(r, ctx);
    const [p] = await mod.prepare(r, ctx, "a");
    const good = signer.sign(p!);
    const flipped = good.bytes.slice();
    flipped[5] = flipped[5]! ^ 1;
    await expect(mod.finalize(r, [{ ...good, bytes: flipped }], ctx)).rejects.toMatchObject({ code: "stacks/bad-signature" });
    expect(m.calls.some((c) => c.method === "POST" && /\/v2\/transactions$/.test(c.url))).toBe(false);
  });

  it("refuses a request for another network or another account", async () => {
    const ctx = ctxFor(routes().fetch);
    await expect(mod.decode(req(STACKS_METHODS.transferStx, { recipient: OTHER, amount: 1, network: "mainnet" }), ctx)).rejects.toMatchObject({ code: "stacks/network-mismatch" });
    await expect(mod.decode(req(STACKS_METHODS.transferStx, { recipient: OTHER, amount: 1 }, { networkId: "stacks:1" }), ctx)).rejects.toMatchObject({ code: "stacks/network-mismatch" });
    await expect(mod.decode(req(STACKS_METHODS.signMessage, { message: "x", address: OTHER }), ctx)).rejects.toMatchObject({ code: "stacks/wrong-account" });
    // a mainnet transaction handed to the testnet connection
    const main = await makeUnsignedSTXTokenTransfer({ recipient: FIX.otherMainnet, amount: 1n, fee: 180n, nonce: 0n, publicKey: FIX.publicKey, network: "mainnet" });
    await expect(mod.decode(req(STACKS_METHODS.signTransaction, { transaction: main.serialize() }), ctx)).rejects.toMatchObject({ code: "stacks/network-mismatch" });
    // somebody else's transaction
    const theirs = await makeUnsignedSTXTokenTransfer({ recipient: ME, amount: 1n, fee: 180n, nonce: 0n, publicKey: FIX.otherPublicKey, network: "testnet" });
    await expect(mod.decode(req(STACKS_METHODS.signTransaction, { transaction: theirs.serialize() }), ctx)).rejects.toMatchObject({ code: "stacks/wrong-account" });
  });

  it("an unreadable transaction is blind and can't be prepared", async () => {
    const ctx = ctxFor(routes().fetch);
    const r = req(STACKS_METHODS.signTransaction, { transaction: "80800000000400deadbeef" });
    const d = await mod.decode(r, ctx);
    expect(d.blind).toBe(true);
    expect(d.title).toBe("Approve an unreadable request from app.example");
    await expect(mod.prepare(r, ctx, "a")).rejects.toBeInstanceOf(ClipError);
  });

  it("stx_callContract in allow mode is a danger; post-conditions become lines and balance changes", async () => {
    const pcs = [Pc.principal(ME).willSendEq(2_500_000n).ft("ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx", "usdcx-token")].map(postConditionToHex);
    const r = req(STACKS_METHODS.callContract, {
      contract: `${OTHER}.amm`,
      functionName: "swap",
      functionArgs: [Cl.serialize(Cl.uint(2500000)), { type: "uint", value: "1" }],
      postConditions: pcs,
      postConditionMode: "allow",
    });
    const d = await mod.decode(r, ctxFor(routes().fetch));
    expect(d.title).toBe("Use swap on contract amm");
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "unlimited-approval" });
    expect(d.warnings[0]!.msg?.id).toBe("bg.stacks.allowMode");
    expect(d.lines).toContainEqual({ label: "Argument 1", labelMsg: expect.objectContaining({ id: "bg.label.argumentN" }), value: "u2500000" });
    expect(d.lines).toContainEqual(expect.objectContaining({ label: "Post-condition", value: "You send exactly 2.5 USDCx" }));
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdcx", bridged: true }), delta: "-2500000" }]);
  });

  it("deny mode without our post-conditions says nothing can leave", async () => {
    const d = await mod.decode(req(STACKS_METHODS.callContract, { contract: `${OTHER}.counter`, functionName: "increment" }), ctxFor(routes().fetch));
    expect(d.lines).toContainEqual(expect.objectContaining({ value: "None of your assets can leave your account in this transaction, apart from the network fee." }));
    expect(d.warnings.map((w) => w.code)).toEqual(["unknown-call"]);
    expect(d.balanceChanges).toEqual([]);
  });

  it("stx_transferSip10Ft builds SIP-010 transfer with an exact post-condition", async () => {
    const r = req(STACKS_METHODS.transferSip10Ft, { asset: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx::usdcx-token", recipient: OTHER, amount: "1500000" });
    const d = await mod.decode(r, ctxFor(routes().fetch));
    expect(d.title).toBe(`Send 1.5 USDCx to ${OTHER.slice(0, 5)}…${OTHER.slice(-4)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdcx" }), delta: "-1500000" }]);
    expect(d.warnings).toEqual([]);
  });

  it("stx_signTransaction (no broadcast) returns the signed transaction to the app", async () => {
    const t = await makeUnsignedContractCall({
      contractAddress: OTHER,
      contractName: "nft-market",
      functionName: "list",
      functionArgs: [Cl.uint(1)],
      postConditionMode: PostConditionMode.Deny,
      fee: 1000n,
      nonce: 4n,
      publicKey: FIX.publicKey,
      network: "testnet",
    });
    const m = routes();
    const { d, result } = await run(req(STACKS_METHODS.signTransaction, { transaction: t.serialize() }), ctxFor(m.fetch));
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets the signed transaction)" });
    expect(m.calls.some((c) => c.method === "POST")).toBe(false);
    const signed = deserializeTransaction((result as { transaction: string }).transaction);
    expect(() => signed.verifyOrigin()).not.toThrow();
  });

  it("maps the node's rejection to plain words", async () => {
    const m = routes([[new RegExp(`${API}/v2/transactions$`), reply(400, { error: "transaction rejected", reason: "NotEnoughFunds", txid: "ab" })]]);
    const r = req(STACKS_METHODS.transferStx, { recipient: OTHER, amount: "1" });
    await expect(run(r, ctxFor(m.fetch))).rejects.toMatchObject({ code: "stacks/insufficient-funds", userMessage: "You don't have enough STX to pay for this and its fee." });
  });
});

describe("wallet sends and balances", () => {
  it("buildTransfer: a native send through decode → prepare → finalize", async () => {
    const posted: Uint8Array[] = [];
    const m = routes([[new RegExp(`${API}/v2/transactions$`), (_u: string, init?: RequestInit) => (posted.push(init!.body as Uint8Array), JSON.stringify(hex(txidOf(init!.body as Uint8Array))))]]);
    const ctx = ctxFor(m.fetch);
    const r = await mod.buildTransfer({ asset: STACKS_TESTNET.nativeAsset, to: OTHER, amount: "250000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: STACKS_METHODS.signTransaction, family: "stacks" });
    const { d, result } = await run(r, ctx);
    expect(d.title).toBe(`Send 0.25 STX to ${OTHER.slice(0, 5)}…${OTHER.slice(-4)}`);
    expect(posted).toHaveLength(1);
    expect((result as { txid: string }).txid).toMatch(/^[0-9a-f]{64}$/);
  });

  it("buildTransfer refuses own address, other-network addresses and too-large amounts", async () => {
    const ctx = ctxFor(routes().fetch);
    await expect(mod.buildTransfer({ asset: STACKS_TESTNET.nativeAsset, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "stacks/self-transfer" });
    await expect(mod.buildTransfer({ asset: STACKS_TESTNET.nativeAsset, to: FIX.otherMainnet, amount: "1" }, ctx)).rejects.toMatchObject({ code: "stacks/network-mismatch" });
    await expect(mod.buildTransfer({ asset: STACKS_TESTNET.nativeAsset, to: OTHER, amount: "5000000" }, ctx)).rejects.toMatchObject({ code: "stacks/insufficient-funds" });
  });

  it("getBalances: STX, curated tokens and spam look-alikes", async () => {
    const m = mockFetch([
      [
        new RegExp(`${API}/extended/v1/address/${ME}/balances`),
        {
          stx: { balance: "1500000", locked: "0" },
          fungible_tokens: {
            "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx::usdcx-token": { balance: "2000000" },
            [`${OTHER}.fake-usdc::usdc`]: { balance: "999" },
            [`${OTHER}.zero::z`]: { balance: "0" },
          },
        },
      ],
      [new RegExp(`${API}/metadata/v1/ft/${OTHER}.fake-usdc`), { name: "USD Coin", symbol: "USDC", decimals: 6 }],
    ]);
    const b = await mod.getBalances(ctxFor(m.fetch));
    expect(b.map((x) => [x.asset.key, x.amount, !!x.asset.spam])).toEqual([
      ["stx", "1500000", false],
      ["usdcx", "2000000", false],
      [`sip10:${OTHER}.fake-usdc::usdc`, "999", true],
    ]);
    expect(tokenAsset(STACKS_TESTNET.id, `${OTHER}.t::t`, { symbol: "COOL", decimals: 2 }).spam).toBeUndefined();
  });
});
