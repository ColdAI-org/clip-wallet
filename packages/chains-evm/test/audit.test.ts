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
