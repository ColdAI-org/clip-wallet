import { AccountUpdateTransaction, Transaction } from "@hiero-ledger/sdk";
import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { createAddressWithSeed, address, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { HederaStaking, hederaApy } from "../src/staking/hedera.js";
import { SolanaStaking, rankValidators, type VoteAccount } from "../src/staking/solana.js";
import { StakingService } from "../src/staking/service.js";
import { onlyPrograms, STAKE_PROGRAM, SYSTEM_PROGRAM } from "../src/solana-verify.js";
import { refineDecoded } from "../src/steps.js";
import { DEVNET, ME_HEDERA, ME_SOL, accountFor, fakeHost, flush, mirrorAccount, mockFetch, sol } from "./helpers.js";

const MIRROR = /testnet\.mirrornode\.hedera\.com/;
const NODES = {
  nodes: [
    { node_id: 0, node_account_id: "0.0.3", description: "Hosted by Hedera | West Coast, USA", stake: 4.5e16, max_stake: 4.5e16, min_stake: 0, stake_rewarded: 1.8e17, reward_rate_start: 510, decline_reward: false },
    { node_id: 3, node_account_id: "0.0.6", description: "Hosted by LG | Seoul", stake: 1e15, max_stake: 4.5e16, min_stake: 0, stake_rewarded: 1e15, reward_rate_start: 2054, decline_reward: false },
    { node_id: 7, node_account_id: "0.0.10", description: null, stake: 0, max_stake: 4.5e16, min_stake: 0, stake_rewarded: 0, reward_rate_start: 0, decline_reward: false },
  ],
  links: { next: null },
};

function hederaCtx(fetchImpl: typeof fetch) {
  return { network: HEDERA_TESTNET, account: accountFor(HEDERA_TESTNET), fetch: fetchImpl };
}

describe("Hedera staking", () => {
  it("turns reward_rate_start (tinybars per HBAR per day) into a yearly rate", () => {
    expect(hederaApy(2054)).toBeCloseTo(0.7497, 3);
    expect(hederaApy(510)).toBeCloseTo(0.186, 3);
  });

  it("lists nodes best first, in plain words, with one recommended", async () => {
    const { fetch } = mockFetch([[/\/network\/nodes/, NODES]]);
    const opts = await new HederaStaking().options(hederaCtx(fetch));
    expect(opts[0]).toMatchObject({ id: "3", title: "Node 3 · Hosted by LG | Seoul", recommended: true });
    expect(opts[0]!.detail).toBe("Earns about 0.75% a year");
    expect(opts[1]!.detail).toContain("busy");
    expect(opts.find((o) => o.id === "7")!.detail).toBe("Not paying rewards right now");
    expect(opts.filter((o) => o.recommended)).toHaveLength(1);
  });

  it("shows the current position and pending reward", async () => {
    const { fetch } = mockFetch([
      [/\/accounts\/0\.0\.1001/, mirrorAccount(ME_HEDERA, { staked_node_id: 3, pending_reward: 4_200_000 })],
      [/\/network\/nodes/, NODES],
    ]);
    const [p] = await new HederaStaking().positions(hederaCtx(fetch));
    expect(p).toMatchObject({ with: "Node 3 · Hosted by LG | Seoul", status: "active", statusText: "Earning rewards", amountDisplay: "123.45 HBAR" });
    expect(p!.pendingReward).toEqual({ amount: "4200000", display: "0.042 HBAR" });
    expect(p!.actions).toEqual(["change", "unstake"]);
  });

  it("no position when not staked; rewards-off when declined", async () => {
    const a = mockFetch([[/\/accounts\//, mirrorAccount(ME_HEDERA)]]);
    expect(await new HederaStaking().positions(hederaCtx(a.fetch))).toEqual([]);
    const b = mockFetch([[/\/accounts\//, mirrorAccount(ME_HEDERA, { staked_node_id: 0, decline_reward: true })], [/\/network\/nodes/, NODES]]);
    expect((await new HederaStaking().positions(hederaCtx(b.fetch)))[0]!.status).toBe("rewards-off");
  });

  it("builds an AccountUpdate staking to the recommended node (normal approval path)", async () => {
    const { fetch } = mockFetch([[/\/network\/nodes/, NODES]]);
    const build = await new HederaStaking().buildStake({}, hederaCtx(fetch));
    const step = build.steps[0]!;
    expect(step.title).toBe("Stake your HBAR");
    const req = step.request as { method: string; params: { transactionList: string; signerAccountId: string } };
    expect(req.method).toBe("hedera_signAndExecuteTransaction");
    expect(req.params.signerAccountId).toBe("hedera:testnet:0.0.1001");
    const tx = Transaction.fromBytes(Buffer.from(req.params.transactionList, "base64"));
    expect(tx).toBeInstanceOf(AccountUpdateTransaction);
    expect((tx as AccountUpdateTransaction).stakedNodeId?.toString()).toBe("3");
    expect((tx as AccountUpdateTransaction).declineStakingRewards).toBe(false);
  });

  it("unstake clears the staked node", async () => {
    const { fetch } = mockFetch([]);
    const build = await new HederaStaking().buildUnstake({ positionId: "x" }, hederaCtx(fetch));
    const req = build.steps[0]!.request as { params: { transactionList: string } };
    const tx = Transaction.fromBytes(Buffer.from(req.params.transactionList, "base64")) as AccountUpdateTransaction;
    expect(build.steps[0]!.title).toBe("Stop staking HBAR");
    expect(tx.stakedNodeId?.toString()).toBe("-1");
  });
});

/* ------------------------------------------------------------------ Solana */

const vote = (votePubkey: string, commission: number, stake: number, credits: number, epochVoteAccount = true): VoteAccount => ({
  votePubkey,
  nodePubkey: votePubkey,
  activatedStake: stake,
  commission,
  epochVoteAccount,
  epochCredits: [[99, 1000 + credits, 1000]],
  lastVote: 1,
});

const V_GOOD = "FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f";
const V_ZERO = "APsEUZJjrb58KCS6z7rJJAmXB76b9bfAigjDzG242xhr";
const V_GREEDY = "vgcDar2pryHvMgPkKaZfh8pQy4BJxv7SpwUG7zinWjG";
const V_OFFLINE = "7AETLyAGJWjp6AWzZqZcP362yv5LQ3nLEdwnXNjdNwwF";
const VOTES = { current: [vote(V_GREEDY, 95, 9e15, 8000), vote(V_ZERO, 0, 6e14, 7900), vote(V_GOOD, 5, 2e14, 8000), vote(V_OFFLINE, 0, 1e14, 1000)], delinquent: [] };

describe("Solana validator choice", () => {
  it("keeps low-commission, high-uptime validators; vetted list wins when healthy", () => {
    const ranked = rankValidators(VOTES.current, 100, { baseApy: 7 });
    expect(ranked.map((r) => r.vote.votePubkey)).toEqual([V_ZERO, V_GOOD]);
    expect(ranked[1]!.apy).toBeCloseTo(6.65);
    expect(rankValidators(VOTES.current, 100, { vetted: [V_GOOD] }).map((r) => r.vote.votePubkey)).toEqual([V_GOOD]);
    // A vetted validator that is offline is ignored.
    expect(rankValidators(VOTES.current, 100, { vetted: [V_OFFLINE] })[0]!.vote.votePubkey).toBe(V_ZERO);
  });
});

function solanaRpc(extra: Record<string, (p: unknown[]) => unknown> = {}) {
  return mockFetch([], {
    getVoteAccounts: () => VOTES,
    getEpochInfo: () => ({ epoch: 100 }),
    getInflationRate: () => ({ total: 0.045, validator: 0.042, foundation: 0, epoch: 100 }),
    getSupply: () => ({ value: { total: 6e17 } }),
    getStakeMinimumDelegation: () => ({ value: 1_000_000_000 }),
    getMinimumBalanceForRentExemption: () => 1_666_240,
    getBalance: () => ({ value: 5_000_000_000 }),
    getMultipleAccounts: (p) => ({ value: (p[0] as string[]).map((_, i) => (i === 0 ? { lamports: 1 } : null)) }),
    getLatestBlockhash: () => ({ value: { blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", lastValidBlockHeight: 1000 } }),
    getProgramAccounts: () => [
      stakeAcct("Acct1111111111111111111111111111111111111111", "delegated", { voter: V_GOOD, stake: "1000000000", activationEpoch: "90", deactivationEpoch: "18446744073709551615" }),
      stakeAcct("Acct2222222222222222222222222222222222222222", "delegated", { voter: V_GOOD, stake: "2000000000", activationEpoch: "90", deactivationEpoch: "99" }),
      stakeAcct("Acct3333333333333333333333333333333333333333", "delegated", { voter: V_GOOD, stake: "2000000000", activationEpoch: "100", deactivationEpoch: "18446744073709551615" }),
      stakeAcct("Acct4444444444444444444444444444444444444444", "delegated", { voter: V_GOOD, stake: "2000000000", activationEpoch: "90", deactivationEpoch: "100" }),
    ],
    ...extra,
  });
}

function stakeAcct(pubkey: string, type: string, delegation: Record<string, string>) {
  return {
    pubkey,
    account: {
      lamports: Number(delegation.stake) + 1_666_240,
      data: { parsed: { type, info: { meta: { authorized: { staker: ME_SOL, withdrawer: ME_SOL }, rentExemptReserve: "1666240" }, stake: { delegation } } } },
    },
  };
}

const solCtx = (f: typeof fetch) => ({ network: DEVNET, account: accountFor(DEVNET), fetch: f });

describe("Solana staking", () => {
  it("estimates the yearly rate from inflation and total stake", async () => {
    const { fetch } = solanaRpc();
    const opts = await new SolanaStaking().options(solCtx(fetch));
    // Toy numbers: validator inflation 4.2 % × supply / total stake; commission 0 keeps it all.
    expect(opts[0]).toMatchObject({ id: V_ZERO, recommended: true });
    expect(opts[0]!.detail).toContain("keeps 0% of rewards");
    expect(opts[0]!.title).toBe(`Validator ${V_ZERO.slice(0, 4)}…${V_ZERO.slice(-4)}`);
    expect(opts[0]!.apy).toBeCloseTo(4.2 * (6e17 / 9.9e15), 1);
  });

  it("reads stake accounts this wallet can withdraw, with plain statuses", async () => {
    const { fetch, calls } = solanaRpc();
    const ps = await new SolanaStaking().positions(solCtx(fetch));
    expect(ps.map((p) => p.status)).toEqual(["active", "withdrawable", "activating", "deactivating"]);
    expect(ps[1]!.actions).toEqual(["withdraw"]);
    expect(ps[3]!.statusText).toContain("about 2 days");
    const gpa = calls.find((c) => c.method === "getProgramAccounts")!;
    expect(gpa.params![0]).toBe(STAKE_PROGRAM);
    expect(JSON.stringify(gpa.params![1])).toContain(`"offset":44,"bytes":"${ME_SOL}"`);
  });

  it("stakes into a seeded stake account (no new keypair), only System + Stake programs", async () => {
    const { fetch } = solanaRpc();
    const build = await new SolanaStaking().buildStake({ amount: "2000000000" }, solCtx(fetch));
    const step = build.steps[0]!;
    expect(step.title).toBe("Stake 2 SOL");
    const req = step.request as { method: string; params: { inputs: { transaction: string; chain: string }[] } };
    expect(req.method).toBe("solana:signAndSendTransaction");
    expect(req.params.inputs[0]!.chain).toBe("solana:devnet");
    expect(onlyPrograms(req as never, [SYSTEM_PROGRAM, STAKE_PROGRAM])).toBe(true);
    expect(step.verify).toBeUndefined(); // chains-solana decodes native staking itself (platform §5b)
    // Seed 0 is taken (mock), so the wallet uses clip-stake-1.
    const expected = await createAddressWithSeed({ baseAddress: address(ME_SOL), programAddress: address(STAKE_PROGRAM), seed: "clip-stake-1" });
    const [tx] = getTransactionDecoder().read(Buffer.from(req.params.inputs[0]!.transaction, "base64"), 0);
    const [msg] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
    const m = msg as unknown as { staticAccounts: string[]; instructions: unknown[]; header: { numSignerAccounts: number } };
    expect(m.staticAccounts).toContain(expected);
    expect(m.instructions).toHaveLength(3);
    expect(m.header.numSignerAccounts).toBe(1); // only the user signs
    expect(m.staticAccounts[0]).toBe(ME_SOL);
  });

  it("refuses below the minimum and when the balance can't cover stake + opening cost", async () => {
    const { fetch } = solanaRpc();
    await expect(new SolanaStaking().buildStake({ amount: "500000000" }, solCtx(fetch))).rejects.toMatchObject({ userMessage: "Stake at least 1 SOL." });
    await expect(new SolanaStaking().buildStake({ amount: "4999000000" }, solCtx(fetch))).rejects.toMatchObject({ code: "staking/insufficient" });
  });

  it("unstake and withdraw only for this wallet's stake, withdraw only when ready", async () => {
    const { fetch } = solanaRpc();
    const s = new SolanaStaking();
    const un = await s.buildUnstake({ positionId: "Acct1111111111111111111111111111111111111111" }, solCtx(fetch));
    expect(un.steps[0]!.title).toBe("Unstake 1.0016 SOL");
    const wd = await s.buildWithdraw({ positionId: "Acct2222222222222222222222222222222222222222" }, solCtx(fetch));
    expect(wd.steps[0]!.title).toBe("Move 2.0016 SOL back to your balance");
    await expect(s.buildWithdraw({ positionId: "Acct1111111111111111111111111111111111111111" }, solCtx(fetch))).rejects.toMatchObject({ code: "staking/not-withdrawable" });
    await expect(s.buildUnstake({ positionId: "Nope" }, solCtx(fetch))).rejects.toMatchObject({ code: "staking/unknown-position" });
  });
});

describe("StakingService", () => {
  it("speaks in assets, queues the stake on the approval path, and keeps the module's verdict on blindness", async () => {
    const { fetch } = solanaRpc();
    const host = fakeHost({ networks: [DEVNET], fetch, balances: [{ asset: sol(DEVNET.id), amount: "5000000000" }] });
    const svc = new StakingService(host, [new HederaStaking(), new SolanaStaking()]);
    const overview = await svc.overview();
    expect(overview).toHaveLength(1);
    expect(overview[0]).toMatchObject({ assetKey: "sol", symbol: "SOL", wholeBalance: false });
    expect(overview[0]!.positions).toHaveLength(4);
    const q = await svc.stake({ assetKey: "sol", amount: "1.5" });
    expect(q).toEqual({ approvalId: "approval-1", steps: ["Stake 1.5 SOL"] });
    const req = host.enqueued[0]!.request;
    const blind = { requestId: req.id, title: "Unreadable request", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [{ level: "danger" as const, code: "blind-signing" as const, message: "x" }], networkId: DEVNET.id };
    // chains-solana decodes the stake (not blind): the wallet's plain title is kept.
    const read = { ...blind, title: "Stake 1.5 SOL with validator Abcd…wxyz", blind: false, warnings: [] };
    expect(refineDecoded(req, read)).toMatchObject({ title: "Stake 1.5 SOL", blind: false });
    // Something the module couldn't read stays blind, dry run or not.
    expect(refineDecoded(req, blind).blind).toBe(true);
    expect(refineDecoded(req, { ...blind, simulated: false }).blind).toBe(true);
    await flush();
  });

  it("families from other streams show as coming soon", async () => {
    const substrate = { ...DEVNET, id: "polkadot:test", family: "substrate" as const, nativeAsset: { key: "dot", symbol: "DOT", name: "Polkadot", decimals: 10, networkId: "polkadot:test" } };
    const host = fakeHost({ networks: [substrate], fetch: mockFetch([]).fetch });
    const view = await new StakingService(host, [new SolanaStaking()]).overview();
    expect(view).toEqual([expect.objectContaining({ assetKey: "dot", unavailable: { code: "staking/coming-soon", message: "Staking DOT is coming soon." } })]);
    await expect(new StakingService(host, []).stake({ assetKey: "dot", amount: "1" })).rejects.toMatchObject({ userMessage: "Staking this is coming soon." });
  });
});
