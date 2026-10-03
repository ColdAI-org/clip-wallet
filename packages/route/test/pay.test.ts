import { ClipError } from "@clip-wallet/core";
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  toFunctionSelector,
  type Log,
} from "viem";
import { describe, expect, it } from "vitest";
import { CLPR_ROUTER_ABI, CLPROUTER_SDK_COMMIT, RouteClient, hederaRecipientToEvm } from "../src/index.js";
import {
  CONN1,
  HBAR,
  HEDERA,
  HEDERA_APP,
  PAYER,
  ROUTER_HEDERA,
  ROUTER_SEPOLIA,
  SELLER,
  SEPOLIA,
  fixtureDeployments,
  fixtureGraph,
} from "./fixtures.js";

const now = new Date("2026-10-03T00:00:00Z");
const client = new RouteClient({ graph: fixtureGraph(), deployments: fixtureDeployments() });

async function quote() {
  const [q] = await client.quote({ to: HEDERA, asset: HBAR, amount: "2500000000", from: [SEPOLIA], mode: "cheapest", now });
  return q!;
}

describe("Router ABI", () => {
  it("matches the compiled ClprRouter.send selector", () => {
    const send = CLPR_ROUTER_ABI.find((x) => x.type === "function" && x.name === "send")!;
    expect(toFunctionSelector(send as never)).toBe("0x8e0619f9");
    expect(CLPROUTER_SDK_COMMIT).toMatch(/^564e29e/);
  });
});

describe("planPayOnHedera", () => {
  it("builds one Router.send request on the source network", async () => {
    const q = await quote();
    const plan = client.planPayOnHedera({
      quote: q,
      from: { address: PAYER },
      recipient: "0.0.4660",
      destinationApp: HEDERA_APP,
      payee: SELLER,
      now,
    });
    expect(plan.requests).toHaveLength(1);
    const r = plan.requests[0]!;
    expect(r).toMatchObject({ family: "evm", networkId: SEPOLIA, method: "eth_sendTransaction", origin: "clip-wallet://route" });
    const tx = (r.params as { from: string; to: string; data: `0x${string}`; value: `0x${string}` }[])[0]!;
    expect(tx.to).toBe(ROUTER_SEPOLIA);
    expect(tx.from).toBe(PAYER);
    expect(BigInt(tx.value)).toBe(BigInt(plan.value));
    expect(BigInt(plan.value)).toBe(BigInt(q.youPay.amount));
    expect(plan.escrow).toBe(q.escrow.amount);
    expect(plan.feeBudget).toBe(q.fee.amount);
    expect(plan.deadline).toBe(Math.floor(now.getTime() / 1000) + 1760);

    const { functionName, args } = decodeFunctionData({ abi: CLPR_ROUTER_ABI, data: tx.data });
    expect(functionName).toBe("send");
    const req = (args as readonly [any])[0];
    expect(req.destination).toEqual({ ledgerId: "eip155:296", application: HEDERA_APP.toLowerCase() });
    expect(req.recipient).toBe("eip155:296:0x0000000000000000000000000000000000001234");
    expect(req.hops).toHaveLength(2);
    expect(req.hops[0]).toMatchObject({ ledgerId: SEPOLIA, router: ROUTER_SEPOLIA.toLowerCase(), connectorId: CONN1, fee: BigInt(q.fee.amount) });
    expect(req.hops[1]).toMatchObject({ ledgerId: "eip155:296", router: ROUTER_HEDERA.toLowerCase(), fee: 0n, channelId: `0x${"00".repeat(32)}` });
    expect(req.mode).toBe(1); // cheapest
    expect(req.constraints).toMatchObject({ loose: false, trustFloor: 0, maxFee: BigInt(q.fee.amount), filters: 0 });
    expect(req.payloadType).toBe(2); // ASSET
    expect(req.escrow).toBe(BigInt(q.escrow.amount));
    expect(req.payee.toLowerCase()).toBe(SELLER);
    const [recipient, assetKey, amount] = decodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint256" }],
      req.payload,
    );
    expect([recipient, assetKey, amount]).toEqual(["eip155:296:0x0000000000000000000000000000000000001234", "hbar", 2500000000n]);
  });

  it("explains bad inputs in plain words", async () => {
    const q = await quote();
    const base = { quote: q, from: { address: PAYER }, recipient: "0.0.4660", destinationApp: HEDERA_APP, payee: SELLER } as const;
    expect(() => client.planPayOnHedera({ ...base, recipient: "alice" })).toThrow(/doesn't look like a Hedera account/);
    expect(() => client.planPayOnHedera({ ...base, payee: "0xnope" as `0x${string}` })).toThrow(/seller's address isn't valid/);
    expect(() => client.planPayOnHedera({ ...base, payee: `0x${"00".repeat(20)}` })).toThrow(/can't be empty/);
    expect(() => client.planPayOnHedera({ ...base, quote: { ...q } })).toThrow(/expired/);
  });

  it("refuses a test-verifier quote on a mainnet client", async () => {
    const q = await quote();
    const mainnet = new RouteClient({ network: "mainnet", graph: fixtureGraph(), deployments: fixtureDeployments(false) });
    try {
      mainnet.planPayOnHedera({ quote: q, from: { address: PAYER }, recipient: "0.0.1", destinationApp: HEDERA_APP, payee: SELLER });
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(ClipError);
      expect((e as ClipError).code).toBe("test-verifier");
    }
  });

  it("reads route ids from RouteSent logs", () => {
    const routeId = `0x${"ab".repeat(16)}` as const;
    const topics = encodeEventTopics({ abi: CLPR_ROUTER_ABI, eventName: "RouteSent", args: { routeId, sender: PAYER } });
    const data = encodeAbiParameters(
      [{ type: "string" }, { type: "uint256" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }],
      ["eip155:296", 1n, 2n, 3n, 4n],
    );
    const log = { address: ROUTER_SEPOLIA, topics, data, blockNumber: 1n, transactionHash: `0x${"cd".repeat(32)}`, logIndex: 0 } as unknown as Log;
    expect(client.routeIdsFromLogs([log], ROUTER_SEPOLIA)).toEqual([routeId]);
    expect(client.routeIdsFromLogs([log], ROUTER_HEDERA)).toEqual([]);
  });
});

describe("hederaRecipientToEvm", () => {
  it("turns 0.0.N into a long-zero address and passes EVM addresses through", () => {
    expect(hederaRecipientToEvm("0.0.4660")).toBe("0x0000000000000000000000000000000000001234");
    expect(hederaRecipientToEvm(PAYER)).toBe(PAYER);
    expect(() => hederaRecipientToEvm("0.1.5")).toThrow(ClipError);
  });
});
