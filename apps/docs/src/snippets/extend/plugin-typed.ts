// The same plugin in TypeScript, typed with the schemas the wallet validates against. Compile it to one
// CommonJS-style script (module.exports.onTransaction = …) for dist/bundle.js.
import type { InsightInput, InsightOutput, NameInput, NameOutput } from "@clip-wallet/plugins";

const BURN = "0x000000000000000000000000000000000000dead";

export async function onTransaction({ request }: { request: InsightInput }): Promise<InsightOutput> {
  const text = [request.title, ...request.lines.map((l) => l.value)].join(" ").toLowerCase();
  if (!text.includes(BURN)) return { lines: [], warnings: [] };
  return {
    lines: [{ label: "Address", value: "Burn address" }], // at most 5 lines: label ≤ 40, value ≤ 200 characters
    warnings: [{ level: "danger", message: "Funds sent to the burn address are gone for good." }], // at most 3
  };
}

// With "nameResolution": { "suffixes": [".label"] } in the manifest:
export async function onNameLookup({ name }: NameInput): Promise<NameOutput> {
  if (name === "burn.label") return { address: BURN, family: "evm" };
  return null; // not ours: the wallet says it couldn't find the name
}
