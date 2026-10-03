import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { describe, expect, it } from "vitest";
import { buildStakeTransaction, buildUnstakeTransaction, createSuiModule, inspectTransaction, pureAddressOf, pureU64Of, transactionFromKind } from "../src/index.js";
import { b64encode } from "../src/util.js";
import { ctxFor, metadata, mockGql, req } from "./helpers.js";
import { FIX } from "./signatures.js";

const VALIDATOR = `0x${"5a".repeat(32)}`;
const GAS = { objectId: `0x${"33".repeat(32)}`, version: "7", digest: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi" };

/** Resolve the wallet-built JSON offline (gas fixed, 0x5 is a known shared object) so the module can decode the bytes. */
async function offlineBytes(json: string): Promise<Uint8Array> {
  const tx = Transaction.from(json);
  tx.setGasPayment([GAS]);
  tx.setGasPrice(1000);
  tx.setGasBudget(3_000_000);
  return tx.build();
}

describe("wallet-built staking", () => {
  it("builds SplitCoins(gas) + 0x3::sui_system::request_add_stake(0x5, coin, validator)", async () => {
    const json = await buildStakeTransaction({ sender: FIX.me, validator: VALIDATOR, amount: 2_000_000_000n });
    const data = inspectTransaction(json);
    expect(normalizeSuiAddress(data.sender!)).toBe(FIX.me);
    expect(data.commands.map((c) => c.$kind)).toEqual(["SplitCoins", "MoveCall"]);
    expect(pureU64Of(data.inputs[(data.commands[0]!.SplitCoins!.amounts[0] as { Input: number }).Input])).toBe(2_000_000_000n);
    const call = data.commands[1]!.MoveCall!;
    expect([normalizeSuiAddress(call.package), call.module, call.function]).toEqual([normalizeSuiAddress("0x3"), "sui_system", "request_add_stake"]);
    expect(pureAddressOf(data.inputs[(call.arguments[2] as { Input: number }).Input])).toBe(VALIDATOR);
  });

  it("is what decode() calls “Stake 2 SUI”", async () => {
    const json = await buildStakeTransaction({ sender: FIX.me, validator: VALIDATOR, amount: 2_000_000_000n });
    const bytes = await offlineBytes(json);
    const m = mockGql({ clipCoinMetadata: (v) => ({ coinMetadata: metadata[v.coinType as string] ?? null }) });
    const d = await createSuiModule({ simulate: false }).decode(req("sui:signAndExecuteTransaction", { inputs: [{ account: FIX.me, transaction: b64encode(bytes), chain: "sui:testnet" }] }, "wallet"), ctxFor(m.fetch));
    expect(d.title).toBe("Stake 2 SUI");
    expect(d.blind).toBe(false);
    expect(d.lines).toContainEqual({ label: "Stake with", value: VALIDATOR });
  });

  it("refuses less than 1 SUI", async () => {
    await expect(buildStakeTransaction({ sender: FIX.me, validator: VALIDATOR, amount: 999_999_999n })).rejects.toMatchObject({ code: "sui/stake-below-minimum" });
  });

  it("builds request_withdraw_stake(0x5, StakedSui)", async () => {
    const id = `0x${"57".repeat(32)}`;
    const data = inspectTransaction(await buildUnstakeTransaction({ sender: FIX.me, stakedSuiId: id }));
    const call = data.commands[0]!.MoveCall!;
    expect(call.function).toBe("request_withdraw_stake");
    const input = data.inputs[(call.arguments[1] as { Input: number }).Input] as { UnresolvedObject?: { objectId: string } };
    expect(normalizeSuiAddress(input.UnresolvedObject!.objectId)).toBe(id);
  });

  it("turns a TransactionKind into transaction JSON for this sender", async () => {
    const kind = new Transaction();
    kind.transferObjects([kind.splitCoins(kind.gas, [5])[0]!], FIX.bob);
    const kindB64 = b64encode(await kind.build({ onlyTransactionKind: true }));
    const data = inspectTransaction(await transactionFromKind(kindB64, FIX.me));
    expect(normalizeSuiAddress(data.sender!)).toBe(FIX.me);
    expect(data.commands.map((c) => c.$kind)).toEqual(["SplitCoins", "TransferObjects"]);
    await expect(transactionFromKind("not base64!", FIX.me)).rejects.toMatchObject({ code: "sui/bad-transaction" });
  });
});
