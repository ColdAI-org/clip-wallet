import type { Account } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { SUI_TESTNET, createSuiModule } from "../src/index.js";

/** Read-only checks against Sui testnet GraphQL: `LIVE=1 pnpm test`. No keys, nothing is signed or sent. */
const FUNDED = "0x921e2bd3432c784dce15b4073ba666d5067e6f8a41704eb63555235fec2e2e41"; // a busy public testnet account
const account: Account = { id: "sui:0", family: "sui", index: 0, curve: "ed25519", derivationPath: "", publicKey: "", address: FUNDED };
const ctx = { network: SUI_TESTNET, account, fetch: globalThis.fetch.bind(globalThis) };

describe.skipIf(!process.env.LIVE)("Sui testnet (live, read-only)", () => {
  const sui = createSuiModule();
  it("reads balances, collectibles and stakes", async () => {
    const b = await sui.getBalances(ctx);
    expect(b[0]!.asset.key).toBe("sui");
    expect(BigInt(b[0]!.amount)).toBeGreaterThan(0n);
    expect(Array.isArray(await sui.getNfts(ctx))).toBe(true);
    expect(Array.isArray(await sui.getStakes(ctx))).toBe(true);
  }, 30_000);

  it("builds a transfer and dry-runs it", async () => {
    const r = await sui.buildTransfer({ asset: SUI_TESTNET.nativeAsset, to: `0x${"22".repeat(32)}`, amount: "1000" }, ctx);
    const d = await sui.decode(r, ctx);
    expect(d.simulated).toBe(true);
    expect(d.title).toBe("Send 0.000001 SUI to 0x2222…2222");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "sui" }), delta: "-1000" }]);
    expect(BigInt(d.fee!.amount)).toBeGreaterThan(0n);
  }, 30_000);
});
