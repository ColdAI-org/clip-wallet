/** Settle on Hedera requests the wallet builds read as plain actions, not as unreadable calls. */
import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbiItem } from "viem";
import { lookupSelector } from "../src/selectors.js";

describe("settle on Hedera selectors", () => {
  it("names SettleDeposit.deposit (0x1257b39b), claimDefault and withdrawOwed", () => {
    expect(lookupSelector("0x1257b39b")?.action).toBe("Pay a Connector");
    const claim = encodeFunctionData({ abi: [parseAbiItem("function claimDefault(bytes32)")], args: [`0x${"ab".repeat(32)}`] });
    expect(lookupSelector(claim)?.action).toBe("Claim a late payment back");
    const owed = encodeFunctionData({ abi: [parseAbiItem("function withdrawOwed(address)")], args: ["0x0000000000000000000000000000000000000000"] });
    expect(lookupSelector(owed)?.action).toBe("Collect a payout");
  });
});
