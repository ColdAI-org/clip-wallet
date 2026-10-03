import { describe, expect, it } from "vitest";
import { bcsAddress, bcsAddressVector, bcsU64, createAptosModule, decodeEntryPayload, delegationPayload, encodeEntryPayload } from "../src/index.js";
import { type Route, ctxFor, mockAptos, req, simulation } from "./helpers.js";
import { FIX } from "./signatures.js";

const ME = FIX.me;
const POOL = `0x${"a1".repeat(32)}`;
/** 0x1::delegation_pool entry ABIs (GET /v1/accounts/0x1/module/delegation_pool on testnet, 2026-10-03). */
const DELEGATION_FNS = ["add_stake", "unlock", "withdraw"].map((name) => ({ name, is_entry: true, generic_type_params: [], params: ["&signer", "address", "u64"] }));

const routes = (): Route[] => [
  { method: "GET", path: new RegExp(`/accounts/${ME}$`), handler: () => ({ sequence_number: "3", authentication_key: ME }) },
  { method: "GET", path: /\/estimate_gas_price$/, handler: () => ({ gas_estimate: 100 }) },
  { method: "GET", path: /\/accounts\/0x1\/module\/delegation_pool$/, handler: () => ({ abi: { exposed_functions: DELEGATION_FNS } }) },
  { method: "POST", path: /\/transactions\/simulate/, handler: () => simulation([], { gas_used: "900" }) },
];

describe("delegated staking payloads", () => {
  it("encodes add_stake / unlock / withdraw and reads them back with the SDK", () => {
    for (const action of ["add_stake", "unlock", "withdraw"] as const) {
      const p = delegationPayload(action, POOL, 1_234_567_890n);
      expect(p).toEqual({ function: `0x1::delegation_pool::${action}`, typeArguments: [], functionArguments: [POOL, "1234567890"] });
      const d = decodeEntryPayload(encodeEntryPayload(p, DELEGATION_FNS[0]!));
      expect(d.function).toBe(`0x1::delegation_pool::${action}`);
      expect(bcsAddress(d.args[0]!)).toBe(POOL);
      expect(bcsU64(d.args[1]!)).toBe(1_234_567_890n);
    }
    expect(() => delegationPayload("add_stake", "pool", 1n)).toThrow(expect.objectContaining({ code: "aptos/bad-address" }));
    expect(() => delegationPayload("add_stake", POOL, 0n)).toThrow(expect.objectContaining({ code: "aptos/bad-amount" }));
  });

  it("decodes vector<address> arguments", () => {
    const d = decodeEntryPayload(
      encodeEntryPayload(
        { function: "0xbeef::router::swap", functionArguments: [[POOL, ME], "5"] },
        { generic_type_params: [], params: ["&signer", "vector<address>", "u64"] },
      ),
    );
    expect(bcsAddressVector(d.args[0]!)).toEqual([POOL, ME]);
  });

  it("the module builds and describes a wallet-built add_stake as “Stake 12.5 APT”", async () => {
    const m = mockAptos(routes());
    const r = req("aptos:signAndSubmitTransaction", { account: ME, payload: delegationPayload("add_stake", POOL, 1_250_000_000n) }, "wallet");
    const d = await createAptosModule({ simulate: false }).decode(r, ctxFor(m.fetch));
    expect(d.title).toBe("Stake 12.5 APT");
    expect(d.blind).toBe(false);
    expect(d.lines).toContainEqual({ label: "Stake with", value: POOL });
    const u = await createAptosModule({ simulate: false }).decode(
      req("aptos:signAndSubmitTransaction", { account: ME, payload: delegationPayload("unlock", POOL, 1_000_000_000n) }, "wallet"),
      ctxFor(m.fetch),
    );
    expect(u.title).toBe("Unstake 10 APT");
  });
});
