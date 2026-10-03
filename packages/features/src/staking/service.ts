import { ClipError, type Network } from "@clip-wallet/core";
import type { FeatureHost } from "../host.js";
import { queueSteps } from "../steps.js";
import { parseUnits } from "../util.js";
import type { QueuedApprovals, StakeAssetView, StakeOptionView } from "../views.js";
import { PENDING_STAKING } from "./stubs.js";
import type { StakingProvider } from "./types.js";

/** Staking by asset ("Stake SOL"): the service picks the network you hold the most of that coin on. */
export class StakingService {
  constructor(
    private readonly host: FeatureHost,
    private readonly providers: StakingProvider[],
  ) {}

  private async pick(assetKey: string): Promise<{ provider: StakingProvider; network: Network }> {
    const provider = this.providers.find((p) => p.assetKey === assetKey);
    if (!provider) {
      const pending = PENDING_STAKING.find((p) => p.assetKey === assetKey);
      throw new ClipError(pending ? "Staking this is coming soon." : "This can't be staked in Clip Wallet.", "staking/unsupported");
    }
    const nets = this.host.networks().filter((n) => provider.supports(n) && n.nativeAsset.key === assetKey);
    if (!nets.length) throw new ClipError("Staking this isn't switched on in this wallet.", "staking/unsupported");
    const balances = await this.host.balances().catch(() => []);
    const held = (id: string) => balances.filter((b) => b.asset.networkId === id && b.asset.key === assetKey).reduce((t, b) => t + BigInt(b.amount), 0n);
    const network = [...nets].sort((a, b) => (held(b.id) > held(a.id) ? 1 : held(b.id) < held(a.id) ? -1 : 0))[0]!;
    return { provider, network };
  }

  async overview(): Promise<StakeAssetView[]> {
    const families = new Set(this.host.networks().map((n) => n.family));
    const out: StakeAssetView[] = [];
    for (const provider of this.providers) {
      if (!families.has(provider.family)) continue;
      const native = this.host.networks().find((n) => n.family === provider.family)?.nativeAsset;
      const base: StakeAssetView = {
        assetKey: provider.assetKey,
        symbol: native?.symbol ?? provider.assetKey.toUpperCase(),
        name: native?.name ?? provider.assetKey.toUpperCase(),
        wholeBalance: provider.wholeBalance,
        howItWorks: provider.howItWorks,
        positions: [],
      };
      try {
        const { network } = await this.pick(provider.assetKey);
        const ctx = await this.host.ctx(network.id);
        base.networkId = network.id;
        base.positions = await provider.positions(ctx);
        const rate = await provider.rewardRate?.(ctx).catch(() => undefined);
        if (rate) base.rewardRate = rate;
      } catch (e) {
        base.unavailable = { code: e instanceof ClipError ? e.code : "staking/unavailable", message: e instanceof ClipError ? e.userMessage : "Staking isn't available right now. Try again later." };
      }
      out.push(base);
    }
    for (const pending of PENDING_STAKING) {
      if (!families.has(pending.family) || out.some((o) => o.assetKey === pending.assetKey)) continue;
      const native = this.host.networks().find((n) => n.family === pending.family)?.nativeAsset;
      out.push({
        assetKey: pending.assetKey,
        symbol: native?.symbol ?? pending.assetKey.toUpperCase(),
        name: native?.name ?? pending.assetKey.toUpperCase(),
        wholeBalance: false,
        howItWorks: "",
        positions: [],
        unavailable: { code: "staking/coming-soon", message: `Staking ${native?.symbol ?? pending.assetKey.toUpperCase()} is coming soon.` },
      });
    }
    return out;
  }

  async options(assetKey: string): Promise<StakeOptionView[]> {
    const { provider, network } = await this.pick(assetKey);
    return provider.options(await this.host.ctx(network.id));
  }

  async stake(p: { assetKey: string; amount?: string; optionId?: string }): Promise<QueuedApprovals> {
    const { provider, network } = await this.pick(p.assetKey);
    const ctx = await this.host.ctx(network.id);
    const amount = provider.wholeBalance ? undefined : parseUnits(p.amount ?? "", network.nativeAsset.decimals).toString();
    const build = await provider.buildStake({ amount, optionId: p.optionId }, ctx);
    return queueSteps(this.host, build.steps, "Staking");
  }

  async act(p: { assetKey: string; positionId: string; action: "unstake" | "withdraw" | "claim" }): Promise<QueuedApprovals> {
    const { provider, network } = await this.pick(p.assetKey);
    const ctx = await this.host.ctx(network.id);
    const fn = p.action === "unstake" ? provider.buildUnstake : p.action === "withdraw" ? provider.buildWithdraw : provider.buildClaim;
    if (!fn) throw new ClipError(p.action === "claim" ? "Rewards arrive automatically; there's nothing to claim." : "That isn't needed here.", "staking/not-applicable");
    const build = await fn.call(provider, { positionId: p.positionId }, ctx);
    return queueSteps(this.host, build.steps, "Staking");
  }
}
