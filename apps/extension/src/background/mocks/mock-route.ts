/**
 * MOCK route planner. The real one is @clip-wallet/route (findShortfall + RouteClient.quote); this mock
 * mirrors its plain-language output: where the money comes from, funding moves, sponsored gas, ETA.
 */
import type { ApprovalPlan, PlanStep } from "@clip-wallet/ui";
import type { RoutePlanner } from "../wiring";

const fmt = (amount: bigint, decimals: number) => {
  const s = (Number(amount) / 10 ** decimals).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return s;
};

export class MockRoutePlanner implements RoutePlanner {
  async plan({ request, decoded, balances }: Parameters<RoutePlanner["plan"]>[0]): Promise<ApprovalPlan> {
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
    const action = request.origin === "wallet" ? decoded.title : decoded.title.replace(/^Pay /, "Pay ");
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
