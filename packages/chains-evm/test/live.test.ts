/**
 * Optional live smoke test on Sepolia, read-only. Runs only with LIVE=1:
 *   LIVE=1 pnpm --filter @clip-wallet/chains-evm test
 */
import { describe, expect, it } from "vitest";
import { createEvmModule } from "../src/module.js";
import { networkById } from "../src/networks.js";
import { quoteFees } from "../src/chain.js";
import { BOB, SEPOLIA, TEST_ACCOUNT } from "./helpers.js";

const live = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LIVE === "1";

describe.skipIf(!live)("live Sepolia (read-only)", () => {
  const network = networkById(SEPOLIA)!;
  const ctx = { network, account: TEST_ACCOUNT, fetch: globalThis.fetch.bind(globalThis) };
  const mod = createEvmModule();

  it("reads balances", async () => {
    const b = await mod.getBalances(ctx);
    expect(b[0]!.asset.key).toBe("eth-testnet");
    expect(BigInt(b[0]!.amount)).toBeGreaterThanOrEqual(0n);
  }, 30_000);

  it("quotes EIP-1559 fees", async () => {
    const f = await quoteFees(ctx);
    expect(f.type).toBe("eip1559");
    expect(f.maxFeePerGas! >= f.maxPriorityFeePerGas!).toBe(true);
  }, 30_000);

  it("decodes a native send with a fee", async () => {
    const req = await mod.buildTransfer({ asset: network.nativeAsset, to: BOB, amount: "1" }, ctx);
    const d = await mod.decode(req, ctx);
    expect(d.title).toMatch(/^Send .* ETH to 0x1234…5678$/);
  }, 30_000);
});
