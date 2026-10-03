import { type ChainContext, ClipError, type DappRequest, type Network, WALLET_ORIGIN } from "@clip-wallet/core";
import { SolanaRpc, clusterOf } from "@clip-wallet/chains-solana";
import {
  type Address,
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getCreateAccountWithSeedInstruction } from "@solana-program/system";
import {
  STAKE_PROGRAM_ADDRESS,
  getDeactivateInstruction,
  getDelegateStakeInstruction,
  getInitializeInstruction,
  getWithdrawInstruction,
} from "@solana-program/stake";
import type { StakeOptionView, StakePositionView } from "../views.js";
import { bytesToB64, formatUnits, percent, randomId, shortAddress } from "../util.js";
import type { StakeBuild, StakingProvider } from "./types.js";


/**
 * Solana native delegation through the Stake program (https://github.com/solana-program/stake), built with
 * `@solana-program/stake` 0.10 (kit-native). The stake account is created WITH A SEED from the user's own
 * address (SystemProgram CreateAccountWithSeed), so no new keypair is ever generated outside the vault and
 * the user's key is the only signer. Staker = withdrawer = the user.
 *
 * Reads: getProgramAccounts (Stake program, dataSize 200, withdrawer at offset 44), getEpochInfo,
 * getVoteAccounts, getInflationRate, getSupply, getStakeMinimumDelegation, getMinimumBalanceForRentExemption.
 */
export const STAKE_ACCOUNT_SIZE = 200;
export const WITHDRAWER_OFFSET = 44;
const U64_MAX = "18446744073709551615";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** Seeds the wallet uses for its stake accounts ("clip-stake-0" … "clip-stake-31"). */
export const STAKE_SEED_PREFIX = "clip-stake-";
const MAX_SEEDS = 32;

export interface VoteAccount {
  votePubkey: string;
  nodePubkey: string;
  activatedStake: number;
  commission: number;
  epochVoteAccount: boolean;
  epochCredits: [number, number, number][];
  lastVote: number;
}

interface ParsedStakeAccount {
  pubkey: string;
  account: {
    lamports: number;
    data: {
      parsed: {
        type: "initialized" | "delegated" | string;
        info: {
          meta: { authorized: { staker: string; withdrawer: string }; rentExemptReserve: string };
          stake?: { delegation: { voter: string; stake: string; activationEpoch: string; deactivationEpoch: string } };
        };
      };
    };
  };
}

export interface ValidatorChoice {
  vote: VoteAccount;
  /** Share of the last full epoch's credits vs the best validator (0..1). */
  uptime: number;
  apy?: number;
}

function rpcFor(ctx: ChainContext): SolanaRpc {
  const url = ctx.network.rpcUrls[0];
  if (!url) throw new ClipError("Staking isn't available right now.", "staking/no-rpc");
  return new SolanaRpc(url, ctx.fetch);
}

/** Credits earned in the last completed epoch present in epochCredits. */
function lastEpochCredits(v: VoteAccount, epoch: number): number {
  const e = v.epochCredits.find((c) => c[0] === epoch);
  return e ? e[1] - e[2] : 0;
}

/**
 * Pick validators: non-delinquent, commission ≤ 10 %, at least 90 % of the best uptime last epoch, and not in
 * the top 10 % by stake (spreads stake out). `vetted` (curated vote accounts) wins when any are healthy.
 */
export function rankValidators(current: VoteAccount[], epoch: number, opts: { vetted?: string[]; baseApy?: number } = {}): ValidatorChoice[] {
  const prev = epoch - 1;
  const best = Math.max(1, ...current.map((v) => lastEpochCredits(v, prev)));
  const byStake = [...current].sort((a, b) => b.activatedStake - a.activatedStake);
  const topCut = Math.floor(byStake.length / 10);
  const tooBig = new Set(byStake.slice(0, topCut).map((v) => v.votePubkey));
  const scored = current.map((vote) => {
    const c: ValidatorChoice = { vote, uptime: lastEpochCredits(vote, prev) / best };
    if (opts.baseApy !== undefined) c.apy = opts.baseApy * (1 - vote.commission / 100);
    return c;
  });
  const healthy = (c: ValidatorChoice) => c.vote.epochVoteAccount && c.vote.commission <= 10 && c.uptime >= 0.9;
  const vetted = new Set(opts.vetted ?? []);
  const fromVetted = scored.filter((c) => vetted.has(c.vote.votePubkey) && healthy(c));
  const pool = fromVetted.length ? fromVetted : scored.filter((c) => healthy(c) && !tooBig.has(c.vote.votePubkey));
  return pool.sort((a, b) => a.vote.commission - b.vote.commission || b.uptime - a.uptime || b.vote.activatedStake - a.vote.activatedStake);
}

function statusOf(type: string, d: { activationEpoch: string; deactivationEpoch: string } | undefined, epoch: number): Pick<StakePositionView, "status" | "statusText" | "actions"> {
  if (type !== "delegated" || !d) return { status: "withdrawable", statusText: "Not staked. Ready to move back to your balance", actions: ["withdraw"] };
  if (d.deactivationEpoch !== U64_MAX) {
    if (epoch > Number(d.deactivationEpoch)) return { status: "withdrawable", statusText: "Ready to move back to your balance", actions: ["withdraw"] };
    return { status: "deactivating", statusText: "Unlocking. Ready in about 2 days", actions: [] };
  }
  if (epoch <= Number(d.activationEpoch)) return { status: "activating", statusText: "Starts earning in about 2 days", actions: ["unstake"] };
  return { status: "active", statusText: "Earning rewards", actions: ["unstake"] };
}

export class SolanaStaking implements StakingProvider {
  readonly family = "solana" as const;
  readonly assetKey = "sol";
  readonly wholeBalance = false;
  readonly howItWorks =
    "You put an amount of SOL in a stake account that only you control. It starts earning in about 2 days. Rewards are added to it automatically. Unstaking takes about 2 days, then you move it back to your balance.";

  constructor(private readonly vetted: Record<string, string[]> = {}) {}

  supports(network: Network): boolean {
    return network.family === "solana" && network.rpcUrls.length > 0;
  }

  private async epoch(rpc: SolanaRpc): Promise<number> {
    return (await rpc.call<{ epoch: number }>("getEpochInfo", [{ commitment: "confirmed" }])).epoch;
  }

  /** Network-wide yearly rate before commission, in percent: validator inflation × supply / total stake. */
  async baseApy(rpc: SolanaRpc, votes?: { current: VoteAccount[]; delinquent: VoteAccount[] }): Promise<number | undefined> {
    try {
      const v = votes ?? (await rpc.call<{ current: VoteAccount[]; delinquent: VoteAccount[] }>("getVoteAccounts", [{ commitment: "confirmed" }]));
      const inflation = await rpc.call<{ validator: number }>("getInflationRate", []);
      const supply = await rpc.call<{ value: { total: number } }>("getSupply", [{ commitment: "confirmed", excludeNonCirculatingAccountsList: true }]);
      const staked = [...v.current, ...v.delinquent].reduce((t, x) => t + x.activatedStake, 0);
      if (!staked || !supply.value.total) return undefined;
      return inflation.validator * (supply.value.total / staked) * 100;
    } catch {
      return undefined;
    }
  }

  async validators(ctx: ChainContext): Promise<ValidatorChoice[]> {
    const rpc = rpcFor(ctx);
    const votes = await rpc.call<{ current: VoteAccount[]; delinquent: VoteAccount[] }>("getVoteAccounts", [{ commitment: "confirmed" }]);
    const epoch = await this.epoch(rpc);
    const baseApy = await this.baseApy(rpc, votes);
    return rankValidators(votes.current, epoch, { vetted: this.vetted[ctx.network.id], baseApy });
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const ranked = await this.validators(ctx);
    if (!ranked.length) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    return ranked.slice(0, 10).map((c, i) => {
      const v: StakeOptionView = {
        id: c.vote.votePubkey,
        title: `Validator ${shortAddress(c.vote.votePubkey)}`,
        detail: `${c.apy !== undefined ? `Earns about ${percent(c.apy)} a year · ` : ""}keeps ${c.vote.commission}% of rewards · online ${percent(c.uptime * 100, 0)}`,
      };
      if (c.apy !== undefined) v.apy = c.apy;
      if (i === 0) v.recommended = true;
      return v;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx).catch(() => []))[0];
    return best?.apy !== undefined ? `About ${percent(best.apy)} a year` : undefined;
  }

  private async stakeAccounts(ctx: ChainContext): Promise<ParsedStakeAccount[]> {
    return rpcFor(ctx).call<ParsedStakeAccount[]>("getProgramAccounts", [
      STAKE_PROGRAM_ADDRESS,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        filters: [{ dataSize: STAKE_ACCOUNT_SIZE }, { memcmp: { offset: WITHDRAWER_OFFSET, bytes: ctx.account.address } }],
      },
    ]);
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const rpc = rpcFor(ctx);
    const [accounts, epoch] = await Promise.all([this.stakeAccounts(ctx), this.epoch(rpc)]);
    return accounts.map((a) => {
      const info = a.account.data.parsed.info;
      const d = info.stake?.delegation;
      const amount = String(a.account.lamports);
      return {
        id: a.pubkey,
        assetKey: "sol",
        symbol: "SOL",
        decimals: 9,
        amount,
        amountDisplay: `${formatUnits(amount, 9, 4)} SOL`,
        with: d ? `Validator ${shortAddress(d.voter)}` : "No validator yet",
        ...statusOf(a.account.data.parsed.type, d, epoch),
        networkId: ctx.network.id,
      };
    });
  }

  /** First "clip-stake-N" address that doesn't exist yet. */
  async nextStakeAccount(ctx: ChainContext): Promise<{ seed: string; address: Address }> {
    const me = address(ctx.account.address);
    const candidates = await Promise.all(
      Array.from({ length: MAX_SEEDS }, async (_, i) => {
        const seed = `${STAKE_SEED_PREFIX}${i}`;
        return { seed, address: await createAddressWithSeed({ baseAddress: me, programAddress: STAKE_PROGRAM_ADDRESS, seed }) };
      }),
    );
    const res = await rpcFor(ctx).call<{ value: (unknown | null)[] }>("getMultipleAccounts", [candidates.map((c) => c.address), { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 0, length: 0 } }]);
    const free = candidates.find((_, i) => res.value[i] == null);
    if (!free) throw new ClipError("You have the most stake accounts this wallet manages. Withdraw an old one first.", "staking/too-many-accounts");
    return free;
  }

  async buildStake(p: { amount?: string; optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    const rpc = rpcFor(ctx);
    if (!p.amount || !/^\d+$/.test(p.amount) || BigInt(p.amount) <= 0n) throw new ClipError("Enter how much SOL to stake.", "staking/bad-amount");
    const amount = BigInt(p.amount);
    const min = BigInt((await rpc.call<{ value: number }>("getStakeMinimumDelegation", [{ commitment: "confirmed" }])).value);
    if (amount < min) throw new ClipError(`Stake at least ${formatUnits(min, 9)} SOL.`, "staking/below-minimum");
    const rent = BigInt(await rpc.call<number>("getMinimumBalanceForRentExemption", [STAKE_ACCOUNT_SIZE]));
    const balance = BigInt((await rpc.call<{ value: number }>("getBalance", [ctx.account.address, { commitment: "confirmed" }])).value);
    const feeBuffer = 10_000n;
    if (amount + rent + feeBuffer > balance) {
      throw new ClipError(`You need ${formatUnits(amount + rent + feeBuffer, 9)} SOL for this, including ${formatUnits(rent, 9)} SOL to open the stake account (you get it back when you withdraw).`, "staking/insufficient");
    }
    let vote = p.optionId;
    if (!vote) vote = (await this.validators(ctx))[0]?.vote.votePubkey;
    if (!vote) throw new ClipError("No validator meets Clip Wallet's checks right now. Try again later.", "staking/no-validators");
    const me = address(ctx.account.address);
    const signer = createNoopSigner(me);
    const { seed, address: stake } = await this.nextStakeAccount(ctx);
    const ixs: Instruction[] = [
      getCreateAccountWithSeedInstruction({
        payer: signer,
        newAccount: stake,
        base: me,
        seed,
        amount: amount + rent,
        space: BigInt(STAKE_ACCOUNT_SIZE),
        programAddress: STAKE_PROGRAM_ADDRESS,
      }),
      getInitializeInstruction({ stake, arg0: { staker: me, withdrawer: me }, arg1: { unixTimestamp: 0, epoch: 0, custodian: address(SYSTEM_PROGRAM) } }),
      getDelegateStakeInstruction({ stake, vote: address(vote), stakeAuthority: signer }),
    ];
    const request = await this.toRequest(ixs, ctx);
    return {
      steps: [
        {
          title: `Stake ${formatUnits(amount, 9)} SOL`,
          request,
          lines: [
            { label: "With", value: `Validator ${shortAddress(vote)}` },
            { label: "Opening cost", value: `${formatUnits(rent, 9)} SOL, returned when you withdraw` },
            { label: "Starts earning", value: "In about 2 days" },
          ],
        },
      ],
    };
  }

  private async ownedStake(ctx: ChainContext, id: string): Promise<ParsedStakeAccount> {
    const acct = (await this.stakeAccounts(ctx)).find((a) => a.pubkey === id);
    if (!acct) throw new ClipError("That stake isn't in this wallet any more.", "staking/unknown-position");
    if (acct.account.data.parsed.info.meta.authorized.staker !== ctx.account.address) {
      throw new ClipError("This stake is controlled by another wallet, so Clip Wallet can't change it.", "staking/not-staker");
    }
    return acct;
  }

  async buildUnstake(p: { positionId: string }, ctx: ChainContext): Promise<StakeBuild> {
    const acct = await this.ownedStake(ctx, p.positionId);
    const signer = createNoopSigner(address(ctx.account.address));
    const request = await this.toRequest([getDeactivateInstruction({ stake: address(acct.pubkey), stakeAuthority: signer })], ctx);
    return {
      steps: [
        {
          title: `Unstake ${formatUnits(String(acct.account.lamports), 9, 4)} SOL`,
          request,
          lines: [{ label: "Ready", value: "In about 2 days, then move it back to your balance" }],
        },
      ],
    };
  }

  async buildWithdraw(p: { positionId: string }, ctx: ChainContext): Promise<StakeBuild> {
    const acct = await this.ownedStake(ctx, p.positionId);
    const rpc = rpcFor(ctx);
    const epoch = await this.epoch(rpc);
    const s = statusOf(acct.account.data.parsed.type, acct.account.data.parsed.info.stake?.delegation, epoch);
    if (s.status !== "withdrawable") throw new ClipError("This SOL is still staked or unlocking. Try again once it's ready.", "staking/not-withdrawable");
    const me = address(ctx.account.address);
    const lamports = BigInt(acct.account.lamports);
    const request = await this.toRequest(
      [getWithdrawInstruction({ stake: address(acct.pubkey), recipient: me, withdrawAuthority: createNoopSigner(me), args: lamports })],
      ctx,
    );
    return { steps: [{ title: `Move ${formatUnits(lamports, 9, 4)} SOL back to your balance`, request }] };
  }

  private async toRequest(instructions: Instruction[], ctx: ChainContext): Promise<DappRequest> {
    const rpc = rpcFor(ctx);
    const me = address(ctx.account.address);
    const { value: latest } = await rpc.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(me, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash as never, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const wire = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
    const cluster = clusterOf(ctx.network.id);
    return {
      id: randomId(),
      origin: WALLET_ORIGIN,
      via: "injected",
      family: "solana",
      networkId: ctx.network.id,
      method: "solana:signAndSendTransaction",
      params: { inputs: [{ account: me, transaction: bytesToB64(wire), chain: cluster ? `solana:${cluster}` : ctx.network.id }] },
    };
  }
}
