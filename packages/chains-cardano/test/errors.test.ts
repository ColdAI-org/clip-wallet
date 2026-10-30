import { describe, expect, it } from "vitest";
import { plainSubmitError } from "../src/index.js";

const SPENT = "Some of the coins this transaction spends were already spent. Refresh and try again.";
const NOT_CONSERVED = "The amounts in this transaction don't add up. Nothing was sent.";

describe("plainSubmitError", () => {
  it("names spent inputs, including BadInputs after ValueNotConservedUTxO on the same line", () => {
    expect(plainSubmitError('{"tag":"BadInputsUTxO"}')).toBe(SPENT);
    expect(plainSubmitError("ConwayUtxowFailure (ValueNotConservedUTxO …) (BadInputs …)")).toBe(SPENT);
    expect(plainSubmitError("ValueNotConservedUTxO\nBadInputs")).toBe(NOT_CONSERVED);
    expect(plainSubmitError("ValueNotConservedUTxO")).toBe(NOT_CONSERVED);
    expect(plainSubmitError("something else")).toBe("Cardano rejected this transaction. Nothing was sent.");
  });

  it("is linear on long ledger text", () => {
    const t0 = performance.now();
    expect(plainSubmitError("ValueNotConservedUTxO ".repeat(5_000))).toBe(NOT_CONSERVED);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
