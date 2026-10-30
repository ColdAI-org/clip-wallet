import { describe, expect, it } from "vitest";
import { RpcError, plainStarknetError } from "../src/index.js";

const FEE = "You don't have enough STRK to pay the network fee.";
const OTHER = "Starknet rejected this transaction. Nothing was sent.";

describe("plainStarknetError", () => {
  it("names a fee the balance can't cover", () => {
    expect(plainStarknetError(new Error("Resource bounds were not satisfied: max fee exceeds balance"))).toBe(FEE);
    expect(plainStarknetError(new Error("Resources bounds (l1_gas) exceed balance (0)"))).toBe(FEE);
    expect(plainStarknetError(new RpcError(53, "Account balance is smaller than the transaction's maximal fee"))).toBe(FEE);
    expect(plainStarknetError(new Error("resource bounds\nexceed balance"))).toBe(OTHER);
    expect(plainStarknetError(new Error("resource bounds balance exceeded"))).toBe(OTHER);
  });

  it("is linear on long node text", () => {
    const t0 = performance.now();
    expect(plainStarknetError(new Error("resource bounds exceed ".repeat(5_000)))).toBe(OTHER);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
