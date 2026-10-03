import { type ChainContext, ClipError, type Network } from "@clip-wallet/core";
import { buildStakeUpdate, mirrorFor, resolvePayer } from "@clip-wallet/chains-hedera";
import type { StakeOptionView, StakePositionView } from "../views.js";
import { formatUnits, percent } from "../util.js";
import type { StakeBuild, StakingProvider } from "./types.js";

/**
 * Hedera native staking (HIP-406), through AccountUpdate stakedNodeId / declineReward.
 * Mirror node (https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml):
 *  - /api/v1/network/nodes: node_id, description, stake, max_stake, stake_rewarded, reward_rate_start
 *    ("total tinybars earned by this node per whole hbar in the last staking period"; a period is one day).
 *  - /api/v1/accounts/{id}: staked_node_id, staked_account_id, decline_reward, pending_reward, balance.
 * Rewards are paid automatically the next time the account is part of a transaction, so there is no claim step.
 */
export interface MirrorNode {
  node_id: number;
  node_account_id: string;
  description: string | null;
  stake: number;
  max_stake: number;
  min_stake: number;
  stake_rewarded: number;
  reward_rate_start: number;
  decline_reward: boolean;
}

const TINYBARS = 100_000_000;

/** Approximate yearly rate in percent from a node's last daily reward rate (tinybars per HBAR per day). */
export function hederaApy(rewardRateStart: number): number {
  return (rewardRateStart * 365 * 100) / TINYBARS;
}

function nodeTitle(n: MirrorNode): string {
  const d = (n.description ?? "").replace(/\s+/g, " ").trim();
  return d ? `Node ${n.node_id} · ${d}` : `Node ${n.node_id}`;
}

export class HederaStaking implements StakingProvider {
  readonly family = "hedera" as const;
  readonly assetKey = "hbar";
  readonly wholeBalance = true;
  readonly howItWorks =
    "Your whole HBAR balance earns rewards where it is. Nothing is locked or moved: you can spend it any time, and rewards arrive automatically the next time you send or receive.";

  supports(network: Network): boolean {
    return network.family === "hedera";
  }

  async nodes(ctx: ChainContext): Promise<MirrorNode[]> {
    const mirror = mirrorFor(ctx);
    return mirror.paged<MirrorNode>("/api/v1/network/nodes?limit=25", "nodes", 4);
  }

  async options(ctx: ChainContext): Promise<StakeOptionView[]> {
    const nodes = (await this.nodes(ctx)).filter((n) => n.max_stake > 0);
    if (!nodes.length) throw new ClipError("Staking options aren't available right now. Try again later.", "staking/no-nodes");
    const sorted = [...nodes].sort((a, b) => b.reward_rate_start - a.reward_rate_start || a.stake_rewarded / a.max_stake - b.stake_rewarded / b.max_stake || a.node_id - b.node_id);
    const best = sorted.find((n) => n.reward_rate_start > 0) ?? sorted[0]!;
    return sorted.map((n) => {
      const apy = hederaApy(n.reward_rate_start);
      const full = n.stake_rewarded >= n.max_stake;
      const v: StakeOptionView = {
        id: String(n.node_id),
        title: nodeTitle(n),
        detail: n.reward_rate_start > 0 ? `Earns about ${percent(apy)} a year${full ? " · busy, rewards may be lower" : ""}` : "Not paying rewards right now",
        apy,
      };
      if (n === best) v.recommended = true;
      return v;
    });
  }

  async rewardRate(ctx: ChainContext): Promise<string | undefined> {
    const best = (await this.options(ctx)).find((o) => o.recommended);
    return best?.apy ? `About ${percent(best.apy)} a year` : undefined;
  }

  async positions(ctx: ChainContext): Promise<StakePositionView[]> {
    const mirror = mirrorFor(ctx);
    const acct = await mirror.account(ctx.account.hederaAccountId ?? ctx.account.address);
    if (!acct || (acct.staked_node_id == null && !acct.staked_account_id)) return [];
    let withText = acct.staked_account_id ? `Through account ${acct.staked_account_id}` : `Node ${acct.staked_node_id}`;
    if (acct.staked_node_id != null) {
      const node = (await this.nodes(ctx).catch(() => [])).find((n) => n.node_id === acct.staked_node_id);
      if (node) withText = nodeTitle(node);
    }
    const amount = String(acct.balance.balance);
    const pending = String(acct.pending_reward ?? 0);
    const view: StakePositionView = {
      id: `hedera:${acct.account}`,
      assetKey: "hbar",
      symbol: "HBAR",
      decimals: 8,
      amount,
      amountDisplay: `${formatUnits(amount, 8, 4)} HBAR`,
      with: withText,
      status: acct.decline_reward ? "rewards-off" : "active",
      statusText: acct.decline_reward ? "Staked, rewards turned off" : "Earning rewards",
      actions: ["change", "unstake"],
      networkId: ctx.network.id,
    };
    if (BigInt(pending) > 0n) view.pendingReward = { amount: pending, display: `${formatUnits(pending, 8, 4)} HBAR` };
    return [view];
  }

  async buildStake(p: { optionId?: string }, ctx: ChainContext): Promise<StakeBuild> {
    await resolvePayer(ctx); // plain error before anything else if the account isn't open yet
    let nodeId = p.optionId !== undefined ? Number(p.optionId) : NaN;
    if (!Number.isInteger(nodeId)) {
      const best = (await this.options(ctx)).find((o) => o.recommended);
      nodeId = Number(best?.id);
    }
    const node = (await this.nodes(ctx)).find((n) => n.node_id === nodeId);
    if (!node) throw new ClipError("That staking option isn't available any more. Pick another.", "staking/unknown-option");
    const request = await buildStakeUpdate({ nodeId }, ctx, false);
    return {
      steps: [
        {
          title: "Stake your HBAR",
          request,
          lines: [
            { label: "With", value: nodeTitle(node) },
            { label: "Your HBAR", value: "Stays in your account and spendable" },
          ],
        },
      ],
    };
  }

  async buildUnstake(_p: { positionId: string }, ctx: ChainContext): Promise<StakeBuild> {
    const request = await buildStakeUpdate({ stop: true }, ctx);
    return { steps: [{ title: "Stop staking HBAR", request, lines: [{ label: "Rewards", value: "Stop from the next day; earned rewards are paid with your next transaction" }] }] };
  }
}
