import type { Account } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { APTOS_DEVNET, APTOS_TESTNET, createAptosModule } from "../src/index.js";

/** Read-only checks against Aptos testnet: `LIVE=1 pnpm test`. No keys, nothing is signed or sent. */
const FUNDED = "0xc13bf4ca86e9c8774911978e9520a0475d06b2defce0ace7b8af190fded96a7f"; // a public testnet account
const FUNDED_PUB = "07b0ca3f094dc8e015ef17678678d903f17af23570e428cea6f70d778229c333";
const account: Account = { id: "aptos:0", family: "aptos", index: 0, curve: "ed25519", derivationPath: "", publicKey: FUNDED_PUB, address: FUNDED };
const ctx = { network: APTOS_TESTNET, account, fetch: globalThis.fetch.bind(globalThis) };

describe.skipIf(!process.env.LIVE)("Aptos testnet (live, read-only)", () => {
  const aptos = createAptosModule();
  it("reads balances and collectibles", async () => {
    const b = await aptos.getBalances(ctx);
    expect(b[0]!.asset.key).toBe("apt");
    expect(BigInt(b[0]!.amount)).toBeGreaterThan(0n);
    expect(Array.isArray(await aptos.getNfts(ctx))).toBe(true);
  }, 30_000);

  it("builds an APT transfer and simulates it", async () => {
    const r = await aptos.buildTransfer({ asset: APTOS_TESTNET.nativeAsset, to: `0x${"22".repeat(32)}`, amount: "1000" }, ctx);
    const d = await aptos.decode(r, ctx);
    expect(d.simulated).toBe(true);
    expect(d.warnings).toEqual([]);
    expect(d.title).toBe("Send 0.00001 APT to 0x2222…2222");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "apt" }), delta: "-1000" }]);
    expect(BigInt(d.fee!.amount)).toBeGreaterThan(0n);
  }, 30_000);

  it("reads devnet's chain id for signing", async () => {
    const dctx = { ...ctx, network: APTOS_DEVNET };
    const d = await aptos.decode(
      { id: "m1", origin: "https://app.example", via: "injected", family: "aptos", networkId: APTOS_DEVNET.id, method: "aptos:signMessage", params: { inputs: [{ account: FUNDED, message: "hi", nonce: "1", chainId: true }] } },
      dctx,
    );
    expect(d.title).toBe("Sign a message for app.example");
  }, 30_000);
});
