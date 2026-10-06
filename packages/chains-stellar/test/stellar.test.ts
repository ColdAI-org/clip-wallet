import { ClipError, type DappRequest } from "@clip-wallet/core";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  Account,
  Asset,
  Claimant,
  LiquidityPoolAsset,
  Memo,
  Operation,
  StrKey,
  type Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-base";
import { describe, expect, it } from "vitest";
import {
  Horizon,
  STELLAR_METHODS,
  STELLAR_NETWORKS,
  STELLAR_PUBNET,
  STELLAR_TESTNET,
  USDC_ISSUERS,
  classicAsset,
  createStellarModule,
  fromPassphrase,
  isContractAddress,
  messageHash,
  networkPassphrase,
  plainStellarError,
  signaturePayload,
  simulatedChanges,
  transactionHash,
  xlmAsset,
} from "../src/index.js";
import { b64decode, b64encode, concat, hex, utf8 } from "../src/util.js";
import { feeStats, getTxNotFound, meAccount, notFound, sendError, simulateTransfer, submitFailed } from "./fixtures.js";
import { ctxFor, fixtureSigner, makeAccount, mockStellar, pubOf } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const BOB = FIX.bob;
const PASS = networkPassphrase(STELLAR_TESTNET.id);
const NET = STELLAR_TESTNET.id;
const USDC_T = USDC_ISSUERS.testnet;
const NOW = 1_790_000_000_000;
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const signer = fixtureSigner(ME, [FIX.paymentSig, FIX.sorobanSig, FIX.authEntrySig, FIX.messageSig]);
const fee = { ...feeStats, fee_charged: { ...feeStats.fee_charged, p50: "100" } };
const ledgers = { _embedded: { records: [{ sequence: 4999259, base_reserve_in_stroops: 5000000, base_fee_in_stroops: 100 }] } };
const bobAccount = (extra: Record<string, unknown> = {}) => ({
  id: BOB,
  sequence: "1864101705809920",
  subentry_count: 0,
  balances: [{ balance: "10787.0428944", asset_type: "native" }],
  signers: [{ weight: 1, key: BOB, type: "ed25519_public_key" }],
  data: {},
  ...extra,
});
const bobWithUsdc = bobAccount({ balances: [{ balance: "0.0000000", asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_T }, { balance: "1.0000000", asset_type: "native" }] });
const meWithUsdc = { ...meAccount, balances: meAccount.balances.map((b) => (b.asset_issuer === USDC_T ? { ...b, balance: "25.0000000" } : b)) };

const horizonBase = (extra: Record<string, unknown> = {}) => ({
  [`/accounts/${ME}`]: meAccount,
  [`/accounts/${BOB}`]: bobAccount(),
  "/fee_stats": fee,
  "/ledgers?order=desc&limit=1": ledgers,
  ...extra,
});

function setup(horizon: Record<string, unknown> = {}, rpc: Record<string, (p: unknown) => unknown> = {}, opts: Parameters<typeof createStellarModule>[0] = {}) {
  const mock = mockStellar(horizonBase(horizon), rpc);
  return { m: createStellarModule({ now: () => NOW, sleep: async () => {}, ...opts }), ctx: ctxFor(makeAccount(ME), mock.fetch), calls: mock.calls };
}

function req(method: string, params: unknown, origin = "https://app.example", networkId = NET): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin, via: "walletconnect", family: "stellar", networkId, method, params };
}

/** Unsigned decode-only envelope (no signature needed). */
function txOf(ops: xdr.Operation[], o: { source?: string; memo?: Memo; maxTime?: number; fee?: string } = {}): string {
  const b = new TransactionBuilder(new Account(o.source ?? ME, "100"), { fee: o.fee ?? "100", networkPassphrase: PASS, timebounds: { minTime: 0, maxTime: o.maxTime ?? 1790000300 } });
  ops.forEach((op) => b.addOperation(op));
  if (o.memo) b.addMemo(o.memo);
  return b.build().toXDR();
}
const signXdr = (x: string, extra: Record<string, unknown> = {}) => req(STELLAR_METHODS.signXDR, { xdr: x, ...extra });
const usdc = new Asset("USDC", USDC_T);

async function rejects(p: Promise<unknown>, code: string, message?: string) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ClipError);
  expect((e as ClipError).code).toBe(code);
  if (message) expect((e as ClipError).userMessage).toBe(message);
}

describe("networks and addresses", () => {
  it("CAIP-2 ids, passphrases, assets", () => {
    expect(STELLAR_NETWORKS.map((n) => n.id)).toEqual(["stellar:testnet", "stellar:pubnet"]);
    expect(STELLAR_PUBNET.testnet).toBe(false);
    expect(networkPassphrase("stellar:testnet")).toBe("Test SDF Network ; September 2015");
    expect(networkPassphrase("stellar:pubnet")).toBe("Public Global Stellar Network ; September 2015");
    expect(fromPassphrase("Public Global Stellar Network ; September 2015")).toBe("stellar:pubnet");
    expect(fromPassphrase("Standalone Network ; February 2017")).toBeNull();
    expect(xlmAsset(NET)).toMatchObject({ key: "xlm", decimals: 7 });
    expect(classicAsset(NET, "USDC", USDC_T)).toMatchObject({ key: "usdc", address: `USDC:${USDC_T}` });
    expect(classicAsset("stellar:pubnet", "USDC", USDC_ISSUERS.pubnet).key).toBe("usdc");
    // Look-alikes: other issuers' USDC (including the pubnet issuer on testnet) are spam.
    expect(classicAsset(NET, "USDC", USDC_ISSUERS.pubnet)).toMatchObject({ key: `stellar:USDC-${USDC_ISSUERS.pubnet}`, spam: true });
    expect(classicAsset(NET, "USDC1", BOB).spam).toBe(true);
    expect(classicAsset(NET, "AQUA", BOB)).toMatchObject({ key: `stellar:AQUA-${BOB}` });
    expect(classicAsset(NET, "AQUA", BOB).spam).toBeUndefined();
  });

  it("SEP-5 path and StrKey addresses", () => {
    const m = createStellarModule();
    expect(m.derivationPath(0)).toBe("m/44'/148'/0'");
    expect(m.derivationPath(3)).toBe("m/44'/148'/3'");
    expect(m.addressFromPublicKey(pubOf(ME), STELLAR_TESTNET)).toBe(ME);
    expect(m.isAddress(ME)).toBe(true);
    const muxed = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ"; // stellar-base docs example
    expect(m.isAddress(muxed)).toBe(true);
    expect(m.isAddress("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toBe(false);
    expect(isContractAddress("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")).toBe(true);
    expect(m.isAddress("0x1234")).toBe(false);
    expect(m.isAddress(`${ME.slice(0, -1)}A`)).toBe(false);
    expect(m.networksForAddress(ME, STELLAR_NETWORKS)).toHaveLength(2);
  });
});

describe("signature payloads", () => {
  it("transaction hash = sha256(sha256(passphrase) || ENVELOPE_TYPE_TX || tx) = stellar-base hash()", () => {
    const tx = TransactionBuilder.fromXDR(FIX.payment, PASS) as Transaction;
    const manual = concat(sha256(utf8(PASS)), Uint8Array.of(0, 0, 0, 2), Uint8Array.from((tx as unknown as { tx: xdr.Transaction }).tx.toXDR()));
    expect(hex(signaturePayload(tx))).toBe(hex(manual));
    expect(hex(transactionHash(tx))).toBe(hex(sha256(manual)));
    expect(hex(transactionHash(tx))).toBe(hex(Uint8Array.from(tx.hash())));
  });

  it("fee-bump uses ENVELOPE_TYPE_TX_FEE_BUMP (5)", () => {
    const inner = TransactionBuilder.fromXDR(txOf([Operation.payment({ destination: ME, asset: Asset.native(), amount: "1" })], { source: BOB }), PASS) as Transaction;
    const fb = TransactionBuilder.buildFeeBumpTransaction(ME, "200", inner, PASS);
    const manual = concat(sha256(utf8(PASS)), Uint8Array.of(0, 0, 0, 5), Uint8Array.from((fb as unknown as { tx: xdr.FeeBumpTransaction }).tx.toXDR()));
    expect(hex(transactionHash(fb))).toBe(hex(sha256(manual)));
    expect(hex(transactionHash(fb))).toBe(hex(Uint8Array.from(fb.hash())));
  });

  it("SEP-53 bytes match the SEP's published vectors (public key + signature only)", () => {
    const sepAddress = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
    const vectors: [string | Uint8Array, string][] = [
      ["Hello, World!", "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA=="],
      ["こんにちは、世界！", "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA=="],
      [b64decode("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo="), "VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ=="],
    ];
    for (const [msg, sig] of vectors) expect(ed25519.verify(b64decode(sig), messageHash(msg), pubOf(sepAddress))).toBe(true);
    expect(ed25519.verify(b64decode(vectors[0]![1]), messageHash("Hello, World"), pubOf(sepAddress))).toBe(false);
  });

  it("SEP-53 finalize with the SEP's vector account", async () => {
    const sepAddress = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
    const sepSig = "7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04";
    const m = createStellarModule();
    const ctx = ctxFor(makeAccount(sepAddress), mockStellar().fetch);
    const r = req(STELLAR_METHODS.signMessage, { message: "Hello, World!" });
    const [p] = await m.prepare(r, ctx, "a1");
    const result = await m.finalize(r, [fixtureSigner(sepAddress, [sepSig]).sign(p!)], ctx);
    const b64 = "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==";
    expect(result).toEqual({ signedMessage: b64, signature: b64, signerAddress: sepAddress });
  });
});

describe("decode", () => {
  it("XLM payment", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signXdr(FIX.payment), ctx);
    expect(d.title).toBe(`Send 10 XLM to ${short(BOB)}`);
    expect(d.blind).toBe(false);
    expect(d.warnings).toEqual([]);
    expect(d.balanceChanges).toEqual([{ asset: xlmAsset(NET), delta: "-100000000" }]);
    expect(d.fee).toEqual({ asset: xlmAsset(NET), amount: "100" });
    expect(d.lines).toContainEqual({ label: "Valid until", value: "2026-09-21T14:18:20Z" });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "up to 0.00001 XLM" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "app.example (it gets the signed transaction)" });
  });

  it("SEP-29: destination requires a memo → danger; memo present → fine", async () => {
    const { m, ctx } = setup({ [`/accounts/${BOB}`]: bobAccount({ data: { "config.memo_required": "MQ==" } }) });
    const d = await m.decode(signXdr(FIX.payment), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "memo-required" }));
    const withMemo = txOf([Operation.payment({ destination: BOB, asset: Asset.native(), amount: "10" })], { memo: Memo.id("12345") });
    const d2 = await m.decode(signXdr(withMemo), ctx);
    expect(d2.warnings.some((w) => w.code === "memo-required")).toBe(false);
    expect(d2.lines).toContainEqual({ label: "Memo", value: "12345" });
  });

  it("USDC payment; recipient without a trustline gets a caution", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signXdr(txOf([Operation.payment({ destination: BOB, asset: usdc, amount: "2.5" })])), ctx);
    expect(d.title).toBe(`Send 2.5 USDC to ${short(BOB)}`);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc" }), delta: "-25000000" }]);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed", message: "They need to add USDC to their account first, so this payment will fail." }));
  });

  it("payment to an unopened account → caution; createAccount explains", async () => {
    const { m, ctx } = setup({ [`/accounts/${BOB}`]: { status: 404, body: notFound } });
    const d = await m.decode(signXdr(FIX.payment), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "simulation-failed" }));
    const d2 = await m.decode(signXdr(txOf([Operation.createAccount({ destination: BOB, startingBalance: "5" })])), ctx);
    expect(d2.title).toBe(`Send 5 XLM to ${short(BOB)} and open their account`);
    expect(d2.lines).toContainEqual({ label: "Also", value: "This also opens their Stellar account; it needs at least 1 XLM." });
    expect(d2.balanceChanges).toEqual([{ asset: xlmAsset(NET), delta: "-50000000" }]);
  });

  it("path payments", async () => {
    const { m, ctx } = setup();
    const send = await m.decode(signXdr(txOf([Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: "100", destination: ME, destAsset: usdc, destMin: "9.5", path: [] })])), ctx);
    expect(send.title).toBe("Swap 100 XLM for at least 9.5 USDC");
    expect(send.balanceChanges).toEqual(expect.arrayContaining([{ asset: xlmAsset(NET), delta: "-1000000000" }, { asset: expect.objectContaining({ key: "usdc" }), delta: "95000000" }]));
    const recv = await m.decode(signXdr(txOf([Operation.pathPaymentStrictReceive({ sendAsset: usdc, sendMax: "11", destination: BOB, destAsset: Asset.native(), destAmount: "100", path: [] })])), ctx);
    expect(recv.title).toBe(`Swap up to 11 USDC for 100 XLM, sent to ${short(BOB)}`);
  });

  it("trustlines", async () => {
    const { m, ctx } = setup();
    const add = await m.decode(signXdr(txOf([Operation.changeTrust({ asset: usdc })])), ctx);
    expect(add.title).toBe("Add USDC to your account");
    expect(add.lines).toContainEqual({ label: "Also", value: "This sets aside 0.5 XLM of your balance while USDC is added." });
    const rm = await m.decode(signXdr(txOf([Operation.changeTrust({ asset: usdc, limit: "0" })])), ctx);
    expect(rm.title).toBe("Remove USDC from your account");
    const fake = await m.decode(signXdr(txOf([Operation.changeTrust({ asset: new Asset("USDC", BOB) })])), ctx);
    expect(fake.warnings).toContainEqual(expect.objectContaining({ code: "known-scam" }));
    const pool = await m.decode(signXdr(txOf([Operation.changeTrust({ asset: new LiquidityPoolAsset(Asset.native(), usdc, 30) })])), ctx);
    expect(pool.title).toBe("Add a liquidity pool share to your account");
  });

  it("offers", async () => {
    const { m, ctx } = setup();
    const sell = await m.decode(signXdr(txOf([Operation.manageSellOffer({ selling: Asset.native(), buying: usdc, amount: "50", price: "0.1" })])), ctx);
    expect(sell.title).toBe("Offer to sell 50 XLM for USDC");
    const cancel = await m.decode(signXdr(txOf([Operation.manageSellOffer({ selling: Asset.native(), buying: usdc, amount: "0", price: "1", offerId: "77" })])), ctx);
    expect(cancel.title).toBe("Cancel an offer");
    const buy = await m.decode(signXdr(txOf([Operation.manageBuyOffer({ selling: Asset.native(), buying: usdc, buyAmount: "5", price: "10" })])), ctx);
    expect(buy.title).toBe("Offer to buy 5 USDC with XLM");
    const passive = await m.decode(signXdr(txOf([Operation.createPassiveSellOffer({ selling: usdc, buying: Asset.native(), amount: "1", price: "10" })])), ctx);
    expect(passive.title).toBe("Offer to sell 1 USDC for XLM");
  });

  it("setOptions: signer / master weight / thresholds → account-takeover danger; home domain is fine", async () => {
    const { m, ctx } = setup();
    const signerAdd = await m.decode(signXdr(txOf([Operation.setOptions({ signer: { ed25519PublicKey: BOB, weight: 1 } })])), ctx);
    expect(signerAdd.title).toBe("Change your account's settings");
    expect(signerAdd.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "account-takeover" }));
    const master = await m.decode(signXdr(txOf([Operation.setOptions({ masterWeight: 0 })])), ctx);
    expect(master.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "account-takeover", message: expect.stringContaining("turns off your own key") }));
    const th = await m.decode(signXdr(txOf([Operation.setOptions({ lowThreshold: 2, medThreshold: 2, highThreshold: 2 })])), ctx);
    expect(th.warnings.map((w) => w.code)).toContain("account-takeover");
    const home = await m.decode(signXdr(txOf([Operation.setOptions({ homeDomain: "example.com" })])), ctx);
    expect(home.warnings).toEqual([]);
    expect(home.lines).toContainEqual({ label: "Home domain", value: "example.com" });
    const remove = await m.decode(signXdr(txOf([Operation.setOptions({ signer: { ed25519PublicKey: BOB, weight: 0 } })])), ctx);
    expect(remove.warnings).toEqual([]);
  });

  it("accountMerge → account-closure danger", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signXdr(txOf([Operation.accountMerge({ destination: BOB })])), ctx);
    expect(d.title).toBe(`Close your account and send all your XLM to ${short(BOB)}`);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "account-closure" }));
  });

  it("claimable balances, sponsorship, data, sequence, clawback, flags, pools", async () => {
    const { m, ctx } = setup();
    const t = async (op: xdr.Operation) => (await m.decode(signXdr(txOf([op])), ctx)).title;
    expect(await t(Operation.createClaimableBalance({ asset: usdc, amount: "3", claimants: [new Claimant(BOB)] }))).toBe(`Send 3 USDC to ${short(BOB)} to claim`);
    const balanceId = "00000000da0d57da7d4850e7fc10d2a9d0ebc731f7afb40574c03395b17d49149b91f5be";
    expect(await t(Operation.claimClaimableBalance({ balanceId }))).toBe("Claim a balance sent to you");
    expect(await t(Operation.beginSponsoringFutureReserves({ sponsoredId: BOB }))).toBe(`Pay the XLM reserves for ${short(BOB)}`);
    expect(await t(Operation.endSponsoringFutureReserves({}))).toBe("Finish a reserve sponsorship");
    expect(await t(Operation.revokeTrustlineSponsorship({ account: BOB, asset: usdc }))).toBe("Change who pays the reserve for a trustline");
    expect(await t(Operation.revokeDataSponsorship({ account: BOB, name: "x" }))).toBe("Change who pays the reserve for data “x”");
    expect(await t(Operation.manageData({ name: "config.memo_required", value: "1" }))).toBe("Save “config.memo_required” on your account");
    expect(await t(Operation.manageData({ name: "k", value: null }))).toBe("Delete “k” from your account data");
    expect(await t(Operation.bumpSequence({ bumpTo: "999999999" }))).toBe("Move your account's transaction counter forward");
    expect(await t(Operation.clawback({ asset: usdc, amount: "1", from: BOB }))).toBe(`Take back 1 USDC from ${short(BOB)}`);
    expect(await t(Operation.setTrustLineFlags({ trustor: BOB, asset: usdc, flags: { authorized: true } }))).toBe(`Change whether ${short(BOB)} can hold USDC`);
    const poolId = "dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7";
    expect(await t(Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: "1", maxAmountB: "2", minPrice: "0.4", maxPrice: "0.6" }))).toBe("Add funds to a liquidity pool");
    expect(await t(Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: "1", minAmountA: "0.1", minAmountB: "0.2" }))).toBe("Withdraw funds from a liquidity pool");
    expect(await t(Operation.inflation({}))).toBe("Run inflation (no longer does anything)");
  });

  it("several operations", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signXdr(txOf([Operation.changeTrust({ asset: usdc }), Operation.payment({ destination: BOB, asset: Asset.native(), amount: "1" })])), ctx);
    expect(d.title).toBe(`Add USDC to your account and send 1 XLM to ${short(BOB)}`);
    expect(d.lines[0]).toEqual({ label: "Action 1", value: "Add USDC to your account" });
  });

  it("Soroban invoke: simulated SAC transfer events become balance changes", async () => {
    const { m, ctx, calls } = setup({}, { simulateTransaction: () => simulateTransfer });
    const d = await m.decode(signXdr(FIX.soroban), ctx);
    expect(d.title).toBe(`Send 1 XLM to ${short(BOB)}`);
    expect(d.simulated).toBe(true);
    expect(d.balanceChanges).toEqual([{ asset: xlmAsset(NET), delta: "-10000000" }]);
    expect(d.lines).toContainEqual({ label: "Contract", value: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC" });
    expect(d.lines).toContainEqual({ label: "Function", value: "transfer" });
    expect(d.lines).toContainEqual({ label: "Argument 3", value: "10000000" });
    expect(d.lines).toContainEqual({ label: "Smart contract resources", value: "0.002346 XLM (included in the fee)" });
    expect(calls.some((c) => c.body?.includes("simulateTransaction"))).toBe(true);
  });

  it("Soroban invoke: simulation failure → caution", async () => {
    const { m, ctx } = setup({}, { simulateTransaction: () => ({ error: "HostError: Error(Contract, #10)", latestLedger: 1 }) });
    const d = await m.decode(signXdr(FIX.soroban), ctx);
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "simulation-failed" }));
    expect(d.balanceChanges).toEqual([]);
  });

  it("audit STL-01: a Soroban call that can't be test-run is blind", async () => {
    const { m, ctx } = setup({}, {}, { simulate: false });
    const d = await m.decode(signXdr(FIX.soroban), ctx);
    expect(d.blind).toBe(true);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "blind-signing" }));
    const down = setup({}, { simulateTransaction: () => { throw { code: -32000, message: "down" }; } });
    expect((await down.m.decode(signXdr(FIX.soroban), down.ctx)).blind).toBe(true);
  });

  it("SEP-41 token events use the contract's decimals and symbol", async () => {
    const token = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
    const fakeToken = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
    const ev = (contract: string) =>
      new xdr.DiagnosticEvent({
        inSuccessfulContractCall: true,
        event: new xdr.ContractEvent({
          ext: new xdr.ExtensionPoint(0),
          contractId: StrKey.decodeContract(contract) as never,
          type: xdr.ContractEventType.contract(),
          body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({
            topics: [nativeToScVal("transfer", { type: "symbol" }), nativeToScVal(ME, { type: "address" }), nativeToScVal(BOB, { type: "address" })],
            data: nativeToScVal(1234500n, { type: "i128" }),
          })),
        }),
      }).toXDR("base64");
    const { m, ctx } = setup({}, {
      simulateTransaction: (p) => {
        const tx = TransactionBuilder.fromXDR((p as { transaction: string }).transaction, PASS) as Transaction;
        const fn = (tx.operations[0] as Operation.InvokeHostFunction).func.invokeContract().functionName().toString();
        const val = fn === "decimals" ? nativeToScVal(4, { type: "u32" }) : nativeToScVal("AQX", { type: "string" });
        return { results: [{ auth: [], xdr: val.toXDR("base64") }], latestLedger: 1 };
      },
    });
    const dc = {
      networkId: NET,
      passphrase: PASS,
      me: ME,
      horizon: null,
      rpc: null,
      simulate: true,
      tokenMeta: async () => ({ decimals: 4, symbol: "AQX", name: "AQX" }),
    };
    const changes = await simulatedChanges({ events: [ev(fakeToken), ev(token)], latestLedger: 1 }, dc);
    expect(changes).toContainEqual({ asset: expect.objectContaining({ key: `sep41:${fakeToken}`, symbol: "AQX", decimals: 4 }), delta: "-1234500" });
    // The testnet USDC SAC is recognised from its contract id, not from metadata.
    expect(changes).toContainEqual({ asset: expect.objectContaining({ key: "usdc", decimals: 7 }), delta: "-1234500" });
    // Through the module: metadata comes from simulating decimals()/symbol().
    const tokenTx = txOf([Operation.invokeContractFunction({ contract: fakeToken, function: "transfer", args: [nativeToScVal(ME, { type: "address" }), nativeToScVal(BOB, { type: "address" }), nativeToScVal(25000n, { type: "i128" })] })]);
    const d = await m.decode(signXdr(tokenTx), { ...ctx });
    expect(d.title).toBe(`Send 2.5 AQX to ${short(BOB)}`);
  });

  it("fee-bump: fee paid by you", async () => {
    const { m, ctx } = setup();
    const inner = TransactionBuilder.fromXDR(txOf([Operation.payment({ destination: ME, asset: Asset.native(), amount: "1" })], { source: BOB }), PASS) as Transaction;
    const fb = TransactionBuilder.buildFeeBumpTransaction(ME, "500", inner, PASS);
    const d = await m.decode(signXdr(fb.toXDR()), ctx);
    expect(d.title).toBe(`Receive 1 XLM from ${short(BOB)}`);
    expect(d.lines).toContainEqual({ label: "Fee paid by", value: "You" });
    expect(d.fee?.amount).toBe("1000");
  });

  it("refuses: not a signer, other account, other network", async () => {
    const { m, ctx } = setup();
    await rejects(m.decode(signXdr(txOf([Operation.payment({ destination: ME, asset: Asset.native(), amount: "1" })], { source: BOB })), ctx), "stellar/not-a-signer");
    await rejects(m.decode(signXdr(FIX.payment, { address: BOB }), ctx), "stellar/wrong-account");
    await rejects(m.decode(signXdr(FIX.payment, { networkPassphrase: "Public Global Stellar Network ; September 2015" }), ctx), "stellar/network-mismatch");
    await rejects(m.decode(req("stellar_unknown", {}), ctx), "stellar/unsupported-method");
    await rejects(m.decode(signXdr("not-xdr"), ctx), "stellar/bad-transaction");
  });

  it("an op with my account as source in someone else's transaction needs my signature", async () => {
    const { m, ctx } = setup();
    const x = txOf([Operation.payment({ destination: BOB, asset: Asset.native(), amount: "1", source: ME })], { source: BOB });
    const d = await m.decode(signXdr(x), ctx);
    expect(d.title).toBe(`Send 1 XLM to ${short(BOB)}`);
    expect(d.lines).toContainEqual({ label: "Transaction account", value: BOB });
    const [p] = await m.prepare(signXdr(x), ctx, "a");
    expect(hex(p!.bytes)).toBe(hex(Uint8Array.from(TransactionBuilder.fromXDR(x, PASS).hash())));
  });

  it("SEP-43 auth entry: contract call, expiry, nonce", async () => {
    const { m, ctx } = setup({}, { getLatestLedger: () => ({ id: "x", protocolVersion: 29, sequence: 4999940 }) });
    const d = await m.decode(req(STELLAR_METHODS.signAuthEntry, { entryXdr: FIX.authEntry }), ctx);
    expect(d.title).toBe("Approve transfer on contract CDLZ…CYSC");
    expect(d.lines).toContainEqual({ label: "Function", value: "transfer" });
    expect(d.lines).toContainEqual({ label: "Argument 1", value: ME });
    expect(d.lines).toContainEqual({ label: "Valid until", value: "ledger 5000000 (about 5 min from now)" });
    expect(d.lines).toContainEqual({ label: "Nonce", value: "42" });
    expect(d.blind).toBe(false);
  });

  it("audit CHAIN-L: an auth entry always carries a warning: danger when it moves assets, caution otherwise", async () => {
    const latest = { getLatestLedger: () => ({ id: "x", protocolVersion: 29, sequence: 4999940 }) };
    const { m, ctx } = setup({}, latest);
    // The fixture authorises transfer(me → bob, 1 XLM) on the native asset contract.
    const d = await m.decode(req(STELLAR_METHODS.signAuthEntry, { entryXdr: FIX.authEntry }), ctx);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unknown-call" }));
    const edit = (f: (a: xdr.HashIdPreimageSorobanAuthorization) => void) => {
      const pre = xdr.HashIdPreimage.fromXDR(FIX.authEntry, "base64");
      f(pre.sorobanAuthorization());
      return pre.toXDR("base64");
    };
    // Another function: still a warning (its effects aren't previewed), at caution.
    const vote = edit((a) => a.invocation().function().contractFn().functionName("vote"));
    const v = await m.decode(req(STELLAR_METHODS.signAuthEntry, { entryXdr: vote }), ctx);
    expect(v.warnings.map((w) => [w.level, w.code])).toEqual([["caution", "unknown-call"]]);
    // Valid for a long time (about two months of ledgers): said so.
    const long = edit((a) => a.signatureExpirationLedger(4999940 + 1_000_000));
    const l = await m.decode(req(STELLAR_METHODS.signAuthEntry, { entryXdr: long }), ctx);
    expect(l.warnings.some((w) => /valid for a long time/i.test(w.message))).toBe(true);
    // Already expired: said so.
    const old = edit((a) => a.signatureExpirationLedger(4999000));
    const o = await m.decode(req(STELLAR_METHODS.signAuthEntry, { entryXdr: old }), ctx);
    expect(o.warnings.some((w) => /expired/i.test(w.message))).toBe(true);
  });

  it("SEP-43 auth entry for another network is refused", async () => {
    const { m, ctx } = setup();
    const pre = xdr.HashIdPreimage.fromXDR(FIX.authEntry, "base64");
    pre.sorobanAuthorization().networkId(Buffer.from(sha256(utf8(networkPassphrase("stellar:pubnet")))) as never);
    await rejects(m.decode(req(STELLAR_METHODS.signAuthEntry, { authEntry: pre.toXDR("base64") }), ctx), "stellar/network-mismatch");
    await rejects(m.prepare(req(STELLAR_METHODS.signAuthEntry, { authEntry: pre.toXDR("base64") }), ctx, "a"), "stellar/network-mismatch");
    await rejects(m.decode(req(STELLAR_METHODS.signAuthEntry, { authEntry: FIX.payment }), ctx), "stellar/bad-auth-entry");
  });

  it("message", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(req(STELLAR_METHODS.signMessage, { message: FIX.message }), ctx);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toEqual([{ label: "Message", value: FIX.message }]);
    const odd = await m.decode(req(STELLAR_METHODS.signMessage, { message: "a\u0001b" }), ctx);
    expect(odd.blind).toBe(true);
  });
});

describe("prepare / finalize", () => {
  it("stellar_signXDR round trip produces the signed envelope", async () => {
    const { m, ctx } = setup();
    const r = signXdr(FIX.payment);
    const payloads = await m.prepare(r, ctx, "ap1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ accountId: "stellar:0", scheme: "ed25519", approvalId: "ap1" });
    expect(hex(payloads[0]!.bytes)).toBe(hex(Uint8Array.from(TransactionBuilder.fromXDR(FIX.payment, PASS).hash())));
    const result = (await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as { signedXDR: string; signedTxXdr: string; signerAddress: string };
    const expected = TransactionBuilder.fromXDR(FIX.payment, PASS);
    expected.addDecoratedSignature(new xdr.DecoratedSignature({ hint: Buffer.from(pubOf(ME).slice(28)) as never, signature: Buffer.from(FIX.paymentSig, "hex") as never }));
    expect(result.signedXDR).toBe(expected.toEnvelope().toXDR("base64"));
    expect(result.signedTxXdr).toBe(result.signedXDR);
    expect(result.signerAddress).toBe(ME);
    const env = xdr.TransactionEnvelope.fromXDR(result.signedXDR, "base64");
    const sig = env.v1().signatures()[0]!;
    expect(hex(Uint8Array.from(sig.hint()))).toBe(hex(pubOf(ME).slice(28)));
    expect(hex(Uint8Array.from(sig.signature()))).toBe(FIX.paymentSig);
  });

  it("rejects a signature that doesn't match", async () => {
    const { m, ctx } = setup();
    const r = signXdr(FIX.payment);
    const [p] = await m.prepare(r, ctx, "a");
    const bad = { ...signer.sign(p!), bytes: new Uint8Array(64) };
    await rejects(m.finalize(r, [bad], ctx), "stellar/bad-signature", "The signature didn't match. Nothing was sent.");
    await rejects(m.finalize(signXdr(FIX.soroban), [signer.sign(p!)], ctx), "stellar/bad-signature");
  });

  it("stellar_signAndSubmitXDR (classic) posts to Horizon", async () => {
    const hash = hex(Uint8Array.from(TransactionBuilder.fromXDR(FIX.payment, PASS).hash()));
    const { m, ctx, calls } = setup({ "POST /transactions": { hash, successful: true, ledger: 5000001 } });
    const r = req(STELLAR_METHODS.signAndSubmitXDR, { xdr: FIX.payment });
    const [p] = await m.prepare(r, ctx, "a");
    const out = (await m.finalize(r, [signer.sign(p!)], ctx)) as Record<string, string>;
    expect(out.status).toBe("success");
    expect(out.hash).toBe(hash);
    expect(out.signedXDR).toBeTypeOf("string");
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://horizon-testnet.stellar.org/transactions");
    expect(decodeURIComponent(post.body!.slice(3))).toBe(out.signedXDR);
  });

  it("Horizon failures come back in plain words", async () => {
    const { m, ctx } = setup({ "POST /transactions": { status: 400, body: submitFailed } });
    const r = req(STELLAR_METHODS.signAndSubmitXDR, { xdr: FIX.payment });
    const [p] = await m.prepare(r, ctx, "a");
    await rejects(m.finalize(r, [signer.sign(p!)], ctx), "stellar/submit-failed", "This transaction is missing a signature it needs. Nothing was sent.");
  });

  it("Soroban submit: sendTransaction then getTransaction polling", async () => {
    let polls = 0;
    const { m, ctx } = setup({}, {
      sendTransaction: () => ({ status: "PENDING", hash: "ab", latestLedger: 1 }),
      getTransaction: () => (++polls < 3 ? getTxNotFound : { ...getTxNotFound, status: "SUCCESS" }),
    });
    const r = req(STELLAR_METHODS.signAndSubmitXDR, { xdr: FIX.soroban });
    const [p] = await m.prepare(r, ctx, "a");
    const out = (await m.finalize(r, [signer.sign(p!)], ctx)) as Record<string, string>;
    expect(out.status).toBe("success");
    expect(out.hash).toBe(hex(Uint8Array.from(TransactionBuilder.fromXDR(FIX.soroban, PASS).hash())));
    expect(polls).toBe(3);

    const pending = setup({}, { sendTransaction: () => ({ status: "PENDING", hash: "ab" }), getTransaction: () => getTxNotFound }, { pollAttempts: 2 });
    const out2 = (await pending.m.finalize(r, [signer.sign(p!)], pending.ctx)) as Record<string, string>;
    expect(out2.status).toBe("pending");

    const err = setup({}, { sendTransaction: () => sendError });
    await rejects(err.m.finalize(r, [signer.sign(p!)], err.ctx), "stellar/submit-failed", "This transaction is missing a signature it needs. Nothing was sent.");
  });

  it("stellar_signAuthEntry: sha256(preimage) signed; signature returned", async () => {
    const { m, ctx } = setup();
    const r = req(STELLAR_METHODS.signAuthEntry, { authEntry: FIX.authEntry, networkPassphrase: PASS, address: ME });
    const [p] = await m.prepare(r, ctx, "a");
    expect(hex(p!.bytes)).toBe(hex(sha256(b64decode(FIX.authEntry))));
    const out = await m.finalize(r, [signer.sign(p!)], ctx);
    expect(out).toEqual({ signedAuthEntry: b64encode(Uint8Array.from(Buffer.from(FIX.authEntrySig, "hex"))), signerAddress: ME });
  });

  it("stellar_signMessage: SEP-53 bytes", async () => {
    const { m, ctx } = setup();
    const r = req(STELLAR_METHODS.signMessage, { message: FIX.message });
    const [p] = await m.prepare(r, ctx, "a");
    expect(hex(p!.bytes)).toBe(hex(sha256(utf8(`Stellar Signed Message:\n${FIX.message}`))));
    const out = (await m.finalize(r, [signer.sign(p!)], ctx)) as Record<string, string>;
    const b64 = b64encode(Uint8Array.from(Buffer.from(FIX.messageSig, "hex")));
    expect(out).toEqual({ signedMessage: b64, signature: b64, signerAddress: ME });
  });
});

describe("building", () => {
  it("buildTransfer XLM to an open account → exactly the fixture payment", async () => {
    const { m, ctx } = setup();
    const r = await m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "100000000" }, ctx);
    expect(r).toMatchObject({ origin: "clip-wallet", via: "injected", family: "stellar", networkId: NET, method: "stellar_signAndSubmitXDR" });
    expect((r.params as { xdr: string }).xdr).toBe(FIX.payment);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe(`Send 10 XLM to ${short(BOB)}`);
  });

  it("buildTransfer XLM to an unopened account → createAccount (≥ 1 XLM)", async () => {
    const { m, ctx } = setup({ [`/accounts/${BOB}`]: { status: 404, body: notFound } });
    const r = await m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "20000000" }, ctx);
    const tx = TransactionBuilder.fromXDR((r.params as { xdr: string }).xdr, PASS) as Transaction;
    expect(tx.operations[0]).toMatchObject({ type: "createAccount", destination: BOB, startingBalance: "2.0000000" });
    expect(tx.timeBounds).toEqual({ minTime: "0", maxTime: "1790000300" });
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "5000000" }, ctx), "stellar/below-minimum", "This also opens their Stellar account; it needs at least 1 XLM.");
  });

  it("buildTransfer USDC: needs the recipient's trustline", async () => {
    const usdcRef = classicAsset(NET, "USDC", USDC_T);
    const no = setup({ [`/accounts/${ME}`]: meWithUsdc });
    await rejects(no.m.buildTransfer({ asset: usdcRef, to: BOB, amount: "10000000" }, no.ctx), "stellar/no-trustline", "They need to add USDC to their Stellar account before they can receive it.");
    const yes = setup({ [`/accounts/${ME}`]: meWithUsdc, [`/accounts/${BOB}`]: bobWithUsdc });
    const r = await yes.m.buildTransfer({ asset: usdcRef, to: BOB, amount: "10000000" }, yes.ctx);
    const tx = TransactionBuilder.fromXDR((r.params as { xdr: string }).xdr, PASS) as Transaction;
    expect(tx.operations[0]).toMatchObject({ type: "payment", destination: BOB, amount: "1.0000000" });
    expect((tx.operations[0] as Operation.Payment).asset.equals(usdc)).toBe(true);
    await rejects(yes.m.buildTransfer({ asset: usdcRef, to: BOB, amount: "300000000" }, yes.ctx), "stellar/insufficient-token");
  });

  it("buildTransfer validation", async () => {
    const { m, ctx } = setup();
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: ME, amount: "1" }, ctx), "stellar/self-transfer");
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: "nope", amount: "1" }, ctx), "stellar/bad-address");
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", amount: "1" }, ctx), "stellar/contract-recipient");
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "0" }, ctx), "stellar/bad-amount");
    await rejects(m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "999999999999999" }, ctx), "stellar/insufficient-balance");
    const fresh = setup({ [`/accounts/${ME}`]: { status: 404, body: notFound } });
    await rejects(fresh.m.buildTransfer({ asset: xlmAsset(NET), to: BOB, amount: "1" }, fresh.ctx), "stellar/not-activated");
  });

  it("buildAddAsset / buildRemoveAsset", async () => {
    const meNoUsdc = { ...meAccount, balances: meAccount.balances.filter((b) => b.asset_issuer !== USDC_T) };
    const { m, ctx } = setup({ [`/accounts/${ME}`]: meNoUsdc });
    const r = await m.buildAddAsset({ asset: { code: "USDC", issuer: USDC_T } }, ctx);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Add USDC to your account");
    expect(d.lines).toContainEqual({ label: "Also", value: "This sets aside 0.5 XLM of your balance while USDC is added." });
    await rejects(setup().m.buildAddAsset({ asset: classicAsset(NET, "USDC", USDC_T) }, setup().ctx), "stellar/already-added");
    const rm = setup();
    const r2 = await rm.m.buildRemoveAsset({ asset: classicAsset(NET, "USDC", USDC_T) }, rm.ctx);
    expect((await rm.m.decode(r2, rm.ctx)).title).toBe("Remove USDC from your account");
    const full = setup({ [`/accounts/${ME}`]: meWithUsdc });
    await rejects(full.m.buildRemoveAsset({ asset: classicAsset(NET, "USDC", USDC_T) }, full.ctx), "stellar/trustline-not-empty");
    await rejects(m.buildAddAsset({ asset: xlmAsset(NET) }, ctx), "stellar/bad-asset");
  });
});

describe("balances", () => {
  it("native + trustlines (zero balances included), look-alike flagged", async () => {
    const { m, ctx } = setup();
    const b = await m.getBalances(ctx);
    expect(b[0]).toEqual({ asset: xlmAsset(NET), amount: "199316990286" });
    expect(b).toContainEqual({ asset: expect.objectContaining({ key: "usdc", symbol: "USDC" }), amount: "0" });
    expect(b).toContainEqual({ asset: expect.objectContaining({ key: `stellar:USDC-${USDC_ISSUERS.pubnet}`, spam: true }), amount: "0" });
    expect(await m.getNfts(ctx)).toEqual([]);
  });

  it("unopened account → 0 XLM; spendable subtracts the minimum balance", async () => {
    const fresh = setup({ [`/accounts/${ME}`]: { status: 404, body: notFound } });
    expect(await fresh.m.getBalances(fresh.ctx)).toEqual([{ asset: xlmAsset(NET), amount: "0" }]);
    expect(await fresh.m.spendable(fresh.ctx)).toBe("0");
    const { m, ctx } = setup();
    // (2 + 2 subentries) × 0.5 XLM = 2 XLM locked
    expect(await m.spendable(ctx)).toBe((199316990286n - 20000000n).toString());
  });
});

describe("errors", () => {
  it("maps Horizon and XDR result codes", () => {
    expect(plainStellarError("tx_bad_seq")).toBe("Another transaction from your account went through first. Try again.");
    expect(plainStellarError("txTooLate")).toBe("This transaction expired before it was sent. Try again.");
    expect(plainStellarError("tx_failed", ["op_success", "op_no_trust"])).toBe("They need to add this asset to their Stellar account before they can receive it.");
    expect(plainStellarError("tx_failed", ["op_low_reserve"])).toMatch(/0\.5 XLM/);
    expect(plainStellarError("tx_insufficient_fee")).toMatch(/busy/);
    expect(plainStellarError("weird")).toBe("Stellar rejected this transaction. Nothing was sent.");
  });
});


describe("Horizon reads retry transient failures (dapp matrix regression)", () => {
  const ACCOUNT_JSON = { id: "GB4NG3E6SHS5PKVVIRSYJZFG5GKLBLHLR7B46F2HJF5L2FZIKGYBVYVJ", sequence: "1", balances: [{ asset_type: "native", balance: "10.0000000" }], subentry_count: 0 };
  const flaky = (failures: ("throw" | 503)[]) => {
    let n = 0;
    return (async () => {
      const f = failures[n++];
      if (f === "throw") throw new TypeError("fetch failed");
      if (f === 503) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(ACCOUNT_JSON));
    }) as unknown as typeof fetch;
  };

  it("answers after a dropped connection and a 503 instead of reporting offline", async () => {
    const h = new Horizon("https://horizon.example", flaky(["throw", 503]), [0, 0]);
    expect((await h.account(ACCOUNT_JSON.id))?.sequence).toBe("1");
  });

  it("still reports offline after the retries run out", async () => {
    const h = new Horizon("https://horizon.example", flaky(["throw", "throw", "throw"]), [0, 0]);
    await expect(h.account(ACCOUNT_JSON.id)).rejects.toMatchObject({ code: "stellar/offline" });
  });
});
