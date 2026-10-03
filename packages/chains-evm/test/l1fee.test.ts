import type { DappRequest } from "@clip-wallet/core";
import { decodeFunctionData, encodeAbiParameters, numberToHex, parseTransaction } from "viem";
import * as viemChains from "viem/chains";
import { describe, expect, it } from "vitest";
import { EVM_NETWORK_SPECS, GAS_PRICE_ORACLE, OP_STACK_CHAIN_IDS, createEvmModule } from "../src/index.js";
import { gasPriceOracleAbi } from "../src/l1fee.js";
import { SEPOLIA_STATE } from "./fixtures.js";
import { BOB, ME, RpcErr, SEPOLIA, ctxFor, mockFetch, type MockSpec } from "./helpers.js";

const OP_SEPOLIA = "eip155:11155420";
const L1_FEE = 123_456_789_000n;

const send = (networkId: string, data = "0x"): DappRequest => ({
  id: "r1",
  origin: "https://app.example.com",
  via: "injected",
  family: "evm",
  networkId,
  method: "eth_sendTransaction",
  params: [{ from: ME, to: BOB, value: numberToHex(10n ** 15n), data }],
});

function spec(ethCall: (params: unknown[]) => unknown): MockSpec {
  return { rpc: { ...SEPOLIA_STATE.rpc, eth_call: ethCall } };
}

describe("OP-stack L1 data fee", () => {
  it("covers exactly the registry chains whose viem definition has a GasPriceOracle", () => {
    type C = { id: number; contracts?: { gasPriceOracle?: unknown } };
    const all = Object.values(viemChains).filter((c): c is C & typeof c => !!c && typeof c === "object" && "id" in c) as unknown as C[];
    // Some ids are shared by several viem chains (e.g. 999); count a chain only if every definition with that id has the oracle.
    const opStack = (id: number) => {
      const defs = all.filter((c) => c.id === id);
      return defs.length > 0 && defs.every((c) => !!c.contracts?.gasPriceOracle);
    };
    const expected = EVM_NETWORK_SPECS.map((s) => s.chainId).filter(opStack);
    expect([...OP_STACK_CHAIN_IDS].sort((a, b) => a - b)).toEqual([...new Set(expected)].sort((a, b) => a - b));
    for (const id of OP_STACK_CHAIN_IDS) {
      const c = Object.values(viemChains).find((x) => (x as { id?: number }).id === id) as { contracts?: { gasPriceOracle?: { address: string } } };
      expect(c.contracts!.gasPriceOracle!.address).toBe(GAS_PRICE_ORACLE);
    }
  });

  it("adds getL1Fee(unsigned tx) to the fee on OP Sepolia", async () => {
    const calls: unknown[][] = [];
    const m = mockFetch(
      spec((params) => {
        calls.push(params);
        return encodeAbiParameters([{ type: "uint256" }], [L1_FEE]);
      }),
    );
    const d = await createEvmModule().decode(send(OP_SEPOLIA), ctxFor(OP_SEPOLIA, m));
    // L2: 21000 × 1.2 × (1 gwei base + 1 gwei tip); plus the oracle's L1 fee.
    expect(d.fee!.amount).toBe((25_200n * 2_000_000_000n + L1_FEE).toString());
    expect(d.warnings.map((w) => w.code)).not.toContain("high-fee");

    const oracle = calls.find((p) => (p[0] as { to: string }).to === GAS_PRICE_ORACLE)!;
    const { functionName, args } = decodeFunctionData({ abi: gasPriceOracleAbi, data: (oracle[0] as { data: `0x${string}` }).data });
    expect(functionName).toBe("getL1Fee");
    const unsigned = parseTransaction(args[0]);
    expect(unsigned).toMatchObject({ chainId: 11155420, to: BOB.toLowerCase(), value: 10n ** 15n, type: "eip1559" });
    expect(unsigned.r).toBeUndefined();
  });

  it("if the oracle call fails, shows the L2 fee and says the real fee may be higher", async () => {
    const m = mockFetch(spec((p) => ((p[0] as { to: string }).to === GAS_PRICE_ORACLE ? new RpcErr(-32000, "execution reverted") : "0x")));
    const d = await createEvmModule().decode(send(OP_SEPOLIA), ctxFor(OP_SEPOLIA, m));
    expect(d.fee!.amount).toBe((25_200n * 2_000_000_000n).toString());
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "high-fee" }));
  });

  it("doesn't ask on non-OP chains", async () => {
    const m = mockFetch(spec(() => "0x"));
    await createEvmModule().decode(send(SEPOLIA), ctxFor(SEPOLIA, m));
    expect(m.calls.some((c) => c.method === "eth_call" && (c.params[0] as { to: string }).to === GAS_PRICE_ORACLE)).toBe(false);
  });
});
