/**
 * Internal audit 2026-10 (docs/audit/internal-audit-2026-10.md): EVM typed data shows what is hashed.
 *  EVM-01  only fields declared in `types` are shown; undeclared keys can't change the description.
 *  EVM-02  unrecognised typed data carries a warning; every hashed field is shown or counted.
 *  EVM-03  typed data for another chain is a danger warning, not a caution.
 */
import type { DappRequest, DecodedRequest } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createEvmModule } from "../src/module.js";
import { PERMIT_TYPED, SEPOLIA_STATE, TYPED } from "./fixtures.js";
import { BOB, ME, SEPOLIA, ctxFor, mockFetch } from "./helpers.js";

const mod = createEvmModule();
const decode = (req: DappRequest): Promise<DecodedRequest> => mod.decode(req, ctxFor(SEPOLIA, mockFetch({ rpc: { ...SEPOLIA_STATE.rpc, eth_call: () => "0x" } })));
const typed = (td: unknown): DappRequest => ({ ...TYPED, params: [ME, JSON.stringify(td)] });
const MAX = "115792089237316195423570985008687907853269984665640564039457584007913129639935";

describe("audit: EVM typed data", () => {
  it("EVM-01: an unsigned `allowed: false` can't make an unlimited Permit look like 0", async () => {
    const td = { ...PERMIT_TYPED, message: { ...PERMIT_TYPED.message, value: MAX, allowed: false } };
    const d = await decode(typed(td));
    expect(d.title).toMatch(/all your/);
    expect(d.warnings.map((w) => w.code)).toContain("unlimited-approval");
  });

  it("EVM-01: undeclared keys are not shown in the generic view", async () => {
    const td = {
      types: { Order: [{ name: "maker", type: "address" }, { name: "price", type: "uint256" }] },
      primaryType: "Order",
      domain: { name: "Market", chainId: 11155111, verifyingContract: BOB },
      message: { decoy: "harmless", maker: ME, price: "100" },
    };
    const d = await decode(typed(td));
    expect(d.lines.map((l) => l.label)).not.toContain("Decoy");
    expect(d.lines).toContainEqual({ label: "Price", value: "100" });
  });

  it("EVM-02: padding the message can't push signed fields off the screen; unknown orders get a warning", async () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({ name: `pad${i}`, type: "uint256" }));
    const td = {
      types: { Order: [...fields, { name: "recipient", type: "address" }, { name: "price", type: "uint256" }] },
      primaryType: "Order",
      domain: { name: "Market", chainId: 11155111, verifyingContract: BOB },
      message: { ...Object.fromEntries(fields.map((f) => [f.name, "0"])), recipient: BOB, price: "0" },
    };
    const d = await decode(typed(td));
    expect(d.lines.map((l) => l.label)).toContain("Price");
    expect(d.warnings.map((w) => w.code)).toContain("unknown-call");
  });

  it("EVM-03: another chain's typed data is a danger warning", async () => {
    const td = { ...PERMIT_TYPED, domain: { ...PERMIT_TYPED.domain, chainId: 1 } };
    const d = await decode(typed(td));
    expect(d.warnings.find((w) => w.code === "network-matters")?.level).toBe("danger");
  });
});

describe("audit: EVM fee terms are the ones shown (EVM-04)", () => {
  const GWEI = 1_000_000_000n;
  const hex = (n: bigint) => `0x${n.toString(16)}`;
  const send = (id: string): DappRequest => ({ ...TYPED, id, method: "eth_sendTransaction", params: [{ from: ME, to: BOB, value: "0x1" }] });

  async function run(id: string, after: { baseFee?: bigint; gas?: bigint }) {
    let baseFee = GWEI;
    let gas = 21_000n;
    const fetch = mockFetch({
      rpc: {
        ...SEPOLIA_STATE.rpc,
        eth_call: () => "0x",
        eth_getBlockByNumber: () => ({ number: "0x100", baseFeePerGas: hex(baseFee) }),
        eth_estimateGas: () => hex(gas),
      },
    });
    const m = createEvmModule();
    const ctx = ctxFor(SEPOLIA, fetch);
    const d = await m.decode(send(id), ctx);
    baseFee = after.baseFee ?? baseFee;
    gas = after.gas ?? gas;
    return { d, prepare: () => m.prepare(send(id), ctx, "ap") };
  }

  it("signs the fee caps quoted for the approval screen, not a new quote taken after approval", async () => {
    const { d, prepare } = await run("fee-1", { baseFee: 500n * GWEI });
    expect(d.lines.find((l) => l.label === "Network fee at most")).toBeTruthy();
    const [p] = await prepare();
    const { parseTransaction } = await import("viem");
    const signed = parseTransaction(`0x${Buffer.from(p!.raw!.bytes).toString("hex")}`);
    expect(signed.maxFeePerGas).toBe(3n * GWEI); // 2 × base (1 gwei at decode) + tip (1 gwei)
  });

  it("refuses when the transaction now needs much more gas than the screen was built on", async () => {
    const { prepare } = await run("fee-2", { gas: 1_000_000n });
    await expect(prepare()).rejects.toMatchObject({ code: "fee-changed" });
  });
});

describe("audit: look-alike tokens (TOK-01)", () => {
  it("a non-curated contract calling itself USDC is spam everywhere, not only in the portfolio", async () => {
    const { tokenAsset } = await import("../src/tokens.js");
    expect(tokenAsset(SEPOLIA, 11155111, "0x00000000000000000000000000000000000a11ce", { symbol: "USDC", name: "USD Coin", decimals: 6 }).spam).toBe(true);
    expect(tokenAsset(SEPOLIA, 11155111, "0x00000000000000000000000000000000000a11ce", { symbol: "PEPE", name: "Pepe", decimals: 18 }).spam).toBeUndefined();
  });

  it("a single invisible or right-to-left override character marks a token as spam", async () => {
    const { tokenAsset } = await import("../src/tokens.js");
    const a = (symbol: string) => tokenAsset(SEPOLIA, 11155111, "0x00000000000000000000000000000000000b0b00", { symbol, name: symbol, decimals: 18 });
    expect(a("PEPE‮").spam).toBe(true);
    expect(a("PE​PE").spam).toBe(true);
  });
});
