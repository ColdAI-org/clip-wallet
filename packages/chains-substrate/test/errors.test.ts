import { describe, expect, it } from "vitest";
import { plainSubstrateError } from "../src/index.js";

const EXPIRED = "This transaction expired before it was sent. Try again.";
const BAD_SIG = "The signature didn't match. Nothing was sent.";

describe("plainSubstrateError", () => {
  it("reads BadProof about the era as expired, and other BadProof as a signature problem", () => {
    expect(plainSubstrateError("Invalid Transaction: BadProof (era mismatch)")).toBe(EXPIRED);
    expect(plainSubstrateError("Transaction is outdated")).toBe(EXPIRED);
    expect(plainSubstrateError("Invalid Transaction: BadProof")).toBe(BAD_SIG);
    expect(plainSubstrateError("BadProof\nera")).toBe(BAD_SIG);
  });

  it("is linear on long node text", () => {
    const t0 = performance.now();
    expect(plainSubstrateError("BadProof ".repeat(10_000))).toBe(BAD_SIG);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
