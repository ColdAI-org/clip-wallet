import { isWalletOrigin } from "@clip-wallet/core";
/**
 * MOCK route planner. The real one is @clip-wallet/route (findShortfall + RouteClient.quote); this mock
 * mirrors its plain-language output: where the money comes from, funding moves, sponsored gas, ETA.
 */
import type { ApprovalPlan, PlanStep } from "@clip-wallet/ui";
import { findShortfall, type SettleFunding } from "@clip-wallet/route";
import type { RoutePlanner } from "../wiring";
import { settleFixture } from "./mock-settle";

const fmt = (amount: bigint, decimals: number) => {
  const s = (Number(amount) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return s;
};

export class MockRoutePlanner implements RoutePlanner {
  /** The real settle funding over the mock Connector (mock-settle.ts), used while the simulator arms it. */
  constructor(private readonly settle: SettleFunding | null = null) {}

  async plan({ request, decoded, balances, networks, account }: Parameters<RoutePlanner["plan"]>[0]): Promise<ApprovalPlan> {
    const funded = this.settle && settleFixture.mode !== "off" ? await this.settle.plan(findShortfall(decoded, balances), account, networks) : null;
    if (funded) {
      return {
        source: "Your balance",
        feeFiat: decoded.fee?.fiatValue,
        sponsored: !!decoded.fee?.sponsored,
        readyInSeconds: funded.info.etaSeconds,
        steps: [
          { kind: "funding", title: funded.step.title, detail: funded.step.detail },
          ...(decoded.fee ? [{ kind: "gas" as const, title: decoded.fee.sponsored ? "Network fee paid for you" : "Network fee" }] : []),
          { kind: "action", title: decoded.title, balanceChanges: decoded.balanceChanges },
        ],
        settlement: "If the money doesn't arrive in time, you're paid back from the Connector's bond on Hedera.",
        funding: funded.info,
      };
    }
    const steps: PlanStep[] = [];
    let readyInSeconds = 4;
    for (const change of decoded.balanceChanges) {
      if (!change.delta.startsWith("-")) continue;
      const need = BigInt(change.delta.slice(1));
      const here = balances
        .filter((b) => b.asset.key === change.asset.key && b.asset.networkId === decoded.networkId && !b.asset.bridged)
        .reduce((t, b) => t + BigInt(b.amount), 0n);
      if (here < need) {
        const short = need - here;
        steps.push({
          kind: "funding",
          title: `Move ${fmt(short, change.asset.decimals)} ${change.asset.symbol} from your other balance`,
          detail: `Your ${change.asset.symbol} is spread out; this gathers it where it's needed.`,
        });
        readyInSeconds = 10;
      }
    }
    const sponsored = !!decoded.fee?.sponsored;
    if (decoded.fee) {
      steps.push({
        kind: "gas",
        title: sponsored ? "Network fee paid for you" : "Network fee",
        detail: sponsored ? "Covered so you don't need to hold anything extra." : undefined,
      });
    }
    const action = isWalletOrigin(request.origin) ? decoded.title : decoded.title.replace(/^Pay /, "Pay ");
    steps.push({ kind: "action", title: action, balanceChanges: decoded.balanceChanges });
    return {
      source: "Your balance",
      feeFiat: decoded.fee?.fiatValue,
      sponsored,
      readyInSeconds,
      steps,
      settlement:
        steps.length > 1
          ? "Settles in one go. If any step fails, nothing leaves your balance."
          : "If it fails, nothing leaves your balance.",
    };
  }
}
