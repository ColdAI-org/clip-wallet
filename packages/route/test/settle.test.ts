import { ClipError } from "@clip-wallet/core";
import type { AssetRef } from "@clip-wallet/core";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  hashTypedData,
  keccak256,
  toFunctionSelector,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  SETTLE_DEPOSIT_ABI,
  SETTLE_DEPOSIT_SELECTOR,
  SETTLE_ORDER_BOOK_ABI,
  SETTLE_QUOTE_TYPES,
  SettleClient,
  addressToBytes32,
  buildDepositRequests,
  compareConnectorQuotes,
  ledgerHash,
  quoteFromJson,
  recoverQuoteSigner,
  settleDomain,
  settleOnHedera,
  settleOrderId,
  type ConnectorQuote,
  type ConnectorQuoteRequest,
  type SettleOnHederaOptions,
} from "../src/index.js";
import { BASE_SEPOLIA, ETH_SEPOLIA, HBAR, SEPOLIA, USDC_BASE } from "./fixtures.js";
import vector from "./fixtures/settle-quote.json";

/*
 * Offline fixture: test/fixtures/settle-quote.json is CLPRouter sdk/test/vectors/settle-quote.json (branch
 * feat/settle-on-hedera). Its signature was made there by the public BIP-39 "abandon … about" test account
 * m/44'/60'/0'/0/0 (0x9858EfFD232B4033E47d90003D41EC34EcaEda94). Nothing here generates keys or signs.
 */

const ORDER_BOOK = getAddress(vector.orderBook);
const CONNECTOR = getAddress(vector.quoteJson.connector);
const DEPOSIT = getAddress("0xde90517000000000000000000000000000000001");
const OTHER = "0x00000000000000000000000000000000000000Ff" as const;
const USER = "0x0000000000000000000000000000000000001234" as const;
const REFUND_TO = getAddress(vector.quoteJson.refundTo);
const ORDER_ID = vector.orderId as Hex;
const T0 = vector.quoteJson.issuedAt; // 1800000000
const DEADLINE = vector.quoteJson.deadline;
const GRACE = 600;
const PENALTY_BPS = 1000n;
const COVER = BigInt(vector.quoteJson.coverAmount);
const OWED = COVER + (COVER * PENALTY_BPS) / 10_000n;
const CH_SRC = `0x${"c1".repeat(32)}` as Hex;
const CH_DST = `0x${"c2".repeat(32)}` as Hex;
const MIRROR = "https://mirror.example";
const HBAR_EVM: AssetRef = { ...HBAR, networkId: "eip155:296" };

type Status = 0 | 1 | 2 | 3 | 4 | 5;
interface World {
  hederaNow: number;
  registeredAt: bigint;
  validSigner: boolean;
  isCover: boolean;
  free: bigint;
  activeAt: bigint;
  depositSender: Hex;
  orders: Map<string, { status: Status; deadline?: number; reserved?: bigint; owedOnDefault?: bigint }>;
  owed: bigint;
  bond: [bigint, bigint, bigint, bigint];
  logs: unknown[];
  connectorAnswers: Record<string, () => Promise<Response> | Response>;
  calls: string[];
}

function world(over: Partial<World> = {}): World {
  return {
    hederaNow: T0 + 5,
    registeredAt: 1n,
    validSigner: true,
    isCover: true,
    free: OWED,
    activeAt: BigInt(T0 - 86400),
    depositSender: keccak256(DEPOSIT),
    orders: new Map(),
    owed: 0n,
    bond: [10n ** 15n, 2n * 10n ** 12n, 0n, 0n],
    logs: [],
    connectorAnswers: { "https://alpha.example": () => json(goodAnswer()) },
    calls: [],
    ...over,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function goodAnswer(over: Record<string, unknown> = {}, quoteOver: Record<string, unknown> = {}) {
  return {
    quote: { ...vector.quoteJson, ...quoteOver },
    signature: vector.signature,
    orderId: vector.orderId,
    srcLedgerId: SEPOLIA,
    dstLedgerId: BASE_SEPOLIA,
    fee: { asset: "0x0000000000000000000000000000000000000000", amount: "10000000000000000" },
    owedOnDefault: OWED.toString(),
    deliveryP90S: 300,
    connector: { name: "Alpha", address: CONNECTOR, signer: vector.signer },
    orderBook: ORDER_BOOK,
    hederaChainId: 296,
    ...over,
  };
}

function ret(functionName: string, result: unknown): Hex {
  return encodeFunctionResult({ abi: SETTLE_ORDER_BOOK_ABI, functionName, result } as never);
}

/** The order book on Hedera as the mirror node serves it, plus the Connectors' quote APIs. */
function fakeFetch(w: World): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    w.calls.push(url);
    for (const [base, answer] of Object.entries(w.connectorAnswers)) {
      if (url === `${base}/quote`) return answer();
    }
    if (url === `${MIRROR}/api/v1/blocks?limit=1&order=desc`) {
      return json({ blocks: [{ number: 1, timestamp: { from: `${w.hederaNow - 1}.5`, to: `${w.hederaNow}.250000000` } }] });
    }
    if (url.startsWith(`${MIRROR}/api/v1/contracts/${ORDER_BOOK}/results/logs?`)) return json({ logs: w.logs, links: { next: null } });
    if (url === `${MIRROR}/api/v1/contracts/call`) {
      const { to, data } = JSON.parse(String(init!.body)) as { to: string; data: Hex };
      expect(getAddress(to)).toBe(ORDER_BOOK);
      const { functionName, args } = decodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, data });
      const a = (args ?? []) as readonly any[];
      switch (functionName) {
        case "PROOF_GRACE":
          return json({ result: ret("PROOF_GRACE", BigInt(GRACE)) });
        case "connectors":
          return json({ result: ret("connectors", [vector.signer, "0x0000000000000000000000000000000000000000", 0n, getAddress(a[0]) === CONNECTOR ? w.registeredAt : 0n, 2]) });
        case "isValidSigner":
          return json({ result: ret("isValidSigner", w.validSigner && getAddress(a[1]) === getAddress(vector.signer)) });
        case "isCoverAsset":
          return json({ result: ret("isCoverAsset", w.isCover) });
        case "owedFor":
          return json({ result: ret("owedFor", (a[0] as bigint) + ((a[0] as bigint) * PENALTY_BPS) / 10_000n) });
        case "freeCapacity":
          return json({ result: ret("freeCapacity", w.free) });
        case "channelOfLedger":
          return json({ result: ret("channelOfLedger", a[0] === vector.quoteJson.srcLedger ? CH_SRC : a[0] === vector.quoteJson.dstLedger ? CH_DST : `0x${"00".repeat(32)}`) });
        case "sources": {
          const src = a[0] === CH_SRC;
          return json({
            result: ret("sources", [
              src ? vector.quoteJson.srcLedger : vector.quoteJson.dstLedger,
              src ? w.depositSender : `0x${"00".repeat(32)}`,
              src ? `0x${"00".repeat(32)}` : keccak256("0x00000000000000000000000000000000000000dd"),
              w.activeAt,
            ]),
          });
        }
        case "orders": {
          const o = w.orders.get(String(a[0]).toLowerCase());
          return json({
            result: ret("orders", [
              o ? CONNECTOR : "0x0000000000000000000000000000000000000000",
              o?.status ?? 0,
              BigInt(o?.deadline ?? (o ? DEADLINE : 0)),
              "0x0000000000000000000000000000000000000000",
              BigInt(o ? T0 + 60 : 0),
              o ? REFUND_TO : "0x0000000000000000000000000000000000000000",
              o ? vector.quoteJson.dstLedger : `0x${"00".repeat(32)}`,
              o ? vector.quoteJson.assetOut : `0x${"00".repeat(32)}`,
              o ? vector.quoteJson.recipient : `0x${"00".repeat(32)}`,
              o ? BigInt(vector.quoteJson.amountOut) : 0n,
              o?.status === 5 ? 0n : (o?.owedOnDefault ?? (o ? OWED : 0n)),
              o?.status === 5 ? 0n : (o?.reserved ?? (o ? OWED : 0n)),
            ]),
          });
        }
        case "owed":
          return json({ result: ret("owed", w.owed) });
        case "bonds":
          return json({ result: ret("bonds", w.bond) });
        default:
          return json({ _status: { messages: [{ message: "CONTRACT_REVERT_EXECUTED" }] } }, 400);
      }
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

function options(w: World, over: Partial<SettleOnHederaOptions> = {}): SettleOnHederaOptions {
  return {
    orderBook: ORDER_BOOK,
    hederaChainId: 296,
    mirrorNodeUrl: MIRROR,
    deposits: { [SEPOLIA]: DEPOSIT, [BASE_SEPOLIA]: OTHER },
    connectors: [{ id: CONNECTOR, name: "Alpha", url: "https://alpha.example" }],
    coverAssets: [{ address: "0x0000000000000000000000000000000000000000", asset: HBAR_EVM }],
    fetch: fakeFetch(w),
    now: () => (T0 + 10) * 1000,
    ...over,
  };
}

const REQUEST: ConnectorQuoteRequest = {
  from: { networkId: SEPOLIA, asset: ETH_SEPOLIA },
  to: { networkId: BASE_SEPOLIA, asset: USDC_BASE, amount: vector.quoteJson.amountOut, recipient: USER },
  deadline: DEADLINE,
  user: USER,
  refundTo: REFUND_TO,
};

async function rejection(p: Promise<unknown>): Promise<ClipError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ClipError);
    return e as ClipError;
  }
  throw new Error("expected a rejection");
}

async function reasonsFor(w: World, req: ConnectorQuoteRequest = REQUEST, over: Partial<SettleOnHederaOptions> = {}): Promise<string[]> {
  const e = await rejection(new SettleClient(options(w, over)).quoteConnectors(req));
  expect(e.code).toBe("settle-no-quotes");
  return e.cause as string[];
}

describe("settle quote vector (CLPRouter sdk/test/vectors/settle-quote.json)", () => {
  it("reproduces the order id with EIP-712 and recovers the signer", async () => {
    const q = quoteFromJson(vector.quoteJson);
    expect(settleOrderId(q, vector.hederaChainId, vector.orderBook)).toBe(vector.orderId);
    expect(
      hashTypedData({ domain: settleDomain(296, vector.orderBook), types: SETTLE_QUOTE_TYPES, primaryType: "Quote", message: q }),
    ).toBe(vector.orderId);
    expect(await recoverQuoteSigner(ORDER_ID, vector.signature as Hex)).toBe(getAddress(vector.signer));
    expect(ledgerHash(SEPOLIA)).toBe(vector.quoteJson.srcLedger);
    expect(ledgerHash(BASE_SEPOLIA)).toBe(vector.quoteJson.dstLedger);
  });

  it("vendored ABIs match the compiled selectors", () => {
    const dep = SETTLE_DEPOSIT_ABI.find((x) => x.type === "function" && x.name === "deposit")!;
    expect(toFunctionSelector(dep as never)).toBe(SETTLE_DEPOSIT_SELECTOR);
    expect(SETTLE_DEPOSIT_SELECTOR).toBe("0x1257b39b");
    const claim = SETTLE_ORDER_BOOK_ABI.find((x) => x.type === "function" && x.name === "claimDefault")!;
    expect(toFunctionSelector(claim as never)).toBe("0x17c4292a");
  });
});

describe("settleOnHedera", () => {
  it("without options still rejects with phase3", async () => {
    const c = settleOnHedera();
    for (const p of [c.quoteConnectors(REQUEST), c.getOrder(ORDER_ID), c.claimFromBond(ORDER_ID), c.getBond(CONNECTOR)]) {
      const e = await rejection(p);
      expect([e.userMessage, e.code]).toEqual(["Not available yet", "phase3"]);
    }
  });

  it("with options returns the real client, and keeps mainnet and testnet apart", () => {
    expect(settleOnHedera(options(world()))).toBeInstanceOf(SettleClient);
    expect(() => new SettleClient(options(world(), { network: "mainnet" }))).toThrow(ClipError);
    expect(() => new SettleClient(options(world(), { hederaChainId: 295 }))).toThrow(/Test builds/);
  });
});

describe("quoteConnectors", () => {
  it("returns a verified quote in plain words", async () => {
    const w = world();
    const quotes = await new SettleClient(options(w)).quoteConnectors(REQUEST);
    expect(quotes).toHaveLength(1);
    const q = quotes[0]!;
    expect(q).toMatchObject({
      connectorId: CONNECTOR,
      name: "Alpha",
      orderId: vector.orderId,
      deposit: { asset: ETH_SEPOLIA, amount: vector.quoteJson.amountIn },
      fee: { asset: ETH_SEPOLIA, amount: "10000000000000000" },
      bond: { asset: HBAR_EVM, amount: OWED.toString() },
      cover: { amount: COVER.toString(), owedOnDefault: OWED.toString() },
      deliveryP90S: 300,
      deadline: DEADLINE,
      expiresAt: vector.quoteJson.expiry,
      title: "Get 2500 USDC for 1.01 ETH",
    });
    expect(q.display).toMatchObject({ deposit: "1.01 ETH", fee: "0.01 ETH", receive: "2500 USDC", cover: "16500 HBAR", time: "about 5 minutes" });
    expect(q.warnings).toEqual([expect.stringContaining("paid on Hedera to 0x0000…1b2C")]);
    // The Connector was asked for exactly what the user wants.
    expect(w.calls).toContain("https://alpha.example/quote");
  });

  it("drops quotes that don't match the request, field by field", async () => {
    const cases: [string, ConnectorQuoteRequest][] = [
      ["different source network", { ...REQUEST, from: { networkId: BASE_SEPOLIA, asset: { ...USDC_BASE } } }],
      ["different destination network", { ...REQUEST, to: { ...REQUEST.to, networkId: SEPOLIA, asset: { ...USDC_BASE, networkId: SEPOLIA } } }],
      ["different asset", { ...REQUEST, from: { networkId: SEPOLIA, asset: { ...ETH_SEPOLIA, address: OTHER } } }],
      ["delivers a different asset", { ...REQUEST, to: { ...REQUEST.to, asset: { ...USDC_BASE, address: OTHER } } }],
      ["different amount", { ...REQUEST, to: { ...REQUEST.to, amount: "2500000001" } }],
      ["different recipient", { ...REQUEST, to: { ...REQUEST.to, recipient: OTHER } }],
      ["different payer", { ...REQUEST, user: OTHER }],
      ["refunds a different Hedera account", { ...REQUEST, refundTo: OTHER }],
      ["deadline is earlier", { ...REQUEST, deadline: DEADLINE + 1 }],
    ];
    for (const [reason, req] of cases) {
      const reasons = await reasonsFor(world(), req);
      expect(reasons, reason).toEqual([expect.stringContaining(reason)]);
    }
  });

  it("drops a quote whose contents were changed after signing", async () => {
    // Same order id claimed: the contents no longer hash to it.
    let r = await reasonsFor(world({ connectorAnswers: { "https://alpha.example": () => json(goodAnswer({}, { amountIn: "1" })) } }), REQUEST);
    expect(r).toEqual(["Alpha: quote's order id doesn't match its contents"]);
    // Order id recomputed by the tamperer: the signature now recovers to someone else.
    const tampered = { ...vector.quoteJson, amountIn: "1" };
    const id = settleOrderId(quoteFromJson(tampered), 296, ORDER_BOOK);
    r = await reasonsFor(world({ connectorAnswers: { "https://alpha.example": () => json(goodAnswer({ orderId: id, connector: { name: "Alpha" } }, { amountIn: "1" })) } }));
    expect(r).toEqual(["Alpha: quote isn't signed by the Connector's registered key"]);
  });

  it("drops quotes the order book wouldn't honour", async () => {
    const cases: [Partial<World>, string][] = [
      [{ validSigner: false }, "isn't signed by the Connector's registered key"],
      [{ registeredAt: 0n }, "isn't registered on Hedera"],
      [{ free: OWED - 1n }, "doesn't have enough bond free"],
      [{ activeAt: BigInt(T0 + 6) }, "can't be proven to Hedera yet"],
      [{ activeAt: 0n }, "can't be proven to Hedera yet"],
      [{ isCover: false }, "cover asset isn't accepted by the order book"],
      [{ depositSender: keccak256(OTHER) }, "isn't the one Hedera listens to"],
      [{ orders: new Map([[ORDER_ID.toLowerCase(), { status: 1 as Status }]]) }, "already used"],
    ];
    for (const [over, reason] of cases) {
      expect(await reasonsFor(world(over)), reason).toEqual([expect.stringContaining(reason)]);
    }
  });

  it("drops expired, unknown-deposit-app, wrong-owed and wrong-signer quotes", async () => {
    expect(await reasonsFor(world(), REQUEST, { now: () => (vector.quoteJson.expiry + 1) * 1000 })).toEqual(["Alpha: quote has expired"]);
    expect(await reasonsFor(world(), REQUEST, { now: () => (vector.quoteJson.expiry - 30) * 1000 })).toEqual(["Alpha: quote expires too soon"]);
    expect(await reasonsFor(world(), REQUEST, { deposits: { [SEPOLIA]: OTHER } })).toEqual(["Alpha: quote uses a deposit contract we don't know"]);
    expect(await reasonsFor(world({ connectorAnswers: { "https://alpha.example": () => json(goodAnswer({ owedOnDefault: COVER.toString() })) } }))).toEqual([
      "Alpha: promised cover doesn't match the order book",
    ]);
    expect(await reasonsFor(world({ connectorAnswers: { "https://alpha.example": () => json(goodAnswer({ connector: { signer: OTHER } })) } }))).toEqual([
      "Alpha: quote isn't signed by the key the Connector named",
    ]);
    expect(await reasonsFor(world(), REQUEST, { connectors: [{ id: OTHER, name: "Alpha", url: "https://alpha.example" }] })).toEqual([
      "Alpha: quote names a different Connector",
    ]);
    expect(await reasonsFor(world(), REQUEST, { coverAssets: [{ address: OTHER, asset: HBAR_EVM }] })).toEqual([
      "Alpha: quote's cover is in an asset we don't accept",
    ]);
  });

  it("one failing Connector never fails the call", async () => {
    const w = world({
      connectorAnswers: {
        "https://alpha.example": () => json(goodAnswer()),
        "https://busy.example": () => json({ error: "bond fully reserved", code: "no-capacity" }, 503),
        "https://down.example": () => Promise.reject(new TypeError("fetch failed")),
        "https://slow.example": () => new Promise<Response>(() => {}),
      },
    });
    const connectors = [
      { id: CONNECTOR, name: "Alpha", url: "https://alpha.example" },
      { id: OTHER, name: "Busy", url: "https://busy.example" },
      { id: OTHER, name: "Down", url: "https://down.example/" },
      { id: OTHER, name: "Slow", url: "https://slow.example" },
    ];
    const quotes = await new SettleClient(options(w, { connectors, quoteTimeoutMs: 20 })).quoteConnectors(REQUEST);
    expect(quotes.map((q) => q.name)).toEqual(["Alpha"]);

    const e = await rejection(new SettleClient(options(w, { connectors: connectors.slice(1), quoteTimeoutMs: 20 })).quoteConnectors(REQUEST));
    expect(e.cause).toEqual(
      expect.arrayContaining([
        "Busy: can't quote (no-capacity: bond fully reserved)",
        "Down: couldn't be reached",
        "Slow: didn't answer in time",
      ]),
    );
  });

  it("sorts the least to pay first, then the fastest", () => {
    const mk = (amount: string, p90: number, bond = "1"): ConnectorQuote => ({
      connectorId: amount,
      deposit: { asset: ETH_SEPOLIA, amount },
      fee: { asset: ETH_SEPOLIA, amount: "0" },
      bond: { asset: HBAR, amount: bond },
      deliveryP90S: p90,
      deadline: 0,
      expiresAt: 0,
    });
    const sorted = [mk("3", 10), mk("2", 600), mk("2", 60), mk("2", 60, "5")].sort(compareConnectorQuotes);
    expect(sorted.map((q) => `${q.deposit.amount}/${q.deliveryP90S}/${q.bond.amount}`)).toEqual(["2/60/5", "2/60/1", "2/600/1", "3/10/1"]);
  });

  it("explains bad requests in plain words", async () => {
    const c = new SettleClient(options(world()));
    expect((await rejection(c.quoteConnectors({ ...REQUEST, user: undefined }))).code).toBe("settle-no-account");
    expect((await rejection(c.quoteConnectors({ ...REQUEST, to: { ...REQUEST.to, amount: "0" } }))).code).toBe("bad-amount");
    expect((await rejection(c.quoteConnectors({ ...REQUEST, from: { networkId: "solana:devnet", asset: { ...ETH_SEPOLIA, networkId: "solana:devnet" } } }))).code).toBe(
      "settle-evm-only",
    );
  });
});

describe("createOrder", () => {
  it("native coin: one deposit call with value = amountIn, decoded back", async () => {
    const c = new SettleClient(options(world()));
    const [q] = await c.quoteConnectors(REQUEST);
    const { order, requests } = await c.createOrder(q!, USER);
    expect(order).toMatchObject({ id: vector.orderId, status: "awaiting-deposit", account: USER, statusText: "Waiting for your payment." });
    expect(requests).toHaveLength(1);
    const r = requests[0]!;
    expect(r).toMatchObject({ family: "evm", networkId: SEPOLIA, method: "eth_sendTransaction", origin: "clip-wallet://route" });
    const tx = (r.params as { from: string; to: string; data: Hex; value: Hex }[])[0]!;
    expect(tx.to).toBe(DEPOSIT);
    expect(tx.from).toBe(USER);
    expect(BigInt(tx.value)).toBe(BigInt(vector.quoteJson.amountIn));
    const { functionName, args } = decodeFunctionData({ abi: SETTLE_DEPOSIT_ABI, data: tx.data });
    expect(functionName).toBe("deposit");
    const [quote, sig] = args as readonly [any, Hex];
    expect(sig).toBe(vector.signature);
    expect(settleOrderId(quote, 296, ORDER_BOOK)).toBe(vector.orderId);
    expect(quote.amountIn).toBe(BigInt(vector.quoteJson.amountIn));
  });

  it("ERC-20: exact approve to the Deposit contract, then deposit with value 0", () => {
    const token = USDC_BASE.address!;
    const q = quoteFromJson({ ...vector.quoteJson, assetIn: addressToBytes32(token), amountIn: "2525000000" });
    const requests = buildDepositRequests({ quote: q, signature: vector.signature as Hex, account: USER, networkId: BASE_SEPOLIA, depositApp: DEPOSIT });
    expect(requests).toHaveLength(2);
    const [approve, deposit] = requests.map((r) => (r.params as { to: string; data: Hex; value: Hex }[])[0]!);
    expect(approve!.to).toBe(getAddress(token));
    expect(approve!.value).toBe("0x0");
    const a = decodeFunctionData({ abi: erc20Abi, data: approve!.data });
    expect(a.functionName).toBe("approve");
    expect(a.args).toEqual([DEPOSIT, 2525000000n]);
    expect(deposit!.to).toBe(DEPOSIT);
    expect(deposit!.value).toBe("0x0");
    const d = decodeFunctionData({ abi: SETTLE_DEPOSIT_ABI, data: deposit!.data });
    expect((d.args as readonly [any, Hex])[0].assetIn).toBe(addressToBytes32(token));
    expect(requests.every((r) => r.networkId === BASE_SEPOLIA && r.method === "eth_sendTransaction")).toBe(true);
  });

  it("refuses unverified, stale or someone else's quotes", async () => {
    let t = (T0 + 10) * 1000;
    const c = new SettleClient(options(world(), { now: () => t }));
    const [q] = await c.quoteConnectors(REQUEST);
    expect((await rejection(c.createOrder({ ...q! }, USER))).code).toBe("stale-quote");
    expect((await rejection(c.createOrder(q!, OTHER))).code).toBe("wrong-account");
    t = (vector.quoteJson.expiry - 10) * 1000;
    expect((await rejection(c.createOrder(q!, USER))).code).toBe("quote-expired");
  });
});

describe("order status", () => {
  async function statusOf(o: { status: Status; deadline?: number; reserved?: bigint } | undefined, hederaNow = T0 + 5, deposited = false) {
    const w = world({ hederaNow });
    const c = new SettleClient(options(w));
    const [q] = await c.quoteConnectors(REQUEST);
    await c.createOrder(q!, USER);
    if (deposited) c.markDeposited(ORDER_ID, "0xabc");
    if (o) w.orders.set(ORDER_ID.toLowerCase(), o);
    return c.getOrder(ORDER_ID);
  }

  it("maps every on-chain status", async () => {
    expect((await statusOf(undefined)).status).toBe("awaiting-deposit");
    const dep = await statusOf(undefined, T0 + 5, true);
    expect([dep.status, dep.depositTx]).toEqual(["deposited", "0xabc"]);
    const open = await statusOf({ status: 1 });
    expect(open).toMatchObject({ status: "deposited", claimableFrom: DEADLINE + GRACE + 1, owedOnDefault: OWED.toString(), refundTo: REFUND_TO });
    expect(open.statusText).toBe("Paid. Alpha is delivering.");
    expect((await statusOf({ status: 1, reserved: 5n })).statusText).toMatch(/Only 0.00000005 HBAR of the promised cover/);
    expect((await statusOf({ status: 2 })).status).toBe("settled");
    expect((await statusOf({ status: 3 })).status).toBe("paid-from-bond");
    expect((await statusOf({ status: 4 })).status).toBe("paid-from-bond");
    const rej = await statusOf({ status: 5 });
    expect(rej).toMatchObject({ status: "rejected", reserved: "0" });
    expect(rej.statusText).toMatch(/no cover/);
  });

  it("an open order defaults only after deadline + PROOF_GRACE on Hedera's clock", async () => {
    expect((await statusOf({ status: 1 }, DEADLINE + GRACE)).status).toBe("deposited");
    const d = await statusOf({ status: 1 }, DEADLINE + GRACE + 1);
    expect(d.status).toBe("defaulted");
    expect(d.statusText).toBe("Alpha missed the deadline. You can claim 16500 HBAR from its bond now.");
  });

  it("reports a payout held for the user", async () => {
    const w = world({ owed: OWED });
    w.orders.set(ORDER_ID.toLowerCase(), { status: 3 });
    const o = await new SettleClient(options(w)).getOrder(ORDER_ID);
    expect(o.owedToYou).toEqual({ asset: HBAR_EVM, amount: OWED.toString() });
    expect(o.onChainOnly).toBe(true);
    expect(o.statusText).toMatch(/waiting for you to collect/);
  });

  it("an order Hedera hasn't seen and this session didn't create is not found", async () => {
    expect((await rejection(new SettleClient(options(world())).getOrder(ORDER_ID))).code).toBe("order-not-found");
    expect((await rejection(new SettleClient(options(world())).getOrder("0x12"))).code).toBe("bad-order-id");
  });
});

describe("listOrders", () => {
  it("finds orders from OrderOpened logs filtered by refundTo, plus this session's", async () => {
    const other = `0x${"77".repeat(32)}` as Hex;
    const topics = encodeEventTopics({ abi: SETTLE_ORDER_BOOK_ABI, eventName: "OrderOpened", args: { orderId: other, connector: CONNECTOR, refundTo: REFUND_TO } });
    const data = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint64" }],
      [vector.quoteJson.srcLedger as Hex, vector.quoteJson.dstLedger as Hex, "0x0000000000000000000000000000000000000000", OWED, OWED, BigInt(DEADLINE)],
    );
    const w = world();
    w.logs = [{ address: ORDER_BOOK.toLowerCase(), topics, data, transaction_hash: "0x01", timestamp: `${T0}.1` }, { address: ORDER_BOOK, topics: [`0x${"99".repeat(32)}`], data: "0x" }];
    w.orders.set(other, { status: 2 });
    const c = new SettleClient(options(w));
    const [q] = await c.quoteConnectors(REQUEST);
    await c.createOrder(q!, USER);

    const orders = await c.listOrders(REFUND_TO);
    // Newest first: the on-chain order opened at T0 + 60, the session one was created at T0 + 10.
    expect(orders.map((o) => [o.id, o.status])).toEqual([
      [other, "settled"],
      [ORDER_ID.toLowerCase(), "awaiting-deposit"],
    ]);
    expect(orders[0]!.quote.from).toBe(SEPOLIA);
    expect(orders[0]!.onChainOnly).toBe(true);
    expect(orders[1]!.onChainOnly).toBeUndefined();

    const logUrls = w.calls.filter((u) => u.includes("/results/logs?"));
    expect(logUrls).toHaveLength(4); // 28 days in 7-day windows
    const p = new URL(logUrls[0]!).searchParams;
    expect(p.get("topic0")).toBe(topics[0]);
    expect(p.get("topic2")).toBe(addressToBytes32(REFUND_TO));
    const [gte, lt] = p.getAll("timestamp");
    expect(Number(lt!.slice(3, -10)) - Number(gte!.slice(4, -10))).toBe(7 * 86400);
    expect(lt).toBe(`lt:${T0 + 6}.000000000`);
  });
});

describe("bonds and claims", () => {
  it("getBond reads the Connector's bond", async () => {
    const b = await new SettleClient(options(world())).getBond(CONNECTOR);
    expect(b).toEqual({
      connectorId: CONNECTOR,
      asset: HBAR_EVM,
      amount: (10n ** 15n).toString(),
      locked: (2n * 10n ** 12n).toString(),
      slashed: "0",
      pendingWithdrawal: "0",
      withdrawReadyAt: 0,
      free: (10n ** 15n - 2n * 10n ** 12n).toString(),
      shortfalls: 2,
    });
    expect((await rejection(new SettleClient(options(world())).getBond(OTHER))).code).toBe("connector-unknown");
  });

  it("claimFromBond refuses before deadline + grace and builds claimDefault after", async () => {
    const early = world({ hederaNow: DEADLINE + GRACE });
    early.orders.set(ORDER_ID.toLowerCase(), { status: 1 });
    const e = await rejection(new SettleClient(options(early)).claimFromBond(ORDER_ID));
    expect(e.code).toBe("claim-too-early");
    expect(e.cause).toBe(DEADLINE + GRACE + 1);

    const late = world({ hederaNow: DEADLINE + GRACE + 1 });
    late.orders.set(ORDER_ID.toLowerCase(), { status: 1 });
    const [r] = await new SettleClient(options(late)).claimFromBond(ORDER_ID);
    expect(r).toMatchObject({ family: "evm", networkId: "eip155:296", method: "eth_sendTransaction", origin: "clip-wallet://route" });
    const tx = (r!.params as { from: string; to: string; data: Hex; value: Hex }[])[0]!;
    expect([tx.from, tx.to, tx.value]).toEqual([REFUND_TO, ORDER_BOOK, "0x0"]);
    const d = decodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, data: tx.data });
    expect([d.functionName, d.args]).toEqual(["claimDefault", [ORDER_ID]]);
  });

  it("claimFromBond explains why other orders can't be claimed", async () => {
    const codes: [Status | undefined, string][] = [
      [undefined, "claim-not-open"],
      [2, "claim-delivered"],
      [3, "claim-already-paid"],
      [4, "claim-already-paid"],
      [5, "claim-rejected"],
    ];
    for (const [status, code] of codes) {
      const w = world({ hederaNow: DEADLINE + GRACE + 100 });
      if (status !== undefined) w.orders.set(ORDER_ID.toLowerCase(), { status });
      expect((await rejection(new SettleClient(options(w)).claimFromBond(ORDER_ID))).code).toBe(code);
    }
  });

  it("withdrawOwed builds one request per asset with something owed", async () => {
    expect((await new SettleClient(options(world())).withdrawOwed(REFUND_TO)).requests).toEqual([]);
    const { requests, amounts } = await new SettleClient(options(world({ owed: 42n }))).withdrawOwed(REFUND_TO);
    expect(amounts).toEqual([{ asset: HBAR_EVM, amount: "42" }]);
    const tx = (requests[0]!.params as { to: string; data: Hex }[])[0]!;
    expect(tx.to).toBe(ORDER_BOOK);
    const d = decodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, data: tx.data });
    expect([d.functionName, d.args]).toEqual(["withdrawOwed", ["0x0000000000000000000000000000000000000000"]]);
  });
});

describe("JSON-RPC read path", () => {
  it("reads through eth_call and the latest block when no mirror node is set", async () => {
    const seen: string[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const { method, params, id } = JSON.parse(String(init!.body));
      seen.push(method);
      if (method === "eth_getBlockByNumber") return json({ jsonrpc: "2.0", id, result: { timestamp: `0x${(DEADLINE + GRACE + 1).toString(16)}` } });
      const { functionName } = decodeFunctionData({ abi: SETTLE_ORDER_BOOK_ABI, data: params[0].data });
      if (functionName === "PROOF_GRACE") return json({ jsonrpc: "2.0", id, result: ret("PROOF_GRACE", BigInt(GRACE)) });
      return json({
        jsonrpc: "2.0",
        id,
        result: ret("orders", [CONNECTOR, 1, BigInt(DEADLINE), "0x0000000000000000000000000000000000000000", 1n, REFUND_TO, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`, 1n, OWED, OWED]),
      });
    }) as unknown as typeof fetch;
    const c = new SettleClient({ ...options(world()), mirrorNodeUrl: undefined, jsonRpcUrl: "https://relay.example/api", fetch: f });
    expect((await c.getOrder(ORDER_ID)).status).toBe("defaulted");
    expect(seen).toEqual(expect.arrayContaining(["eth_call", "eth_getBlockByNumber"]));
    expect(await c.listOrders(REFUND_TO)).toEqual([]);
  });
});
