import { ClipError, type DappRequest } from "@clip-wallet/core";
import {
  ABIMethod,
  type SuggestedParams,
  type Transaction,
  decodeSignedTransaction,
  decodeUnsignedTransaction,
  encodeUnsignedTransaction,
  getApplicationAddress,
  makeApplicationCallTxnFromObject,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  makeKeyRegistrationTxnWithSuggestedParamsFromObject,
  makePaymentTxnWithSuggestedParamsFromObject,
  OnApplicationComplete,
} from "algosdk";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALGORAND_MAINNET,
  ALGORAND_METHODS,
  ALGORAND_NETS,
  ALGORAND_NETWORKS,
  ALGORAND_TESTNET,
  KNOWN_SELECTORS,
  OPT_IN_LINE,
  asaAssetKey,
  caip2FromGenesisHash,
  clearAssetCache,
  createAlgorandModule,
  fromChainId,
  plainAlgorandError,
  resolveArc19Url,
} from "../src/index.js";
import { b64decode, b64encode, fromHex, hex } from "../src/util.js";
import {
  NOT_OPTED_IN,
  USDC_ASSET_JSON,
  USDC_CREATOR,
  USDC_ID,
  account,
  baseRoutes,
  ctxFor,
  emptyAccount,
  holding,
  makeAccount,
  mockFetch,
  reply,
  signer,
  simFail,
  simOk,
} from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const mod = createAlgorandModule({ confirmPollMs: 0 });
const noSim = createAlgorandModule({ simulate: false, confirmPollMs: 0 });
const SP: SuggestedParams = {
  fee: 0n,
  minFee: 1000n,
  firstValid: 67902000n,
  lastValid: 67903000n,
  genesisHash: b64decode(ALGORAND_NETS.testnet.genesisHash),
  genesisID: "testnet-v1.0",
};
const usdc = { key: "usdc", symbol: "USDC", name: "USDC", decimals: 6, networkId: ALGORAND_TESTNET.id, address: USDC_ID };

const enc = (t: Transaction) => b64encode(encodeUnsignedTransaction(t));
function req(method: string, params: unknown, origin = "https://app.example"): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via: "walletconnect", family: "algorand", networkId: ALGORAND_TESTNET.id, method, params };
}
/** ARC-25 / WalletConnect shape: [WalletTransaction[]]. */
const wc = (...txns: Record<string, unknown>[]) => req(ALGORAND_METHODS.signTxn, [txns]);
const payTo = (to: string, amount: bigint, extra: Record<string, unknown> = {}) =>
  makePaymentTxnWithSuggestedParamsFromObject({ sender: ME, receiver: to, amount, suggestedParams: SP, ...extra });

async function signAll(r: DappRequest, ctx: ReturnType<typeof ctxFor>, m = mod) {
  const payloads = await m.prepare(r, ctx, "approval-1");
  return m.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
}

beforeEach(() => clearAssetCache());

describe("networks", () => {
  it("uses CAIP-2 ids from the base64url genesis hash (ChainAgnostic algorand/caip2 test cases)", () => {
    expect(ALGORAND_TESTNET.id).toBe("algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe");
    expect(ALGORAND_MAINNET.id).toBe("algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k");
    expect(caip2FromGenesisHash("mFgazF+2uRS1tMiL9dsj01hJGySEmPN28B/TjjvpVW0=")).toBe("algorand:mFgazF-2uRS1tMiL9dsj01hJGySEmPN2");
    expect(caip2FromGenesisHash(ALGORAND_NETS.testnet.genesisHash)).toBe(ALGORAND_TESTNET.id);
    expect(ALGORAND_NETWORKS.map((n) => n.testnet)).toEqual([true, false]);
  });

  it("maps genesis ids, hashes and ARC-25 chain ids", () => {
    expect(fromChainId("testnet-v1.0")).toBe(ALGORAND_TESTNET.id);
    expect(fromChainId(416001)).toBe(ALGORAND_MAINNET.id);
    expect(fromChainId("wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=")).toBe(ALGORAND_MAINNET.id);
    expect(fromChainId(4160)).toBeNull();
    expect(asaAssetKey(ALGORAND_TESTNET.id, "10458941")).toBe("usdc");
    expect(asaAssetKey(ALGORAND_MAINNET.id, 31566704)).toBe("usdc");
    expect(asaAssetKey(ALGORAND_MAINNET.id, "10458941")).toBe("asa:10458941");
  });
});

describe("addresses", () => {
  it("encodes base32(pubkey || last 4 bytes of sha512/256) and checks the checksum", () => {
    // Zero key → the well-known Algorand zero address.
    expect(mod.addressFromPublicKey(new Uint8Array(32), ALGORAND_TESTNET)).toBe("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ");
    // ARC-19 spec: 0x21218B18…B008 ↔ EEQYWGGBHRDAMTEVDPVOSDVX3HJQIG6K6IVNR3RXHYOHV64ZWAEISS4CTI.
    const arc19 = fromHex("21218B18C13C46064C951BEAE90EB7D9D3041BCAF22AD8EE373E1C7AFB99B008");
    expect(mod.addressFromPublicKey(arc19, ALGORAND_TESTNET)).toBe("EEQYWGGBHRDAMTEVDPVOSDVX3HJQIG6K6IVNR3RXHYOHV64ZWAEISS4CTI");
    expect(mod.addressFromPublicKey(fromHex(FIX.publicKey), ALGORAND_TESTNET)).toBe(ME);
    expect(mod.isAddress(ME)).toBe(true);
    expect(mod.isAddress(`${ME.slice(0, -1)}A`)).toBe(false);
    expect(mod.isAddress("0x1234")).toBe(false);
    expect(mod.networksForAddress(ME, [...ALGORAND_NETWORKS])).toHaveLength(2);
    expect(mod.derivationPath(0)).toBe("m/44'/283'/0'/0/0");
    expect(mod.derivationPath(3)).toBe("m/44'/283'/3'/0/0");
    expect(mod.curve).toBe("bip32-ed25519");
    const slip10 = createAlgorandModule({ scheme: "slip10" });
    expect(slip10.curve).toBe("ed25519");
    expect(slip10.derivationPath(3)).toBe("m/44'/283'/3'/0'/0'");
    expect(slip10.addressFromPublicKey(fromHex(FIX.slip10PublicKey), ALGORAND_TESTNET)).toBe(FIX.slip10Me);
  });
});

describe("prepare / finalize", () => {
  it("signs 'TX' || msgpack(txn) and returns ARC-1 SignedTxnStr", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const r = wc({ txn: FIX.pay });
    const payloads = await mod.prepare(r, ctx, "a1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.scheme).toBe("ed25519"); // core SignatureScheme, also for ARC-52 extended keys
    expect(hex(payloads[0]!.bytes)).toBe(FIX.payBytesToSign);
    expect(hex(payloads[0]!.bytes).startsWith("5458")).toBe(true); // "TX"
    const out = await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    expect(out).toEqual([FIX.paySigned]);
  });

  it("accepts a plain WalletTransaction[] too", async () => {
    const { fetch } = mockFetch(baseRoutes());
    expect(await signAll(req(ALGORAND_METHODS.signTxn, [{ txn: FIX.pay }]), ctxFor(fetch))).toEqual([FIX.paySigned]);
  });

  it("signs for an account rekeyed to this one (authAddr) with sgnr", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const out = (await signAll(wc({ txn: FIX.forOther, authAddr: ME }), ctxFor(fetch))) as string[];
    expect(out).toEqual([FIX.forOtherSigned]);
    expect(decodeSignedTransaction(b64decode(out[0]!)).sgnr?.toString()).toBe(ME);
  });

  it("refuses a signature that doesn't verify", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const r = wc({ txn: FIX.pay });
    await expect(mod.finalize(r, [{ scheme: "ed25519", bytes: fromHex(FIX.usdcSig), publicKey: FIX.publicKey }], ctx)).rejects.toMatchObject({
      code: "algorand/bad-signature",
      userMessage: "The signature didn't match. Nothing was sent.",
    });
  });

  it("returns null for signers: [] and the dapp's stxn when it matches", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const call = decodeUnsignedTransaction(b64decode(FIX.groupCall));
    expect(call.group).toBeDefined();
    const out = (await signAll(wc({ txn: FIX.groupPay }, { txn: FIX.groupCall, signers: [] }), ctx)) as (string | null)[];
    expect(out[1]).toBeNull();
    expect(decodeSignedTransaction(b64decode(out[0]!)).txn.txID()).toBe(FIX.groupPayTxId);
    // stxn passes through untouched (any signature; ARC-1 lets the wallet skip checking it)
    const stxn = FIX.forOtherSigned;
    const out2 = (await signAll(wc({ txn: FIX.pay }, { txn: FIX.forOther, signers: [], stxn }), ctx)) as (string | null)[];
    expect(out2).toEqual([FIX.paySigned, stxn]);
  });
});

describe("ARC-1 validation", () => {
  const { fetch } = mockFetch(baseRoutes());
  const ctx = ctxFor(fetch);
  const code = async (r: DappRequest) => {
    try {
      await mod.prepare(r, ctx, "a");
      return "ok";
    } catch (e) {
      return e instanceof ClipError ? e.code : String(e);
    }
  };

  it("needs every transaction of a group, in order", async () => {
    expect(await code(wc({ txn: FIX.groupPay }))).toBe("algorand/bad-group");
    expect(await code(wc({ txn: FIX.groupCall }, { txn: FIX.groupPay }))).toBe("algorand/bad-group");
    expect(await code(wc({ txn: FIX.groupPay }, { txn: FIX.groupCall }))).toBe("ok");
    // the same group split by another transaction
    expect(await code(wc({ txn: FIX.groupPay }, { txn: FIX.pay }, { txn: FIX.groupCall }))).toBe("algorand/bad-group");
  });

  it("rejects another network's genesis hash", async () => {
    const t = makePaymentTxnWithSuggestedParamsFromObject({
      sender: ME,
      receiver: BOB,
      amount: 1n,
      suggestedParams: { ...SP, genesisHash: b64decode(ALGORAND_NETS.mainnet.genesisHash), genesisID: "mainnet-v1.0" },
    });
    expect(await code(wc({ txn: enc(t) }))).toBe("algorand/network-mismatch");
    // and a request whose network isn't the connected one
    expect(await code({ ...wc({ txn: FIX.pay }), networkId: ALGORAND_MAINNET.id })).toBe("algorand/network-mismatch");
  });

  it("rejects unknown fields, multisig, other accounts and bad signers", async () => {
    expect(await code(wc({ txn: FIX.pay, sneaky: true }))).toBe("algorand/bad-params");
    expect(await code(wc({ txn: FIX.pay, _clipNote: "wallet extensions are fine" }))).toBe("ok");
    expect(await code(wc({ txn: FIX.pay, msig: { version: 1, threshold: 1, addrs: [ME] } }))).toBe("algorand/multisig-unsupported");
    expect(await code(wc({ txn: FIX.forOther }))).toBe("algorand/not-your-account");
    expect(await code(wc({ txn: FIX.forOther, authAddr: BOB }))).toBe("algorand/not-your-account");
    expect(await code(wc({ txn: FIX.pay, signers: [BOB] }))).toBe("algorand/bad-params");
    expect(await code(wc({ txn: FIX.pay, signers: ["nope"] }))).toBe("algorand/bad-params");
    expect(await code(wc({ txn: FIX.pay, signers: [], stxn: FIX.forOtherSigned }))).toBe("algorand/bad-params");
    expect(await code(wc({ txn: FIX.pay, signers: [] }))).toBe("algorand/not-a-signer");
    expect(await code(wc({ txn: "not base64 msgpack" }))).toBe("algorand/bad-transaction");
    expect(await code(req("algo_signData", [{}]))).toBe("algorand/unsupported-method");
  });

  it("rejects transaction fields Clip Wallet doesn't model (re-encoding must match)", async () => {
    const raw = b64decode(FIX.pay);
    // Append an unknown key "zzz": 1 to the msgpack map (fixmap 0x89 → 0x8a).
    const patched = new Uint8Array([0x8a, ...raw.slice(1), 0xa3, 0x7a, 0x7a, 0x7a, 0x01]);
    expect(await code(wc({ txn: b64encode(patched) }))).toBe("algorand/unknown-field");
  });

  it("refuses an account that's controlled by another key", async () => {
    const { fetch: f } = mockFetch(baseRoutes([[new RegExp(`/v2/accounts/${ME}$`), account(ME, { "auth-addr": BOB })]]));
    await expect(mod.decode(wc({ txn: FIX.pay }), ctxFor(f))).rejects.toMatchObject({
      code: "algorand/rekeyed",
      userMessage: "This account is controlled by another key, so Clip Wallet can't sign for it.",
    });
  });
});

describe("decode", () => {
  it("describes an ALGO payment, simulated", async () => {
    const { fetch, calls } = mockFetch(baseRoutes());
    const d = await mod.decode(wc({ txn: FIX.pay }), ctxFor(fetch));
    expect(d.title).toBe(`Send 1.5 ALGO to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "algo", decimals: 6 }), amount: "1000" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "algo" }), delta: "-1500000" }]);
    expect(d.simulated).toBe(true);
    expect(d.blind).toBe(false);
    expect(d.warnings).toEqual([]);
    expect(d.lines).toContainEqual({ label: "Network fee", value: "0.001 ALGO" });
    expect(d.lines).toContainEqual({ label: "Stays locked", value: "0.2 ALGO (your account's minimum balance)" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets the signed transactions)" });
    const sim = calls.find((c) => c.url.includes("/simulate"))!;
    expect(sim.method).toBe("POST");
    expect(sim.contentType).toBe("application/msgpack");
  });

  it("describes a USDC transfer and an opt-in", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const d = await mod.decode(wc({ txn: FIX.usdc }), ctx);
    expect(d.title).toBe(`Send 2.5 USDC to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc", address: USDC_ID, decimals: 6 }), delta: "-2500000" }]);
    const o = await mod.decode(wc({ txn: FIX.optIn }), ctx);
    expect(o.title).toBe("Add USDC to your account");
    expect(o.lines).toContainEqual({ label: "Why", value: OPT_IN_LINE });
    expect(o.balanceChanges).toEqual([]);
  });

  it("flags a rekey as account takeover", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const t = payTo(BOB, 0n, { rekeyTo: BOB });
    const d = await mod.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.warnings).toContainEqual({
      level: "danger",
      code: "account-takeover",
      message: `Gives control of your account to ${BOB}. You'd lose the ability to use this wallet for it.`,
    });
  });

  it("flags close-remainder-to as account closure and estimates what leaves", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const t = payTo(BOB, 0n, { closeRemainderTo: BOB });
    const d = await noSim.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.title).toBe(`Close your account and send everything to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(d.warnings.map((w) => [w.level, w.code])).toContainEqual(["danger", "account-closure"]);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "algo" }), delta: String(-(4106015 - 1000)) }]);
    // with simulation, the exact closing amount is used
    const { fetch: f2 } = mockFetch(baseRoutes([[/simulate/, simOk([1], () => ({ "closing-amount": 4100000 }))]]));
    const d2 = await mod.decode(wc({ txn: enc(t) }), ctxFor(f2));
    expect(d2.balanceChanges[0]!.delta).toBe("-4100000");
  });

  it("asset close-to: caution back to the issuer, danger to anyone else", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const ctx = ctxFor(fetch);
    const toIssuer = makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: ME,
      receiver: USDC_CREATOR,
      closeRemainderTo: USDC_CREATOR,
      amount: 0n,
      assetIndex: BigInt(USDC_ID),
      suggestedParams: SP,
    });
    const a = await mod.decode(wc({ txn: enc(toIssuer) }), ctx);
    expect(a.title).toBe("Remove USDC from your account");
    expect(a.warnings.find((w) => w.code === "account-closure")?.level).toBe("caution");
    const toBob = makeAssetTransferTxnWithSuggestedParamsFromObject({ sender: ME, receiver: BOB, closeRemainderTo: BOB, amount: 0n, assetIndex: BigInt(USDC_ID), suggestedParams: SP });
    const b = await mod.decode(wc({ txn: enc(toBob) }), ctx);
    expect(b.title).toBe(`Remove USDC and send all of it to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(b.warnings.find((w) => w.code === "account-closure")?.level).toBe("danger");
  });

  it("describes an app-call group with an ARC-200 selector", async () => {
    // Selectors are the first 4 bytes of sha512/256 of the ARC-4 signature.
    for (const [sel, sig] of Object.entries(KNOWN_SELECTORS)) expect(hex(ABIMethod.fromSignature(sig).getSelector())).toBe(sel);
    const { fetch } = mockFetch(baseRoutes([[/simulate/, simOk([2])]]));
    const d = await mod.decode(wc({ txn: FIX.groupPay }, { txn: FIX.groupCall }), ctxFor(fetch));
    expect(d.title).toBe("Approve 2 transactions");
    const values = d.lines.map((l) => l.value);
    expect(values).toContain(`Send 1 ALGO to ${FIX.appAddress.slice(0, 4)}…${FIX.appAddress.slice(-4)}`);
    expect(values).toContain(`Send 5000 units of app 123456's token to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(values).toContain("arc200_transfer(address,uint256)bool");
    expect(d.fee?.amount).toBe("3000");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "algo" }), delta: "-1000000" }]);
  });

  it("shows unknown selectors by hex and counts inner-transaction payments from simulation", async () => {
    const t = makeApplicationCallTxnFromObject({
      sender: ME,
      appIndex: 777n,
      onComplete: OnApplicationComplete.NoOpOC,
      appArgs: [fromHex("1a2b3c4d")],
      suggestedParams: SP,
    });
    const inner = { "inner-txns": [{ txn: { txn: { type: "pay", snd: getApplicationAddress(777n).toString(), rcv: ME, amt: 250000 } } }] };
    const { fetch } = mockFetch(baseRoutes([[/simulate/, simOk([1], () => inner)]]));
    const d = await mod.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.title).toBe("Call app 777 (method 0x1a2b3c4d)");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "algo" }), delta: "250000" }]);
  });

  it("flags app update / delete as danger", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const t = makeApplicationCallTxnFromObject({
      sender: ME,
      appIndex: 777n,
      onComplete: OnApplicationComplete.DeleteApplicationOC,
      suggestedParams: SP,
    });
    const d = await mod.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.title).toBe("Delete app 777");
    expect(d.warnings.some((w) => w.level === "danger")).toBe(true);
  });

  it("keyreg is blind", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const t = makeKeyRegistrationTxnWithSuggestedParamsFromObject({ sender: ME, nonParticipation: true, suggestedParams: SP });
    const d = await mod.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.blind).toBe(true);
    expect(d.warnings).toContainEqual({
      level: "danger",
      code: "blind-signing",
      message: "Registers this account for consensus participation — Clip Wallet doesn't support this yet.",
    });
  });

  it("warns about a first-valid round far in the future, and shows notes", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const t = makePaymentTxnWithSuggestedParamsFromObject({
      sender: ME,
      receiver: BOB,
      amount: 1n,
      note: new TextEncoder().encode("gm"),
      suggestedParams: { ...SP, firstValid: 67902000n + 900n, lastValid: 67902000n + 1800n },
    });
    const d = await mod.decode(wc({ txn: enc(t) }), ctxFor(fetch));
    expect(d.warnings.map((w) => [w.level, w.code])).toContainEqual(["danger", "durable-nonce"]);
    expect(d.lines).toContainEqual({ label: "Note", value: "gm" });
  });

  it("turns a failed simulation into a plain caution", async () => {
    const { fetch } = mockFetch(
      baseRoutes([[/simulate/, simFail(`transaction X: receiver error: must optin, asset ${USDC_ID} missing from ${BOB}`)]]),
    );
    const d = await mod.decode(wc({ txn: FIX.usdc }), ctxFor(fetch));
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual({
      level: "caution",
      code: "simulation-failed",
      message: "They haven't added USDC to their account yet. Ask them to add it first. (found in a test run)",
    });
  });
});

describe("algo_signAndPostTxn", () => {
  it("posts the signed bytes and waits for confirmation", async () => {
    let polls = 0;
    const { fetch, calls } = mockFetch(
      baseRoutes([
        [/\/v2\/transactions$/, { txId: FIX.payTxId }],
        [/\/v2\/transactions\/pending\//, () => (++polls < 2 ? { "pool-error": "", txn: {} } : { "confirmed-round": 67902005, "pool-error": "", txn: {} })],
      ]),
    );
    const r = req(ALGORAND_METHODS.signAndPostTxn, [[{ txn: FIX.pay }]], "clip-wallet");
    const out = await signAll(r, ctxFor(fetch));
    expect(out).toEqual({ txId: FIX.payTxId, txIds: [FIX.payTxId] });
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/v2/transactions"))!;
    expect(post.contentType).toBe("application/x-binary");
    expect(b64encode(post.body as Uint8Array)).toBe(FIX.paySigned);
    expect(polls).toBe(2);
  });

  it("maps node errors to plain words", async () => {
    const { fetch } = mockFetch(
      baseRoutes([[/\/v2\/transactions$/, reply(400, { message: `TransactionPool.Remember: transaction X: receiver error: must optin, asset ${USDC_ID} missing from ${BOB}` })]]),
    );
    const r = req(ALGORAND_METHODS.signAndPostTxn, [[{ txn: FIX.usdc }]]);
    await expect(signAll(r, ctxFor(fetch))).rejects.toMatchObject({
      code: "algorand/send-failed",
      userMessage: "They haven't added USDC to their account yet. Ask them to add it first.",
    });
    expect(plainAlgorandError("overspend (account X, data {}, tried to spend {1A})")).toMatch(/enough ALGO/);
    expect(plainAlgorandError("txn dead: round 5 outside of 1--4")).toMatch(/expired/);
    expect(plainAlgorandError("logic eval error: assert failed pc=12")).toBe("The app rejected this transaction.");
    expect(plainAlgorandError("something weird")).toBe("The Algorand network refused this transaction. Nothing was sent.");
  });

  it("won't post a group with a transaction nobody signed", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const r = req(ALGORAND_METHODS.signAndPostTxn, [[{ txn: FIX.groupPay }, { txn: FIX.groupCall, signers: [] }]]);
    await expect(signAll(r, ctxFor(fetch))).rejects.toMatchObject({ code: "algorand/missing-signature" });
  });
});

describe("buildTransfer / buildOptIn / buildOptOut", () => {
  it("builds an ALGO payment that goes through the full flow", async () => {
    const { fetch } = mockFetch(baseRoutes([[/\/v2\/transactions$/, { txId: FIX.payTxId }], [/pending/, { "confirmed-round": 1, "pool-error": "" }]]));
    const ctx = ctxFor(fetch);
    const r = await mod.buildTransfer({ asset: ALGORAND_TESTNET.nativeAsset, to: BOB, amount: "1500000" }, ctx);
    expect(r.method).toBe("algo_signAndPostTxn");
    expect(r.origin).toBe("clip-wallet");
    expect(r.params).toEqual([[{ txn: FIX.pay }]]);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe(`Send 1.5 ALGO to ${BOB.slice(0, 4)}…${BOB.slice(-4)}`);
    expect(await signAll(r, ctx)).toMatchObject({ txId: FIX.payTxId });
  });

  it("builds a USDC transfer, and refuses a recipient that hasn't added USDC", async () => {
    const { fetch } = mockFetch(baseRoutes());
    const r = await mod.buildTransfer({ asset: usdc, to: BOB, amount: "2500000" }, ctxFor(fetch));
    expect(r.params).toEqual([[{ txn: FIX.usdc }]]);
    const { fetch: f2 } = mockFetch(baseRoutes([[new RegExp(`/v2/accounts/${BOB}/assets/${USDC_ID}$`), NOT_OPTED_IN]]));
    await expect(mod.buildTransfer({ asset: usdc, to: BOB, amount: "1" }, ctxFor(f2))).rejects.toMatchObject({
      code: "algorand/recipient-not-opted-in",
      userMessage: "They haven't added USDC to their Algorand account yet. Ask them to add it first.",
    });
  });

  it("checks addresses, amounts, balances and the recipient's minimum balance", async () => {
    const { fetch } = mockFetch(baseRoutes([[new RegExp(`/v2/accounts/${BOB}$`), emptyAccount(BOB)]]));
    const ctx = ctxFor(fetch);
    const algo = ALGORAND_TESTNET.nativeAsset;
    await expect(mod.buildTransfer({ asset: algo, to: "nope", amount: "1" }, ctx)).rejects.toMatchObject({ code: "algorand/bad-address" });
    await expect(mod.buildTransfer({ asset: algo, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "algorand/self-transfer" });
    await expect(mod.buildTransfer({ asset: algo, to: BOB, amount: "0" }, ctx)).rejects.toMatchObject({ code: "algorand/bad-amount" });
    await expect(mod.buildTransfer({ asset: algo, to: BOB, amount: "50000" }, ctx)).rejects.toMatchObject({
      code: "algorand/below-min-balance",
      userMessage: "This Algorand account needs at least 0.1 ALGO to be able to hold it. Send at least that much.",
    });
    await expect(mod.buildTransfer({ asset: algo, to: BOB, amount: "3906015" }, ctx)).rejects.toMatchObject({ code: "algorand/insufficient-funds" });
    await expect(mod.buildTransfer({ asset: usdc, to: BOB, amount: "10000001" }, ctx)).rejects.toMatchObject({ code: "algorand/insufficient-token" });
  });

  it("builds an opt-in titled 'Add USDC to your account'", async () => {
    const { fetch } = mockFetch(baseRoutes([[new RegExp(`/v2/accounts/${ME}/assets/${USDC_ID}$`), NOT_OPTED_IN]]));
    const ctx = ctxFor(fetch);
    const r = await mod.buildOptIn({ asset: usdc }, ctx);
    expect(r.params).toEqual([[{ txn: FIX.optIn }]]);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe("Add USDC to your account");
    expect(d.lines).toContainEqual({ label: "Why", value: "Algorand accounts must add a token before they can receive it. This locks 0.1 ALGO while it's added." });
    const { fetch: f2 } = mockFetch(baseRoutes());
    await expect(mod.buildOptIn({ asset: USDC_ID }, ctxFor(f2))).rejects.toMatchObject({ code: "algorand/already-opted-in" });
  });

  it("builds an opt-out back to the issuer only once the balance is zero", async () => {
    const { fetch } = mockFetch(baseRoutes());
    await expect(mod.buildOptOut({ asset: usdc }, ctxFor(fetch))).rejects.toMatchObject({ code: "algorand/opt-out-nonzero" });
    const { fetch: f2 } = mockFetch(baseRoutes([[new RegExp(`/v2/accounts/${ME}/assets/${USDC_ID}$`), holding(0)]]));
    const ctx = ctxFor(f2);
    const r = await mod.buildOptOut({ asset: Number(USDC_ID) }, ctx);
    const t = decodeUnsignedTransaction(b64decode((r.params as { txn: string }[][])[0]![0]!.txn));
    expect(t.assetTransfer?.closeRemainderTo?.toString()).toBe(USDC_CREATOR);
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe("Remove USDC from your account");
  });

  it("reports what's spendable", async () => {
    const { fetch } = mockFetch(baseRoutes());
    expect(await mod.spendable(ctxFor(fetch))).toEqual({ balance: "4106015", locked: "200000", spendable: "3906015" });
  });
});

describe("balances and NFTs", () => {
  const ARC3 = 7001;
  const ARC19 = 66753108;
  const ARC69 = 7003;
  const nftAsset = (id: number, params: Record<string, unknown>) => ({
    index: id,
    params: { creator: BOB, decimals: 0, "default-frozen": false, total: 1, reserve: BOB, ...params },
  });
  const routes = () =>
    baseRoutes([
      [
        new RegExp(`/v2/accounts/${ME}$`),
        account(ME, {
          assets: [
            { amount: 10000000, "asset-id": 10458941, "is-frozen": false },
            { amount: 1, "asset-id": ARC3, "is-frozen": false },
            { amount: 1, "asset-id": ARC19, "is-frozen": false },
            { amount: 1, "asset-id": ARC69, "is-frozen": false },
          ],
        }),
      ],
      [new RegExp(`/v2/assets/${ARC3}$`), nftAsset(ARC3, { name: "Song", "unit-name": "SONG", url: "ipfs://QmWS1VAdMD353A6SDk9wNyvkT14kyCiZrNDYAad4w1tKqT/metadata.json#arc3" })],
      // Real testnet ARC-19 asset from the ARC-19 spec (trimmed).
      [
        new RegExp(`/v2/assets/${ARC19}$`),
        nftAsset(ARC19, {
          name: "TSTIPFSCID",
          "unit-name": "TST",
          url: "template-ipfs://{ipfscid:0:dag-pb:reserve:sha2-256}",
          reserve: "EEQYWGGBHRDAMTEVDPVOSDVX3HJQIG6K6IVNR3RXHYOHV64ZWAEISS4CTI",
        }),
      ],
      [new RegExp(`/v2/assets/${ARC69}$`), nftAsset(ARC69, { name: "Kitten 1", "unit-name": "KIT1", url: "ipfs://QmMedia#i" })],
      [
        /ipfs\.io\/ipfs\/QmWS1VAdMD353A6SDk9wNyvkT14kyCiZrNDYAad4w1tKqT\/metadata\.json$/,
        { name: "My Song", image: "mysong.png", properties: { Bass: "Groovy" } },
      ],
      [
        new RegExp(`/v2/assets/${ARC69}/transactions\\?tx-type=acfg`),
        {
          "current-round": 67902000,
          transactions: [
            { note: btoa(JSON.stringify({ standard: "arc69", attributes: [{ trait_type: "Fur", value: "Grey" }] })) },
            { note: btoa(JSON.stringify({ standard: "arc69", media_url: "ipfs://QmLatest", attributes: [{ trait_type: "Fur", value: "Gold" }] })) },
            { note: btoa("not json") },
          ],
        },
      ],
    ]);

  it("lists ALGO and fungible tokens, not NFTs", async () => {
    const { fetch } = mockFetch(routes());
    const b = await mod.getBalances(ctxFor(fetch));
    expect(b.map((x) => [x.asset.key, x.asset.symbol, x.amount])).toEqual([
      ["algo", "ALGO", "4106015"],
      ["usdc", "USDC", "10000000"],
    ]);
  });

  it("reads ARC-3, ARC-19 and ARC-69 NFTs", async () => {
    const { fetch } = mockFetch(routes());
    const nfts = await mod.getNfts(ctxFor(fetch));
    expect(nfts.map((n) => [n.standard, n.tokenId, n.name, n.mediaUrl])).toEqual([
      ["arc3", "7001", "My Song", "https://ipfs.io/ipfs/QmWS1VAdMD353A6SDk9wNyvkT14kyCiZrNDYAad4w1tKqT/mysong.png"],
      ["arc19", "66753108", "TSTIPFSCID", "https://ipfs.io/ipfs/QmQZyq4b89RfaUw8GESPd2re4hJqB8bnm4kVHNtyQrHnnK"],
      ["arc69", "7003", "Kitten 1", "https://ipfs.io/ipfs/QmLatest"],
    ]);
    expect(nfts[0]!.attributes).toEqual([{ trait: "Bass", value: "Groovy" }]);
    expect(nfts[2]!.attributes).toEqual([{ trait: "Fur", value: "Gold" }]);
  });

  it("derives ARC-19 CIDs from the reserve address (ARC-19 spec vector; v1 cross-checked with multiformats)", () => {
    const reserve = "EEQYWGGBHRDAMTEVDPVOSDVX3HJQIG6K6IVNR3RXHYOHV64ZWAEISS4CTI";
    expect(resolveArc19Url("template-ipfs://{ipfscid:0:dag-pb:reserve:sha2-256}", reserve)).toBe("ipfs://QmQZyq4b89RfaUw8GESPd2re4hJqB8bnm4kVHNtyQrHnnK");
    expect(resolveArc19Url("template-ipfs://{ipfscid:1:raw:reserve:sha2-256}", reserve)).toBe("ipfs://bafkreibbegfrrqj4iydezfi35luq5n6z2mcbxsxsflmo4nz6dr5pxgnqba");
    expect(resolveArc19Url("template-ipfs://{ipfscid:1:dag-pb:reserve:sha2-256}/metadata.json", reserve)).toBe(
      "ipfs://bafybeibbegfrrqj4iydezfi35luq5n6z2mcbxsxsflmo4nz6dr5pxgnqba/metadata.json",
    );
    expect(resolveArc19Url("template-ipfs://{ipfscid:0:raw:reserve:sha2-256}", reserve)).toBeNull();
    expect(resolveArc19Url("template-ipfs://{ipfscid:1:raw:manager:sha2-256}", reserve)).toBeNull();
  });

  it("keeps uint64 asset totals exact", async () => {
    const { fetch } = mockFetch(baseRoutes());
    // USDC total is 2^64-1; parsed with algosdk's MIXED int decoding it must not be treated as an NFT or rounded.
    expect(USDC_ASSET_JSON).toContain("18446744073709551615");
    const b = await mod.getBalances(ctxFor(fetch));
    expect(b[1]!.asset.key).toBe("usdc");
  });
});

it("fixture account is the public test account", () => {
  expect(makeAccount().address).toBe(ME);
});
