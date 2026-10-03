import { HEDERA_TESTNET, SIGN_TRANSACTION_BYTES } from "@clip-wallet/chains-hedera";
import { ScheduleCreateTransaction, Transaction, TransferTransaction } from "@hiero-ledger/sdk";
import type { DecodedRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { decodeOffer, encodeOffer, type OfferPayload } from "../src/trade/offer.js";
import { SecureTradeService, mirrorTxId } from "../src/trade/service.js";
import { ME_HEDERA, fakeHost, flush, hbar, mirrorAccount, mockFetch, sauce } from "./helpers.js";

const OTHER = "0.0.2002";
const SAUCE_TOKEN = { token_id: "0.0.1183558", name: "SAUCE", symbol: "SAUCE", decimals: "6", type: "FUNGIBLE_COMMON", total_supply: "1000" };

function mirror(opts: { otherHasSauce?: boolean; iHaveSauce?: boolean; schedule?: Record<string, unknown>; tx?: Record<string, unknown> } = {}) {
  return mockFetch([
    [/\/api\/v1\/tokens\/0\.0\.1183558/, SAUCE_TOKEN],
    [/\/accounts\/0\.0\.2002\/tokens\?token\.id/, { tokens: opts.otherHasSauce ? [{ token_id: "0.0.1183558", balance: 1, automatic_association: false }] : [] }],
    [/\/accounts\/0\.0\.2002\/tokens/, { tokens: [], links: { next: null } }],
    [/\/accounts\/0\.0\.1001\/tokens\?token\.id/, { tokens: opts.iHaveSauce ? [{ token_id: "0.0.1183558", balance: 1, automatic_association: false }] : [] }],
    [/\/accounts\/0\.0\.1001\/tokens/, { tokens: [], links: { next: null } }],
    [/\/accounts\/0\.0\.2002/, mirrorAccount(OTHER)],
    [/\/accounts\/0\.0\.1001/, mirrorAccount(ME_HEDERA)],
    [/\/schedules\/0\.0\.7777/, opts.schedule],
    [/\/transactions\//, opts.tx],
  ]);
}

describe("Secure Trade links", () => {
  const payload: OfferPayload = {
    v: 1, n: "hedera:testnet", mode: "scheduled", maker: OTHER, taker: ME_HEDERA,
    give: { kind: "asset", assetKey: "hts:0.0.1183558", symbol: "SAUCE", decimals: 6, amount: "5000000", tokenId: "0.0.1183558" },
    get: { kind: "asset", assetKey: "hbar", symbol: "HBAR", decimals: 8, amount: "1000000000" },
    schedule: "0.0.7777", expiresAt: 2_000_000_000_000,
  };

  it("round-trips, accepts the bare fragment, rejects junk plainly", () => {
    const link = encodeOffer("https://clipwallet.example/trade", payload);
    expect(link.startsWith("https://clipwallet.example/trade#offer=")).toBe(true);
    expect(decodeOffer(link)).toEqual(payload);
    expect(decodeOffer(link.split("#")[1]!)).toEqual(payload);
    expect(() => decodeOffer("https://evil.example")).toThrow("That isn't a Secure Trade link");
    const tampered = encodeOffer("x", { ...payload, maker: "alice" } as OfferPayload);
    expect(() => decodeOffer(tampered)).toThrow();
  });

  it("converts SDK transaction ids to mirror ids", () => {
    expect(mirrorTxId("0.0.1001@1790000000.5")).toBe("0.0.1001-1790000000-000000005");
  });
});

describe("SecureTradeService (maker)", () => {
  it("direct: adds what you'll receive first, signs without submitting, and shares a link", async () => {
    const { fetch } = mirror();
    const host = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch });
    const svc = new SecureTradeService(host, { linkBase: "https://clipwallet.example/trade" });
    const { offerId, queued } = await svc.createOffer({ give: { assetKey: "hbar", amount: "10" }, get: { assetKey: "hts:0.0.1183558", amount: "5" }, counterparty: OTHER, mode: "direct" });
    expect(queued.steps).toEqual(["Add SAUCE to your account", "Trade 10 HBAR for 5 SAUCE with 0.0.2002"]);
    host.enqueued[0]!.resolve({});
    await flush();
    const signReq = host.enqueued[1]!.request as { method: string; params: { transactionList: string } };
    expect(signReq.method).toBe(SIGN_TRANSACTION_BYTES);
    const tx = Transaction.fromBytes(Buffer.from(signReq.params.transactionList, "base64")) as TransferTransaction;
    expect(tx).toBeInstanceOf(TransferTransaction);
    expect(tx.hbarTransfers.get(ME_HEDERA)?.toTinybars().toString()).toBe("-1000000000");
    // The wallet hands back the transaction signed by the user (here: the same bytes stand in).
    host.enqueued[1]!.resolve({ transactionList: signReq.params.transactionList });
    await flush();
    const [offer] = await svc.list();
    expect(offer).toMatchObject({ id: offerId, role: "maker", status: "waiting", statusText: "Waiting for 0.0.2002 to accept" });
    expect(offer!.notes).toEqual([]); // they receive HBAR: nothing to add
    const p = decodeOffer(offer!.link!);
    expect(p).toMatchObject({ mode: "direct", maker: ME_HEDERA, taker: OTHER, tx: signReq.params.transactionList });
  });

  it("scheduled: creates the schedule, finds its id on the mirror node, then tracks its state", async () => {
    let state: Record<string, unknown> = { schedule_id: "0.0.7777", executed_timestamp: null, deleted: false, expiration_time: "4000000000.0", creator_account_id: ME_HEDERA, payer_account_id: ME_HEDERA, transaction_body: "", memo: "" };
    const { fetch } = mockFetch([
      [/\/schedules\/0\.0\.7777/, () => state],
      [/\/transactions\/0\.0\.1001-1790000000-000000000/, { transactions: [{ entity_id: "0.0.7777", result: "SUCCESS", name: "SCHEDULECREATE" }] }],
      [/\/accounts\/0\.0\.2002\/tokens\?token\.id/, { tokens: [{ token_id: "0.0.1183558" }] }],
      [/\/accounts\/0\.0\.1001\/tokens\?token\.id/, { tokens: [{ token_id: "0.0.1183558" }] }],
      [/\/accounts\/0\.0\.2002/, mirrorAccount(OTHER)],
      [/\/accounts\/0\.0\.1001/, mirrorAccount(ME_HEDERA)],
    ]);
    const host = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch });
    const svc = new SecureTradeService(host);
    const { queued } = await svc.createOffer({ give: { assetKey: "hts:0.0.1183558", amount: "5" }, get: { assetKey: "hbar", amount: "10" }, counterparty: OTHER, mode: "scheduled", expiresInHours: 48 });
    expect(queued.steps).toEqual(["Trade 5 SAUCE for 10 HBAR with 0.0.2002"]);
    const req = host.enqueued[0]!.request as { method: string; params: { transactionList: string } };
    expect(req.method).toBe("hedera_signAndExecuteTransaction");
    expect(Transaction.fromBytes(Buffer.from(req.params.transactionList, "base64"))).toBeInstanceOf(ScheduleCreateTransaction);
    host.enqueued[0]!.resolve({ transactionId: "0.0.1001@1790000000.0" });
    await flush();
    let [offer] = await svc.list();
    expect(offer).toMatchObject({ status: "waiting", mode: "scheduled" });
    expect(decodeOffer(offer!.link!).schedule).toBe("0.0.7777");
    state = { ...state, executed_timestamp: "1790000100.0" };
    [offer] = await svc.list();
    expect(offer).toMatchObject({ status: "done", statusText: "Done. Both sides moved" });
  });

  it("tells you when the other side must add the token you give", async () => {
    const { fetch } = mirror({ iHaveSauce: true });
    const host = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch });
    const svc = new SecureTradeService(host);
    await svc.createOffer({ give: { assetKey: "hts:0.0.1183558", amount: "5" }, get: { assetKey: "hbar", amount: "1" }, counterparty: OTHER, mode: "direct" });
    host.enqueued[0]!.reject(new Error("declined"));
    await flush();
    const [offer] = await svc.list();
    expect(offer!.notes).toEqual(["0.0.2002 must add SAUCE to their account before they can accept."]);
    expect(offer!.status).toBe("cancelled");
  });

  it("refuses unknown counterparties and trading with yourself", async () => {
    const { fetch } = mirror();
    const svc = new SecureTradeService(fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar()], fetch }));
    await expect(svc.createOffer({ give: { assetKey: "hbar", amount: "1" }, get: { assetKey: "hbar", amount: "1" }, counterparty: "0.0.9999", mode: "direct" })).rejects.toMatchObject({ code: "trade/unknown-counterparty" });
    await expect(svc.createOffer({ give: { assetKey: "hbar", amount: "1" }, get: { assetKey: "hbar", amount: "1" }, counterparty: ME_HEDERA, mode: "direct" })).rejects.toMatchObject({ code: "trade/self" });
  });
});

describe("SecureTradeService (taker)", () => {
  const offer = (over: Partial<OfferPayload> = {}): string =>
    encodeOffer("https://clipwallet.example/trade", {
      v: 1, n: "hedera:testnet", mode: "scheduled", maker: OTHER, taker: ME_HEDERA,
      give: { kind: "asset", assetKey: "hts:0.0.1183558", symbol: "SAUCE", decimals: 6, amount: "5000000", tokenId: "0.0.1183558" },
      get: { kind: "asset", assetKey: "hbar", symbol: "HBAR", decimals: 8, amount: "1000000000" },
      schedule: "0.0.7777",
      ...over,
    });
  const openSchedule = { schedule_id: "0.0.7777", executed_timestamp: null, deleted: false, expiration_time: "4000000000.0" };
  const decoded = (changes: [string | undefined, string][]): DecodedRequest => ({
    requestId: "r", title: "Approve scheduled: trade 10 HBAR for 5 SAUCE with 0.0.2002", lines: [{ label: "Schedule", value: "0.0.7777" }],
    balanceChanges: changes.map(([address, delta]) => ({ asset: address ? { ...sauce(), address } : hbar(), delta })), simulated: false, blind: false, warnings: [], networkId: "hedera:testnet",
  });

  it("checks the real transaction against the link, then queues add-token + accept", async () => {
    const { fetch } = mirror({ schedule: openSchedule });
    const host = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch, decode: async () => decoded([["0.0.1183558", "5000000"], [undefined, "-1000000000"]]) });
    const svc = new SecureTradeService(host);
    const review = await svc.review(offer());
    expect(review.problem).toBeUndefined();
    expect(review.steps).toEqual(["Add SAUCE to your account", "Accept the trade"]);
    expect(review.offer.title).toBe("Trade 10 HBAR for 5 SAUCE with 0.0.2002");
    const q = await svc.accept(offer());
    expect(q.steps).toEqual(["Add SAUCE to your account", "Trade 10 HBAR for 5 SAUCE with 0.0.2002"]);
    host.enqueued[0]!.resolve({});
    await flush();
    expect(host.enqueued[1]!.request.method).toBe("hedera_signAndExecuteTransaction");
  });

  it("a link that lies about the trade can't be accepted", async () => {
    const { fetch } = mirror({ schedule: openSchedule, iHaveSauce: true });
    const host = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch, decode: async () => decoded([["0.0.1183558", "5000000"], [undefined, "-9000000000"]]) });
    const svc = new SecureTradeService(host);
    const review = await svc.review(offer());
    expect(review.problem).toContain("doesn't match");
    await expect(svc.accept(offer())).rejects.toMatchObject({ code: "trade/cannot-accept" });
    // Extra outflow not in the link is refused too.
    const host2 = fakeHost({ networks: [HEDERA_TESTNET], assets: [hbar(), sauce()], fetch, decode: async () => decoded([["0.0.1183558", "5000000"], [undefined, "-1000000000"], ["0.0.999", "-1"]]) });
    expect((await new SecureTradeService(host2).review(offer())).problem).toContain("takes more");
  });

  it("not for you, expired, already done → plain problems", async () => {
    const done = mirror({ schedule: { ...openSchedule, executed_timestamp: "1.0" } });
    const host = fakeHost({ networks: [HEDERA_TESTNET], fetch: done.fetch });
    expect((await new SecureTradeService(host).review(offer())).problem).toBe("This trade already happened.");
    expect((await new SecureTradeService(host).review(offer({ taker: "0.0.3003" }))).problem).toBe("This offer is for 0.0.3003, not for you.");
    const direct = offer({ mode: "direct", schedule: undefined, tx: "AAAA", expiresAt: 1 });
    expect((await new SecureTradeService(host).review(direct)).problem).toBe("This offer expired. Nothing moved. Ask for a new one.");
  });
});
