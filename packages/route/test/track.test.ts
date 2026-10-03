import { ClipError } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { RouteClient, RouteStatusClient, describeRoute, settleOnHedera, trackRoute, type RouteStatusResponse } from "../src/index.js";
import { formatUnits, parseUnits, usdToUnits } from "../src/format.js";

const ROUTE = `0x${"ab".repeat(16)}`;

function status(over: Partial<RouteStatusResponse>): RouteStatusResponse {
  return {
    routeId: ROUTE,
    found: true,
    hops: [
      { index: 0, ledger: "eip155:11155111", status: "sent", events: [] },
      { index: 1, ledger: "eip155:296", status: "waiting", events: [] },
    ],
    receipts: [],
    outcome: { status: "PENDING", settled: false },
    inputs: {},
    ...over,
  };
}

function fakeFetch(answers: (RouteStatusResponse | number | Error)[]) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const a = answers.shift() ?? answers[answers.length - 1];
    if (a instanceof Error) throw a;
    if (typeof a === "number") return new Response("{}", { status: a });
    return new Response(JSON.stringify(a), { status: a!.found ? 200 : 404 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const noSleep = async () => {};

describe("trackRoute", () => {
  it("yields each change in plain words until the route settles", async () => {
    const { f, calls } = fakeFetch([
      status({ found: false, hops: [] }),
      status({}),
      status({}),
      status({ outcome: { status: "DELIVERED", settled: false } }),
      status({ outcome: { status: "DELIVERED", settled: true } }),
    ]);
    const client = new RouteStatusClient({ baseUrl: "https://status.example/", fetch: f });
    const seen = [];
    for await (const p of trackRoute(ROUTE, { client, sleep: noSleep })) seen.push(p);
    expect(calls[0]).toBe(`https://status.example/routes/${ROUTE}`);
    expect(seen.map((p) => p.stage)).toEqual(["not-seen", "in-transit", "delivered", "settled"]);
    expect(seen[1]!.text).toBe("On its way (0 of 2 steps done).");
    expect(seen[3]!).toMatchObject({ done: true, text: "Paid. Delivery is proven and the payment is settled." });
  });

  it("rides out a few tracker errors, then gives up in plain words", async () => {
    const { f } = fakeFetch([new Error("down"), 500, status({ outcome: { status: "EXPIRED", settled: true } })]);
    const client = new RouteStatusClient({ baseUrl: "https://s", fetch: f });
    const seen = [];
    for await (const p of trackRoute(ROUTE, { client, sleep: noSleep })) seen.push(p);
    expect(seen.map((p) => p.stage)).toEqual(["expired"]);

    const { f: dead } = fakeFetch([new Error("down")]);
    const gen = trackRoute(ROUTE, { client: new RouteStatusClient({ baseUrl: "https://s", fetch: dead }), sleep: noSleep, maxErrors: 3 });
    await expect(gen.next()).rejects.toMatchObject({ code: "status-gave-up", userMessage: expect.stringMatching(/lost track/) });
  });

  it("times out", async () => {
    const { f } = fakeFetch([status({})]);
    let t = 0;
    const gen = trackRoute(ROUTE, { client: new RouteStatusClient({ baseUrl: "https://s", fetch: f }), sleep: noSleep, timeoutMs: 10, intervalMs: 5, now: () => (t += 6) });
    await gen.next();
    await expect(gen.next()).rejects.toMatchObject({ code: "status-timeout" });
  });

  it("rejects malformed route ids before any request", async () => {
    const { f, calls } = fakeFetch([status({})]);
    await expect(new RouteStatusClient({ baseUrl: "https://s", fetch: f }).getRoute("../admin")).rejects.toMatchObject({ code: "bad-route-id" });
    expect(calls).toEqual([]);
  });

  it("describes held routes with the contact", () => {
    const p = describeRoute(status({ outcome: { status: "QUARANTINED", settled: true }, notices: [{ contact: "help@example.org" }] }));
    expect(p).toMatchObject({ stage: "held", done: true, text: "This payment is on hold for review. Contact: help@example.org." });
  });

  it("needs a status API URL on the RouteClient", () => {
    expect(() => new RouteClient().trackRoute(ROUTE)).toThrow(/isn't set up/);
  });
});

describe("Phase 3 settle on Hedera", () => {
  it("every call says not available yet", async () => {
    const s = settleOnHedera();
    for (const call of [
      () => s.quoteConnectors({} as never),
      () => s.createOrder({} as never, "0x"),
      () => s.getOrder("1"),
      () => s.listOrders("0x"),
      () => s.getBond("c"),
      () => s.claimFromBond("1"),
    ]) {
      const e = await call().then(() => undefined, (x: unknown) => x);
      expect(e).toBeInstanceOf(ClipError);
      expect(e).toMatchObject({ userMessage: "Not available yet", code: "phase3" });
    }
  });
});

describe("format", () => {
  it("converts USD to coin units, rounding up", () => {
    expect(usdToUnits(2.5, 2000, 18)).toBe(1250000000000000n);
    expect(usdToUnits(1, 3, 6)).toBe(333334n);
    expect(usdToUnits(0, 3, 6)).toBe(0n);
  });
  it("formats and parses units", () => {
    expect(formatUnits(1250000000000000n, 18)).toBe("0.00125");
    expect(formatUnits(12n, 18)).toBe("0.000000000000000012");
    expect(formatUnits(2500000000n, 8)).toBe("25");
    expect(parseUnits("25.5", 8)).toBe(2550000000n);
    expect(() => parseUnits("1.123", 2)).toThrow();
  });
});
