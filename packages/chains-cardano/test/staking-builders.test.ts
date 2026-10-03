import { describe, expect, it } from "vitest";
import {
  CARDANO_METHODS,
  addressToBytes,
  createCardanoModule,
  encodeWitnessSet,
  feeFor,
  parseTransaction,
  rewardAddress,
} from "../src/index.js";
import { fromHex, hex } from "../src/util.js";
import { PARAMS, ctxFor, makeAccount, mockKoios, standardRoutes, type Route } from "./helpers.js";
import { FIX } from "./signatures.js";

const account = makeAccount(FIX);
const STAKE_HASH = addressToBytes(FIX.rewardAddress).subarray(1);
const OUR_INPUTS = 10_000_000n + 3_000_000n; // standardRoutes address_utxos

function setup(acct: Record<string, unknown>) {
  const extra: Route[] = [["POST", "/account_info", () => [{ stake_address: FIX.rewardAddress, total_balance: "13000000", ...acct }]]];
  const k = mockKoios(standardRoutes(FIX, extra));
  return { m: createCardanoModule(), ctx: ctxFor(account, k.fetch) };
}

/** Signed size with `n` vkey witnesses (what the module's finalize assembles), and the ledger's minimum fee for it. */
function minFee(txBytes: Uint8Array, n: number): bigint {
  const ws = encodeWitnessSet(Array.from({ length: n }, () => ({ publicKey: new Uint8Array(32), signature: new Uint8Array(64) })));
  return feeFor(txBytes.length - 1 + ws.length, PARAMS);
}

function parsed(r: { params: unknown }) {
  const bytes = fromHex((r.params as { tx: string }).tx);
  return { bytes, tx: parseTransaction(bytes) };
}

const outSum = (tx: ReturnType<typeof parseTransaction>) => tx.body.outputs.reduce((a, o) => a + o.value.coin, 0n);

describe("vote delegation (certificate 9)", () => {
  it("delegates to Always abstain, signed by payment and stake keys", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: null, rewards_available: "4200000" });
    const r = await m.buildVoteDelegate({ drep: "abstain" }, ctx);
    expect(r.method).toBe(CARDANO_METHODS.signAndSubmitTx);
    const { bytes, tx } = parsed(r);
    expect(tx.body.certs).toHaveLength(1);
    const [c] = tx.body.certs;
    expect(c!.type).toBe(9);
    expect(c!.cred).toEqual({ kind: "key", hash: STAKE_HASH });
    expect(c!.drep).toEqual({ kind: "abstain" });
    expect(tx.body.withdrawals).toEqual([]);
    expect(tx.body.fee).toBeGreaterThanOrEqual(minFee(bytes, 2));
    expect(outSum(tx) + tx.body.fee).toBe(BigInt(tx.body.inputs.length === 2 ? OUR_INPUTS : 10_000_000));
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Delegate your vote");
    expect(d.lines).toContainEqual({ label: "Voting power", value: "Delegate your vote to Always abstain" });
    expect(d.blind).toBe(false);
    const payloads = await m.prepare(r, ctx, "v1");
    expect(payloads.map((p) => p.derivationSubPath)).toEqual([undefined, "2/0"]);
    expect(hex(payloads[0]!.bytes)).toBe(hex(tx.bodyHash));
  });

  it("encodes No confidence as drep [3] and refuses unknown choices or unregistered keys", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: null, rewards_available: "0" });
    const { tx } = parsed(await m.buildVoteDelegate({ drep: "no-confidence" }, ctx));
    expect(tx.body.certs[0]!.drep).toEqual({ kind: "no-confidence" });
    await expect(m.buildVoteDelegate({ drep: "maybe" as never }, ctx)).rejects.toMatchObject({ code: "cardano/bad-drep" });
    const un = setup({ status: "not registered", delegated_pool: null, rewards_available: "0" });
    await expect(un.m.buildVoteDelegate({ drep: "abstain" }, un.ctx)).rejects.toMatchObject({ code: "cardano/not-registered" });
  });
});

describe("reward withdrawal", () => {
  it("withdraws exactly the available rewards to our address", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: "drep_always_abstain", rewards_available: "4200000" });
    const r = await m.buildWithdrawRewards(ctx);
    const { bytes, tx } = parsed(r);
    expect(tx.body.certs).toEqual([]);
    expect(tx.body.withdrawals).toHaveLength(1);
    expect(hex(tx.body.withdrawals[0]!.rewardAddress)).toBe(hex(rewardAddress(0, { kind: "key", hash: STAKE_HASH })));
    expect(tx.body.withdrawals[0]!.amount).toBe(4_200_000n);
    expect(tx.body.fee).toBeGreaterThanOrEqual(minFee(bytes, 2));
    expect(tx.body.fee).toBeLessThan(300_000n);
    // value conservation: inputs + withdrawal = outputs + fee; everything goes back to us
    const inputs = tx.body.inputs.length === 2 ? OUR_INPUTS : 10_000_000n;
    expect(outSum(tx) + tx.body.fee).toBe(inputs + 4_200_000n);
    for (const o of tx.body.outputs) expect(hex(o.address)).toBe(hex(addressToBytes(FIX.address)));
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Claim 4.2 ADA staking rewards");
    expect(d.balanceChanges).toEqual([expect.objectContaining({ delta: "4200000" })]);
    expect((await m.prepare(r, ctx, "w1")).map((p) => p.derivationSubPath)).toEqual([undefined, "2/0"]);
  });

  it("refuses without a vote delegation (ledger rule since Plomin) or without rewards", async () => {
    const a = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: null, rewards_available: "4200000" });
    await expect(a.m.buildWithdrawRewards(a.ctx)).rejects.toMatchObject({ code: "cardano/needs-vote-delegation" });
    const b = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: "drep_always_abstain", rewards_available: "0" });
    await expect(b.m.buildWithdrawRewards(b.ctx)).rejects.toMatchObject({ code: "cardano/no-rewards" });
  });
});

describe("deregistration (certificate 8)", () => {
  it("unregisters with the recorded deposit and withdraws rewards in the same transaction", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: "drep_always_no_confidence", rewards_available: "1500000", deposit: "2000000" });
    const r = await m.buildDeregister(ctx);
    const { bytes, tx } = parsed(r);
    expect(tx.body.certs).toHaveLength(1);
    expect(tx.body.certs[0]).toMatchObject({ type: 8, cred: { kind: "key", hash: STAKE_HASH }, deposit: 2_000_000n });
    expect(tx.body.withdrawals.map((w) => w.amount)).toEqual([1_500_000n]);
    expect(tx.body.fee).toBeGreaterThanOrEqual(minFee(bytes, 2));
    const inputs = tx.body.inputs.length === 2 ? OUR_INPUTS : 10_000_000n;
    expect(outSum(tx) + tx.body.fee).toBe(inputs + 1_500_000n + 2_000_000n);
    const d = await m.decode(r, ctx);
    expect(d.title).toBe("Stop staking");
    expect(d.lines).toContainEqual({ label: "Deposit back", value: "2 ADA" });
    expect(d.lines).toContainEqual({ label: "Claim rewards", value: "1.5 ADA" });
  });

  it("needs no withdrawal (or vote delegation) when there are no rewards; falls back to the protocol deposit", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: null, rewards_available: "0" });
    const { tx } = parsed(await m.buildDeregister(ctx));
    expect(tx.body.withdrawals).toEqual([]);
    expect(tx.body.certs[0]).toMatchObject({ type: 8, deposit: BigInt(PARAMS.stakeAddressDeposit) });
    expect(tx.body.inputs.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses when rewards are waiting and no vote delegation exists", async () => {
    const { m, ctx } = setup({ status: "registered", delegated_pool: FIX.pool, delegated_drep: null, rewards_available: "10" });
    await expect(m.buildDeregister(ctx)).rejects.toMatchObject({ code: "cardano/needs-vote-delegation" });
  });
});
