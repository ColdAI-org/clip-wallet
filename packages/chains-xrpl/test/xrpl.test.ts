import { ClipError, type DappRequest, WALLET_ORIGIN } from "@clip-wallet/core";
import { decode as rbcDecode, encodeForSigning } from "ripple-binary-codec";
import { deriveAddress, verify } from "ripple-keypairs";
import { hashes } from "xrpl";
import { describe, expect, it } from "vitest";
import {
  RLUSD_CODE,
  USDC_CODE,
  XRPL_DEVNET,
  XRPL_MAINNET,
  XRPL_METHODS,
  XRPL_NETWORKS,
  XRPL_TESTNET,
  createXrplModule,
  encodeXAddress,
  fromChainId,
  knownTokens,
  tokenAsset,
} from "../src/index.js";
import { fromHex } from "../src/util.js";
import { BOB, DAPP_FILLED, DAPP_UNFILLED, EXCHANGE, LLS, ME, NEWBIE, PUB, RLUSD_ISSUER, RLUSD_SEND, SEQ, XRP_SEND } from "./fixtures.js";
import { account, ctxFor, mockRpc, notFound, signer } from "./helpers.js";
import { SIGS } from "./signatures.js";

const mod = createXrplModule({ confirmPollMs: 0, confirmAttempts: 3 });
const xrp = XRPL_TESTNET.nativeAsset;
const rlusd = tokenAsset(XRPL_TESTNET.id, RLUSD_CODE, RLUSD_ISSUER);

function req(method: string, params: unknown, over: Partial<DappRequest> = {}): DappRequest {
  return { id: Math.random().toString(36).slice(2), origin: "https://dapp.example", via: "injected", family: "xrpl", networkId: XRPL_TESTNET.id, method, params, ...over };
}

async function run(r: DappRequest, ctx: ReturnType<typeof ctxFor>, m = mod) {
  const d = await m.decode(r, ctx);
  const payloads = await m.prepare(r, ctx, "approval-1");
  const out = await m.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
  return { d, payloads, out };
}

describe("networks", () => {
  it("uses CAIP-2 / XLS-72d ids and checked endpoints", () => {
    expect(XRPL_NETWORKS.map((n) => n.id)).toEqual(["xrpl:1", "xrpl:0", "xrpl:2"]);
    expect(XRPL_MAINNET.testnet).toBe(false);
    expect(fromChainId("xrpl:testnet")).toBe("xrpl:1");
    expect(fromChainId("xrpl:mainnet")).toBe("xrpl:0");
    expect(fromChainId("xrpl:21337")).toBeNull();
    expect(knownTokens(XRPL_MAINNET.id).map((a) => [a.key, a.address])).toEqual([
      ["rlusd", `${RLUSD_CODE}.rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De`],
      ["usdc", `${USDC_CODE}.rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE`],
    ]);
    expect(knownTokens(XRPL_DEVNET.id)).toEqual([]);
  });

  it("marks look-alike stablecoins from other issuers as spam", () => {
    expect(tokenAsset(XRPL_TESTNET.id, RLUSD_CODE, RLUSD_ISSUER)).toMatchObject({ key: "rlusd", symbol: "RLUSD", decimals: 6 });
    expect(tokenAsset(XRPL_TESTNET.id, RLUSD_CODE, BOB)).toMatchObject({ symbol: "RLUSD", spam: true });
    expect(tokenAsset(XRPL_TESTNET.id, USDC_CODE, RLUSD_ISSUER).spam).toBe(true);
    expect(tokenAsset(XRPL_TESTNET.id, "SOL", BOB)).toMatchObject({ key: `xrpl:SOL.${BOB}`, decimals: 15 });
    expect(tokenAsset(XRPL_TESTNET.id, "SOL", BOB).spam).toBeUndefined();
  });
});

describe("addresses", () => {
  it("derives the abandon account like ripple-keypairs and checks checksums", () => {
    expect(mod.addressFromPublicKey(fromHex(PUB), XRPL_TESTNET)).toBe(ME);
    expect(deriveAddress(PUB)).toBe(ME);
    expect(mod.derivationPath(0)).toBe("m/44'/144'/0'/0/0");
    expect(mod.derivationPath(2)).toBe("m/44'/144'/2'/0/0");
    expect(mod.curve).toBe("secp256k1");
    expect(mod.isAddress(ME)).toBe(true);
    expect(mod.isAddress(`${ME.slice(0, -1)}4`)).toBe(false);
    expect(mod.isAddress("0x1234")).toBe(false);
    expect(mod.networksForAddress(ME, XRPL_NETWORKS)).toHaveLength(3);
    const testX = encodeXAddress(BOB, 7, true);
    expect(mod.isAddress(testX)).toBe(true);
    expect(mod.networksForAddress(testX, XRPL_NETWORKS).map((n) => n.id)).toEqual(["xrpl:1", "xrpl:2"]);
    expect(mod.networksForAddress(encodeXAddress(BOB, null, false), XRPL_NETWORKS).map((n) => n.id)).toEqual(["xrpl:0"]);
  });
});

describe("balances", () => {
  it("lists XRP, RLUSD and other trust lines; skips negative (issued) lines; reports the reserve", async () => {
    const { fetch } = mockRpc({
      account_info: () => account(ME, { Balance: "25000000", OwnerCount: 3 }),
      account_lines: () => ({
        lines: [
          { account: RLUSD_ISSUER, balance: "12.3456789", currency: RLUSD_CODE, limit: "1000" },
          { account: BOB, balance: "5", currency: USDC_CODE, limit: "1000" },
          { account: EXCHANGE, balance: "-3", currency: "EUR", limit: "0" },
        ],
      }),
    });
    const b = await mod.getBalances(ctxFor(fetch));
    expect(b.map((x) => [x.asset.key, x.amount, x.asset.spam ?? false])).toEqual([
      ["xrp", "25000000", false],
      ["rlusd", "12345678", false],
      [`xrpl:${USDC_CODE}.${BOB}`, "5000000000000000", true],
    ]);
    expect(await mod.spendable(ctxFor(fetch))).toEqual({ balance: "25000000", locked: "1600000", spendable: "23400000", baseReserve: "1000000", ownerReserve: "200000", ownerCount: 3 });
  });

  it("an account that was never funded has 0 XRP", async () => {
    const { fetch } = mockRpc({ account_info: notFound });
    expect(await mod.getBalances(ctxFor(fetch))).toEqual([{ asset: xrp, amount: "0" }]);
  });
});

describe("buildTransfer → decode → prepare → finalize", () => {
  it("sends XRP: signs, submits, waits for validation (cross-checked with xrpl.js)", async () => {
    const { fetch, calls } = mockRpc();
    const ctx = ctxFor(fetch);
    const r = await mod.buildTransfer({ asset: xrp, to: BOB, amount: "1500000" }, ctx);
    expect(r).toMatchObject({ origin: WALLET_ORIGIN, method: XRPL_METHODS.signAndSubmitTransaction, family: "xrpl", networkId: "xrpl:1" });
    expect((r.params as { tx_json: unknown }).tx_json).toEqual(XRP_SEND);
    const { d, payloads, out } = await run(r, ctx);
    expect(d.title).toBe("Send 1.5 XRP to rPT1…pAYe");
    expect(d.titleMsg?.id ?? "bg.req.sendTo").toBe("bg.req.sendTo");
    expect(d.balanceChanges).toEqual([{ asset: xrp, delta: "-1500000" }]);
    expect(d.fee).toEqual({ asset: xrp, amount: "12" });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "0.000012 XRP" });
    expect(d.blind).toBe(false);
    expect(d.warnings).toEqual([]);
    // The digest is what ripple-binary-codec signs (encodeForSigning), and the vault's signature verifies with ripple-keypairs.
    expect(payloads).toHaveLength(1);
    const submitted = calls.find((c) => c.method === "submit")!.params.tx_blob as string;
    expect(verify(encodeForSigning(XRP_SEND as never), (rbcDecode(submitted) as { TxnSignature: string }).TxnSignature, PUB)).toBe(true);
    expect(rbcDecode(submitted)).toMatchObject({ ...XRP_SEND });
    expect(out).toMatchObject({ tx_hash: hashes.hashSignedTx(submitted), tx_json: { validated: true } });
  });

  it("sends RLUSD to someone who has added it", async () => {
    const { fetch, calls } = mockRpc({
      account_lines: (p) =>
        p.account === ME
          ? { lines: [{ account: RLUSD_ISSUER, balance: "10", currency: RLUSD_CODE, limit: "1000000" }] }
          : { lines: [{ account: RLUSD_ISSUER, balance: "0", currency: RLUSD_CODE, limit: "1000000" }] },
    });
    const ctx = ctxFor(fetch);
    const r = await mod.buildTransfer({ asset: rlusd, to: BOB, amount: "2500000" }, ctx);
    expect((r.params as { tx_json: unknown }).tx_json).toEqual(RLUSD_SEND);
    const { d } = await run(r, ctx);
    expect(d.title).toBe("Send 2.5 RLUSD to rPT1…pAYe");
    expect(d.balanceChanges).toEqual([{ asset: rlusd, delta: "-2500000" }]);
    expect(d.lines).toContainEqual({ label: "Token", value: `RLUSD · ${RLUSD_ISSUER}` });
    expect(calls.some((c) => c.method === "submit")).toBe(true);
  });

  it("refuses in plain words: own address, reserve, unfunded recipient, missing tag, no trust line", async () => {
    const ctx = ctxFor(mockRpc().fetch);
    await expect(mod.buildTransfer({ asset: xrp, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "xrpl/self-transfer" });
    await expect(mod.buildTransfer({ asset: xrp, to: "rNotAnAddress", amount: "1" }, ctx)).rejects.toMatchObject({ code: "xrpl/bad-address" });
    await expect(mod.buildTransfer({ asset: xrp, to: BOB, amount: "49000000" }, ctx)).rejects.toMatchObject({
      code: "xrpl/insufficient-funds",
      userMessage: "You don't have enough XRP. 1.2 XRP has to stay in your account, and the fee is 0.000012 XRP.",
    });
    const unfunded = ctxFor(mockRpc({ account_info: (p) => (p.account === NEWBIE ? notFound() : account(String(p.account))) }).fetch);
    await expect(mod.buildTransfer({ asset: xrp, to: NEWBIE, amount: "500000" }, unfunded)).rejects.toMatchObject({ code: "xrpl/too-small" });
    await expect(mod.buildTransfer({ asset: xrp, to: NEWBIE, amount: "1000000" }, unfunded)).resolves.toBeTruthy();
    const tagged = ctxFor(mockRpc({ account_info: (p) => account(String(p.account), p.account === EXCHANGE ? { Flags: 0x00020000 } : {}) }).fetch);
    await expect(mod.buildTransfer({ asset: xrp, to: EXCHANGE, amount: "1000000" }, tagged)).rejects.toMatchObject({ code: "xrpl/memo-required" });
    const viaX = await mod.buildTransfer({ asset: xrp, to: encodeXAddress(EXCHANGE, 12345, true), amount: "1000000" }, tagged);
    expect((viaX.params as { tx_json: Record<string, unknown> }).tx_json).toMatchObject({ Destination: EXCHANGE, DestinationTag: 12345 });
    await expect(mod.buildTransfer({ asset: xrp, to: encodeXAddress(EXCHANGE, 1, false), amount: "1" }, tagged)).rejects.toMatchObject({ code: "xrpl/network-mismatch" });
    const noLine = ctxFor(mockRpc({ account_lines: (p) => (p.account === ME ? { lines: [{ account: RLUSD_ISSUER, balance: "10", currency: RLUSD_CODE, limit: "1" }] } : { lines: [] }) }).fetch);
    await expect(mod.buildTransfer({ asset: rlusd, to: BOB, amount: "1000000" }, noLine)).rejects.toMatchObject({ code: "xrpl/no-trust-line" });
    const keyOff = ctxFor(mockRpc({ account_info: (p) => account(String(p.account), p.account === ME ? { Flags: 0x00100000, RegularKey: BOB } : {}) }).fetch);
    await expect(mod.buildTransfer({ asset: xrp, to: BOB, amount: "1" }, keyOff)).rejects.toMatchObject({ code: "xrpl/master-disabled" });
    await expect(mod.decode(req(XRPL_METHODS.signTransaction, { tx_json: XRP_SEND }), keyOff)).rejects.toMatchObject({ code: "xrpl/master-disabled" });
    const me0 = ctxFor(mockRpc({ account_info: notFound }).fetch);
    await expect(mod.buildTransfer({ asset: xrp, to: BOB, amount: "1" }, me0)).rejects.toMatchObject({ code: "xrpl/not-activated" });
  });
});

describe("dapp requests (XLS-72d)", () => {
  it("autofills once, signs exactly what was shown, returns signed_tx_blob without submitting", async () => {
    const { fetch, calls } = mockRpc();
    const ctx = ctxFor(fetch);
    const r = req(XRPL_METHODS.signTransaction, { tx_json: DAPP_UNFILLED, account: ME, network: "xrpl:testnet", options: { autofill: true } });
    const { d, out } = await run(r, ctx);
    expect(d.title).toBe("Change your account settings");
    expect(d.lines).toContainEqual({ label: "Memo", value: "hello xrp" });
    expect(d.lines).toContainEqual({ label: "Sent by", value: "dapp.example (it gets the signed transaction)" });
    const blob = (out as { signed_tx_blob: string }).signed_tx_blob;
    expect(rbcDecode(blob)).toMatchObject({ ...DAPP_FILLED, Sequence: SEQ, LastLedgerSequence: LLS });
    expect(verify(encodeForSigning(DAPP_FILLED as never), (rbcDecode(blob) as { TxnSignature: string }).TxnSignature, PUB)).toBe(true);
    expect(calls.filter((c) => c.method === "fee")).toHaveLength(1);
    expect(calls.some((c) => c.method === "submit")).toBe(false);
  });

  it("refuses a bad signature before broadcasting", async () => {
    const { fetch, calls } = mockRpc();
    const ctx = ctxFor(fetch);
    const r = req(XRPL_METHODS.signAndSubmitTransaction, { tx_json: XRP_SEND, account: ME, network: "xrpl:1" });
    await mod.decode(r, ctx);
    await mod.prepare(r, ctx, "a");
    const bad = fromHex(SIGS.RLUSD_SEND);
    await expect(mod.finalize(r, [{ scheme: "ecdsa-secp256k1", bytes: bad, recovery: 0, publicKey: PUB }], ctx)).rejects.toMatchObject({ code: "xrpl/bad-signature" });
    expect(calls.some((c) => c.method === "submit")).toBe(false);
  });

  it("refuses another network, another account, multisig and already-signed transactions", () => {
    const ctx = ctxFor(mockRpc().fetch);
    const n = (p: unknown, over: Partial<DappRequest> = {}) => () => mod.normalize(req(XRPL_METHODS.signTransaction, p, over), ctx);
    expect(n({ tx_json: XRP_SEND, network: "xrpl:0" })).toThrow(expect.objectContaining({ code: "xrpl/network-mismatch" }));
    expect(n({ tx_json: XRP_SEND }, { networkId: "xrpl:0" })).toThrow(expect.objectContaining({ code: "xrpl/network-mismatch" }));
    expect(n({ tx_json: { ...XRP_SEND, NetworkID: 21337 } })).toThrow(expect.objectContaining({ code: "xrpl/network-mismatch" }));
    expect(n({ tx_json: { ...XRP_SEND, Account: BOB } })).toThrow(expect.objectContaining({ code: "xrpl/wrong-account" }));
    expect(n({ tx_json: XRP_SEND, account: BOB })).toThrow(expect.objectContaining({ code: "xrpl/wrong-account" }));
    expect(n({ tx_json: XRP_SEND, options: { multisig: true } })).toThrow(expect.objectContaining({ code: "xrpl/unsupported" }));
    expect(n({ tx_json: { ...XRP_SEND, TxnSignature: "00" } })).toThrow(ClipError);
    expect(n({ tx_json: { ...XRP_SEND, SigningPubKey: "02".padEnd(66, "1") } })).toThrow(expect.objectContaining({ code: "xrpl/wrong-account" }));
    expect(() => mod.normalize(req("xrpl:signMessage", {}), ctx)).toThrow(expect.objectContaining({ code: "xrpl/unsupported-method" }));
    // API v2 DeliverMax becomes Amount; a NetworkID equal to a low network id is dropped (rippled refuses it there).
    const ok = mod.normalize(req(XRPL_METHODS.signTransaction, { tx_json: { ...XRP_SEND, Amount: undefined, DeliverMax: "5", NetworkID: 1 } }), ctx);
    expect(ok.tx).toMatchObject({ Amount: "5" });
    expect(ok.tx.NetworkID).toBeUndefined();
    expect(ok.tx.DeliverMax).toBeUndefined();
  });

  it("an unknown transaction type is blind, and can't be signed", async () => {
    const ctx = ctxFor(mockRpc().fetch);
    const r = req(XRPL_METHODS.signTransaction, { tx_json: { ...XRP_SEND, TransactionType: "CheckCreate", SendMax: "1" } });
    const d = await mod.decode(r, ctx);
    expect(d.blind).toBe(true);
    expect(d.warnings.map((w) => w.code)).toContain("blind-signing");
    await expect(mod.prepare(r, ctx, "a")).rejects.toMatchObject({ code: "xrpl/unreadable-operation" });
    const field = await mod.decode(req(XRPL_METHODS.signTransaction, { tx_json: { ...XRP_SEND, Delegate: BOB } }), ctx);
    expect(field.blind).toBe(true);
    expect(field.warnings.some((w) => w.message.includes("(Delegate)"))).toBe(true);
  });

  it("explains a submit the ledger refuses, and a validated failure", async () => {
    const refused = ctxFor(mockRpc({ submit: () => ({ engine_result: "tefPAST_SEQ" }) }).fetch);
    const r = req(XRPL_METHODS.signAndSubmitTransaction, { tx_json: XRP_SEND });
    await mod.decode(r, refused);
    const [p] = await mod.prepare(r, refused, "a");
    await expect(mod.finalize(r, [signer.sign(p!)], refused)).rejects.toMatchObject({ code: "xrpl/send-failed", userMessage: expect.stringContaining("out of date") });
    const failed = ctxFor(mockRpc({ tx: (q) => ({ hash: q.transaction, validated: true, meta: { TransactionResult: "tecPATH_DRY" } }) }).fetch);
    const r2 = req(XRPL_METHODS.signAndSubmitTransaction, { tx_json: XRP_SEND });
    await mod.decode(r2, failed);
    const [p2] = await mod.prepare(r2, failed, "a");
    await expect(mod.finalize(r2, [signer.sign(p2!)], failed)).rejects.toMatchObject({ code: "xrpl/failed", userMessage: expect.stringContaining("fee was still charged") });
  });
});

describe("decode", () => {
  const ctx = (over = {}) => ctxFor(mockRpc(over).fetch);
  const dec = (tx: Record<string, unknown>, over = {}) => mod.decode(req(XRPL_METHODS.signTransaction, { tx_json: { ...XRP_SEND, ...tx } }), ctx(over));

  it("partial payments are a danger: the recipient can get far less", async () => {
    const d = await dec({ Flags: 0x00020000, Amount: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "1000" }, SendMax: "1000000" }, {
      account_lines: () => ({ lines: [{ account: RLUSD_ISSUER, balance: "0", currency: RLUSD_CODE, limit: "1" }] }),
    });
    expect(d.title).toBe("Pay up to 1 XRP so rPT1…pAYe gets 1000 RLUSD");
    expect(d.warnings.find((w) => w.code === "simulation-failed")).toMatchObject({ level: "danger", message: expect.stringContaining("partial payment") });
    expect(d.balanceChanges).toEqual([{ asset: xrp, delta: "-1000000" }]);
  });

  it("destination tags: required by the recipient → memo-required; shown when set", async () => {
    const needs = { account_info: (p: Record<string, unknown>) => account(String(p.account), p.account === BOB ? { Flags: 0x00020000 } : {}) };
    expect((await dec({}, needs)).warnings.map((w) => w.code)).toContain("memo-required");
    const d = await dec({ DestinationTag: 77 }, needs);
    expect(d.warnings.map((w) => w.code)).not.toContain("memo-required");
    expect(d.lines).toContainEqual({ label: "Destination tag", value: "77" });
  });

  it("a new account receiving less than the base reserve fails", async () => {
    const d = await dec({ Amount: "500000" }, { account_info: (p: Record<string, unknown>) => (p.account === BOB ? notFound() : account(String(p.account))) });
    expect(d.warnings.find((w) => w.message.includes("doesn't exist yet"))).toMatchObject({ level: "danger" });
    const ok = await dec({ Amount: "2000000" }, { account_info: (p: Record<string, unknown>) => (p.account === BOB ? notFound() : account(String(p.account))) });
    expect(ok.warnings.find((w) => w.code === "new-recipient")).toMatchObject({ level: "info" });
  });

  it("spending into the reserve is flagged", async () => {
    const d = await dec({ Amount: "49500000" });
    expect(d.warnings.find((w) => w.message.includes("reserve"))).toMatchObject({ level: "danger", code: "simulation-failed" });
  });

  it("TrustSet, OfferCreate, AccountSet flags in words", async () => {
    const trust = await dec({ TransactionType: "TrustSet", Destination: undefined, Amount: undefined, LimitAmount: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "1000000" } });
    expect(trust.title).toBe("Add RLUSD to your account");
    expect(trust.lines).toContainEqual({ label: "Locks", value: "0.2 XRP of your XRP stays locked while this token is added" });
    const spam = await dec({ TransactionType: "TrustSet", Destination: undefined, Amount: undefined, LimitAmount: { currency: USDC_CODE, issuer: BOB, value: "1" } });
    expect(spam.warnings.map((w) => w.code)).toContain("known-scam");
    const remove = await dec({ TransactionType: "TrustSet", Destination: undefined, Amount: undefined, LimitAmount: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "0" } });
    expect(remove.title).toBe("Remove RLUSD from your account");
    const offer = await dec({ TransactionType: "OfferCreate", Destination: undefined, Amount: undefined, TakerGets: "10000000", TakerPays: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "5" }, Flags: 0x00020000 });
    expect(offer.title).toBe("Trade 10 XRP for 5 RLUSD");
    expect(offer.balanceChanges).toEqual([{ asset: xrp, delta: "-10000000" }, { asset: rlusd, delta: "5000000" }]);
    expect(offer.lines).toContainEqual({ label: "Kind", value: "Fill what it can now, cancel the rest" });
    const set = await dec({ TransactionType: "AccountSet", Destination: undefined, Amount: undefined, SetFlag: 1, ClearFlag: 3, Domain: "6578616D706C652E636F6D", Flags: 0x00100000 });
    expect(set.title).toBe("Change your account settings");
    expect(set.lines).toEqual(expect.arrayContaining([
      { label: "Turns on", value: "Require a destination tag on payments to you" },
      { label: "Turns off", value: "Ask people not to send you XRP" },
      { label: "Turns on", value: "Ask people not to send you XRP" },
      { label: "Domain", value: "example.com" },
    ]));
    expect((await dec({ TransactionType: "AccountSet", Destination: undefined, Amount: undefined, SetFlag: 99 })).blind).toBe(true);
  });

  it("key changes are account-takeover; AccountDelete is account-closure", async () => {
    const master = await dec({ TransactionType: "AccountSet", Destination: undefined, Amount: undefined, SetFlag: 4 });
    expect(master.warnings.find((w) => w.code === "account-takeover")).toMatchObject({ level: "danger" });
    const regular = await dec({ TransactionType: "SetRegularKey", Destination: undefined, Amount: undefined, RegularKey: BOB });
    expect(regular.title).toBe("Give rPT1…pAYe control of your account");
    expect(regular.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });
    expect((await dec({ TransactionType: "SetRegularKey", Destination: undefined, Amount: undefined })).warnings).toEqual([]);
    const signers = await dec({ TransactionType: "SignerListSet", Destination: undefined, Amount: undefined, SignerQuorum: 1, SignerEntries: [{ SignerEntry: { Account: BOB, SignerWeight: 1 } }] });
    expect(signers.title).toBe("Let 1 other accounts sign for yours");
    expect(signers.warnings[0]).toMatchObject({ level: "danger", code: "account-takeover" });
    const del = await dec({ TransactionType: "AccountDelete", Amount: undefined, Fee: "200000" });
    expect(del.title).toBe("Close your XRP Ledger account and send everything to rPT1…pAYe");
    expect(del.warnings[0]).toMatchObject({ level: "danger", code: "account-closure" });
    expect(del.balanceChanges).toEqual([{ asset: xrp, delta: "-49800000" }]);
  });

  it("NFTs and escrows", async () => {
    const id = "000B013A95F14B0044F78A264E41713C64B5F89242540EE208C3098E00000D65";
    const mint = await dec({ TransactionType: "NFTokenMint", Destination: undefined, Amount: undefined, NFTokenTaxon: 0, Flags: 8, TransferFee: 500, URI: "697066733A2F2F62616679" });
    expect(mint.title).toBe("Create an NFT");
    expect(mint.lines).toEqual(expect.arrayContaining([{ label: "Link", value: "ipfs://bafy" }, { label: "Royalty", value: "0.5%" }]));
    const give = await dec({ TransactionType: "NFTokenCreateOffer", Destination: undefined, NFTokenID: id, Amount: "0", Flags: 1 });
    expect(give.warnings[0]).toMatchObject({ level: "danger", message: "Anyone can take this NFT for nothing." });
    const buy = await dec({
      TransactionType: "NFTokenAcceptOffer",
      Destination: undefined,
      Amount: undefined,
      NFTokenSellOffer: "68CD1F6F906494EA08C9CB5CAFA64DFA90D4E834B7151899B73231DE5A0C3B77",
    }, { ledger_entry: () => ({ node: { LedgerEntryType: "NFTokenOffer", Amount: "3000000", NFTokenID: id, Owner: BOB, Flags: 1 } }) });
    expect(buy.title).toBe("Buy an NFT for 3 XRP");
    expect(buy.balanceChanges).toEqual([{ asset: xrp, delta: "-3000000" }]);
    const burn = await dec({ TransactionType: "NFTokenBurn", Destination: undefined, Amount: undefined, NFTokenID: id });
    expect(burn.title).toBe("Burn an NFT");
    const esc = await dec({ TransactionType: "EscrowCreate", Amount: "10000000", FinishAfter: 0, CancelAfter: 86400 });
    expect(esc.title).toBe("Lock 10 XRP in escrow for rPT1…pAYe");
    expect(esc.lines).toContainEqual({ label: "Can be released after", value: "2000-01-01 00:00:00 UTC" });
    expect(esc.warnings[0]).toMatchObject({ code: "durable-nonce" });
  });

  it("AMM deposit and withdraw", async () => {
    const amm = { Destination: undefined, Asset: { currency: "XRP" }, Asset2: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER } };
    const dep = await dec({ ...amm, TransactionType: "AMMDeposit", Flags: 0x00100000, Amount: "1000000", Amount2: { currency: RLUSD_CODE, issuer: RLUSD_ISSUER, value: "0.5" } });
    expect(dep.title).toBe("Add funds to a liquidity pool");
    expect(dep.lines).toContainEqual({ label: "Pool", value: "XRP / RLUSD" });
    expect(dep.balanceChanges).toEqual([{ asset: xrp, delta: "-1000000" }, { asset: rlusd, delta: "-500000" }]);
    const wd = await dec({ ...amm, TransactionType: "AMMWithdraw", Amount: undefined, Flags: 0x00020000 });
    expect(wd.title).toBe("Withdraw funds from a liquidity pool");
  });
});
