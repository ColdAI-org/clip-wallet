import type { DappRequest } from "@clip-wallet/core";
import { Binary, compact } from "@polkadot-api/substrate-bindings";
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAINFLIP,
  CHAINFLIP_PERSEVERANCE,
  Enum,
  SUBSTRATE_METHODS,
  SUBSTRATE_NETWORKS,
  clearRuntimeCache,
  createSubstrateModule,
  ethAddress,
  explorerTxUrl,
  foreignAddress,
  fromChainId,
  isChainflip,
  parsePayload,
  provideRuntime,
  signingBytes,
} from "../src/index.js";
import { CF_BLOCK_HASH, CF_FIX, CF_GENESIS, cf, cfAccount, cfCall, cfEnc, cfPayload, cfRuntime, redeemCall, REDEEM_TO } from "./chainflip-fixtures.js";
import { fixtureSigner, fromHex, hex, hex0x, mockRpc, ss58 } from "./helpers.js";

const ME = cf(CF_FIX.pub);
const OTHER = cf(CF_FIX.other);
const FEE = 17_783_696_000_000n; // TransactionPaymentApi.query_info partial_fee mainnet returned for a redeem (2026-10-06)

const BASE = {
  chain_getFinalizedHead: () => CF_BLOCK_HASH,
  chain_getHeader: () => ({ number: "0xbc614e" }),
  system_accountNextIndex: () => 7,
  state_getRuntimeVersion: () => ({ specName: "chainflip-node", specVersion: 20216, transactionVersion: 13 }),
};

function setup(storage: Record<string, string> = {}, methods: Record<string, (p: unknown[]) => unknown> = {}, fee: bigint | null = FEE) {
  clearRuntimeCache();
  provideRuntime(cfRuntime());
  const calls: Record<string, string> =
    fee === null ? {} : { TransactionPaymentApi_query_info: cfEnc.apiResult("TransactionPaymentApi", "query_info", { weight: { ref_time: 1000n, proof_size: 100n }, class: Enum("Normal"), partial_fee: fee }) };
  const rpc = mockRpc({ ...BASE, ...methods }, calls, storage);
  return { m: createSubstrateModule(), ctx: { network: CHAINFLIP, account: cfAccount(CF_FIX.pub), fetch: rpc.fetch }, log: rpc.log };
}

const req = (method: string, params: unknown, origin = "https://lp.chainflip.io"): DappRequest => ({
  id: "r1",
  origin,
  via: "injected",
  family: "substrate",
  networkId: CHAINFLIP.id,
  method,
  params,
});

const signPayload = (method: Uint8Array, over = {}) => req(SUBSTRATE_METHODS.signPayload, cfPayload(ME, method, over));
const lines = (d: { lines: { label: string; value: string }[] }) => Object.fromEntries(d.lines.map((l) => [l.label, l.value]));
const decodeCall = (bytes: Uint8Array) => cfRuntime().builder.buildDefinition(cfRuntime().callType).dec(bytes);

beforeEach(() => clearRuntimeCache());

describe("Chainflip networks", () => {
  it("has mainnet and Perseverance with the chain's own facts (genesis, ss58 2112, FLIP 18)", () => {
    expect(CHAINFLIP).toMatchObject({ id: "polkadot:8b8c140b0af9db70686583e3f6bf2a59", family: "substrate", testnet: false, explorerUrl: "https://scan.chainflip.io" });
    expect(CHAINFLIP.rpcUrls).toEqual(["https://mainnet-rpc.chainflip.io", "https://rpc.chainflip.io"]);
    expect(CHAINFLIP.nativeAsset).toEqual({ key: "flip", symbol: "FLIP", name: "Chainflip", decimals: 18, networkId: CHAINFLIP.id });
    expect(CHAINFLIP_PERSEVERANCE).toMatchObject({ id: "polkadot:7a5d4db858ada1d20ed6ded4933c3331", testnet: true, explorerUrl: "https://scan.perseverance.chainflip.io" });
    expect(CHAINFLIP_PERSEVERANCE.nativeAsset).toMatchObject({ key: "flip-testnet", symbol: "FLIP", decimals: 18 });
    expect(fromChainId(CF_GENESIS)).toBe(CHAINFLIP.id);
    expect(fromChainId("chainflip-perseverance")).toBe(CHAINFLIP_PERSEVERANCE.id);
    expect(explorerTxUrl(CHAINFLIP, "0x12")).toBe("https://scan.chainflip.io/extrinsics/0x12");
  });

  it("spells the account cF… (ss58 2112) and matches cF addresses to Chainflip networks only", () => {
    const m = createSubstrateModule();
    expect(ss58(CF_FIX.pub)).toBe("5EPCUjPxiHAcNooYipQFWr9NmmXJKpNG5RhcntXwbtUySrgH"); // vault account 0 (families.test.ts)
    expect(m.addressFromPublicKey(fromHex(CF_FIX.pub), CHAINFLIP)).toBe(ME);
    expect(ME.startsWith("cF")).toBe(true);
    expect(m.networksForAddress(ME, SUBSTRATE_NETWORKS).map((n) => n.name)).toEqual(["Chainflip", "Chainflip Perseverance"]);
  });

  it("reads the runtime as Chainflip: Flip + Funding, no Balances, its own signed extensions", () => {
    const rt = cfRuntime();
    expect(isChainflip(rt)).toBe(true);
    expect(rt.ss58).toBe(2112);
    expect(rt.extensions.map((e) => e.identifier)).toEqual([
      "AuthorizeCall",
      "CheckNonZeroSender",
      "CheckSpecVersion",
      "CheckTxVersion",
      "CheckGenesis",
      "CheckMortality",
      "CheckNonce",
      "CheckWeight",
      "ChargeTransactionPayment",
      "CheckMetadataHash",
      "WeightReclaim",
    ]);
    // AuthorizeCall and WeightReclaim are empty both ways: they must add no bytes.
    for (const id of ["AuthorizeCall", "WeightReclaim"]) {
      const e = rt.extensions.find((x) => x.identifier === id)!;
      expect([rt.lookup(e.type).type, rt.lookup(e.additionalSigned).type]).toEqual(["void", "void"]);
    }
  });
});

describe("Chainflip balances", () => {
  it("reads FLIP from Flip.Account (bond included) and splits fees vs redeemable vs redeeming", async () => {
    const { m, ctx } = setup({
      [cfEnc.storageKey("Flip", "Account", ME)]: cfEnc.storageValue("Flip", "Account", { balance: 7_500_000_000_000_000_000n, bond: 5_000_000_000_000_000_000n }),
      [cfEnc.storageKey("Funding", "PendingRedemptions", ME)]: cfEnc.storageValue("Funding", "PendingRedemptions", { total: 10n ** 18n, restricted: 0n, redeem_address: REDEEM_TO }),
    });
    expect(await m.getBalances(ctx)).toEqual([{ asset: CHAINFLIP.nativeAsset, amount: "7500000000000000000" }]);
    await expect(m.getFlipAccount(ctx)).resolves.toEqual({
      balance: 7_500_000_000_000_000_000n,
      bond: 5_000_000_000_000_000_000n,
      redeemable: 2_500_000_000_000_000_000n,
      pendingRedemption: { amount: 10n ** 18n, to: ethAddress(REDEEM_TO) },
    });
  });

  it("an account Chainflip has never seen holds 0 FLIP", async () => {
    const { m, ctx } = setup();
    expect(await m.getBalances(ctx)).toEqual([{ asset: CHAINFLIP.nativeAsset, amount: "0" }]);
  });
});

describe("Chainflip sends", () => {
  it("refuses a FLIP transfer in plain words: redeem to Ethereum or fund from Ethereum", async () => {
    const { m, ctx } = setup();
    const err = await m.buildTransfer({ asset: CHAINFLIP.nativeAsset, to: OTHER, amount: "1000" }, ctx).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "substrate/no-transfers" });
    expect((err as { userMessage: string }).userMessage).toBe(
      "FLIP can't be sent from one Chainflip account to another. To move it, redeem it to an Ethereum address, or fund the other account from Ethereum.",
    );
    expect((err as { msg?: { id: string } }).msg?.id).toBe("bg.chainflip.noTransfer");
  });
});

describe("Chainflip decode (LP portal / funding app calls)", () => {
  it("Funding.redeem: amount, checksummed Ethereum address, executor, a caution and the fee", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(signPayload(redeemCall()), ctx);
    const to = ethAddress(REDEEM_TO);
    expect(to).toBe("0xABaBaBaBABabABabAbAbABAbABabababaBaBABaB");
    expect(d.title).toBe("Redeem 5 FLIP to 0xABaB…ABaB on Ethereum");
    expect(d.blind).toBe(false);
    expect(lines(d)).toMatchObject({ Amount: "5 FLIP", "Goes to": `${to} (Ethereum)`, "Who can finish it": "Anyone", "Network fee": "0.000017783696 FLIP" });
    expect(d.balanceChanges).toEqual([{ asset: CHAINFLIP.nativeAsset, delta: "-5000000000000000000" }]);
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "network-matters" }));
    expect(d.fee).toEqual({ asset: CHAINFLIP.nativeAsset, amount: FEE.toString() });

    const max = await m.decode(signPayload(cfCall("Funding", "redeem", { amount: Enum("Max"), address: REDEEM_TO, executor: `0x${"cd".repeat(20)}` })), ctx);
    expect(max.title).toBe("Redeem all your FLIP to 0xABaB…ABaB on Ethereum");
    expect(lines(max)["Who can finish it"]).toBe(ethAddress(`0x${"cd".repeat(20)}`));
    expect(max.balanceChanges).toEqual([]);
  });

  it("bind_redeem_address / bind_executor_address are permanent: danger warnings", async () => {
    const { m, ctx } = setup();
    const bind = await m.decode(signPayload(cfCall("Funding", "bind_redeem_address", { address: REDEEM_TO })), ctx);
    expect(bind.title).toBe("Allow redemptions only to 0xABaB…ABaB, forever");
    expect(bind.warnings).toContainEqual(expect.objectContaining({ level: "danger", message: expect.stringMatching(/can never be undone/) }));
    const ex = await m.decode(signPayload(cfCall("Funding", "bind_executor_address", { executor_address: REDEEM_TO })), ctx);
    expect(ex.title).toBe("Let only 0xABaB…ABaB finish your redemptions, forever");
    expect(ex.warnings[0]).toMatchObject({ level: "danger", code: "new-recipient" });
  });

  it("LiquidityProvider withdraw / transfer and swap channels show each chain's own address format", async () => {
    const { m, ctx } = setup();
    const w = await m.decode(signPayload(cfCall("LiquidityProvider", "withdraw_asset", { amount: 1_500_000n, asset: Enum("SolUsdc"), destination_address: Enum("Sol", `0x${"01".repeat(32)}`) })), ctx);
    const sol = foreignAddress(Enum("Sol", `0x${"01".repeat(32)}`)).address;
    expect(sol).toBe("4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi");
    expect(w.title).toBe(`Withdraw 1.5 USDC (Solana) to ${sol.slice(0, 6)}…${sol.slice(-4)} on Solana`);
    expect(w.warnings).toContainEqual(expect.objectContaining({ code: "network-matters" }));

    const t = await m.decode(signPayload(cfCall("LiquidityProvider", "transfer_asset", { amount: 10n ** 8n, asset: Enum("Btc"), destination: OTHER })), ctx);
    expect(t.title).toBe(`Move 1 BTC (Bitcoin) to Chainflip account ${OTHER.slice(0, 6)}…${OTHER.slice(-4)}`);
    expect(t.warnings).toContainEqual(expect.objectContaining({ code: "new-recipient" }));

    const swap = await m.decode(
      signPayload(
        cfCall("Swapping", "request_swap_deposit_address", {
          source_asset: Enum("Eth"),
          destination_asset: Enum("Btc"),
          destination_address: Enum("Btc", Binary.fromText("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq")),
          broker_commission: 0,
          channel_metadata: undefined,
          boost_fee: 5,
          refund_parameters: { retry_duration: 100, refund_address: Enum("Eth", REDEEM_TO), min_price: [0n, 0n, 0n, 0n], refund_ccm_metadata: undefined, max_oracle_price_slippage: undefined },
        }),
      ),
      ctx,
    );
    expect(swap.title).toBe("Open a channel to swap ETH (Ethereum) for BTC (Bitcoin)");
    expect(lines(swap)).toMatchObject({ "Sends what you get to": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq (Bitcoin)", "Refunds go to": `${ethAddress(REDEEM_TO)} (Ethereum)`, "Boost fee": "5 bps" });
  });

  it("Boost, lending, LP registration and sub-account calls get plain words", async () => {
    const { m, ctx } = setup();
    const title = async (bytes: Uint8Array) => (await m.decode(signPayload(bytes), ctx)).title;
    expect(await title(cfCall("LendingPools", "add_boost_funds", { asset: Enum("Btc"), amount: 10_000_000n, pool_tier: 5 }))).toBe("Boost: add 0.1 BTC (Bitcoin) to the 5 bps pool");
    expect(await title(cfCall("LendingPools", "stop_boosting", { asset: Enum("Btc"), pool_tier: 5 }))).toBe("Stop boosting BTC (Bitcoin) in the 5 bps pool");
    expect(await title(cfCall("LendingPools", "add_lender_funds", { asset: Enum("Usdc"), amount: 250_000_000n }))).toBe("Lend 250 USDC (Ethereum)");
    expect(await title(cfCall("LendingPools", "remove_lender_funds", { asset: Enum("Usdc"), amount: undefined }))).toBe("Take back all the USDC (Ethereum) you lent");
    expect(await title(cfCall("LiquidityProvider", "register_lp_account", undefined))).toBe("Register as a Chainflip liquidity provider");
    expect(await title(cfCall("LiquidityProvider", "request_liquidity_deposit_address", { asset: Enum("ArbUsdc"), boost_fee: 0 }))).toBe("Get a deposit address for USDC (Arbitrum)");
    const inner = decodeCall(cfCall("LendingPools", "add_lender_funds", { asset: Enum("Usdt"), amount: 5_000_000n }));
    expect(await title(cfCall("AccountRoles", "as_sub_account", { sub_account_index: 2, call: inner }))).toBe("On sub-account #2: Lend 5 USDT (Ethereum)");
  });

  it("LP order calls stay as Pallet.call(args) with a caution about the 1 FLIP order escrow", async () => {
    const { m, ctx } = setup();
    const d = await m.decode(
      signPayload(cfCall("LiquidityPools", "set_limit_order", { base_asset: Enum("Eth"), quote_asset: Enum("Usdc"), side: Enum("Sell"), id: 1n, option_tick: 100, sell_amount: 10n ** 18n, dispatch_at: undefined, close_order_at: undefined })),
      ctx,
    );
    expect(d.title).toBe("LiquidityPools.set_limit_order for lp.chainflip.io");
    expect(d.lines[0]!.value).toMatch(/^LiquidityPools\.set_limit_order\(\{ base_asset: Eth, quote_asset: Usdc, side: Sell/);
    expect(d.warnings.map((w) => w.code)).toEqual(["blind-signing", "high-fee"]);
    expect(d.blind).toBe(false);
  });

  it("says nothing about the fee when TransactionPaymentApi can't answer", async () => {
    const { m, ctx } = setup({}, {}, null);
    const d = await m.decode(signPayload(redeemCall()), ctx);
    expect(d.fee).toBeUndefined();
    expect(d.lines.some((l) => l.label === "Network fee")).toBe(false);
  });

  it("refuses a payload for another network", async () => {
    const { m, ctx } = setup();
    await expect(m.decode(signPayload(redeemCall(), { genesisHash: "0x7a5d4db858ada1d20ed6ded4933c33313fc9673e5fffab560d0ca714782f2080" }), ctx)).rejects.toMatchObject({
      code: "substrate/network-mismatch",
    });
  });
});

describe("Chainflip signing", () => {
  it("signs call ‖ extra ‖ additionalSigned with Chainflip's extensions (empty AuthorizeCall / WeightReclaim add nothing)", async () => {
    const { m, ctx } = setup();
    const [p] = await m.prepare(signPayload(redeemCall()), ctx, "a1");
    // extra: era, nonce, tip, metadata mode | additional: spec, tx version, genesis, block (mortal), metadata hash None
    const expected = new Uint8Array([
      ...redeemCall(),
      ...fromHex("e500"),
      ...compact.enc(7),
      ...compact.enc(0),
      0,
      ...fromHex("f84e0000"),
      ...fromHex("0d000000"),
      ...fromHex(CF_GENESIS),
      ...fromHex(CF_BLOCK_HASH),
      0,
    ]);
    expect(hex(p!.bytes)).toBe(hex(expected));
    // CheckMetadataHash on: Some(RFC-0078 digest of this metadata with FLIP / 18).
    const digest = hex0x(cfRuntime().metadataHash(18, "FLIP"));
    const on = signingBytes(cfRuntime(), parsePayload(cfPayload(ME, redeemCall(), { mode: 1, metadataHash: digest })));
    expect(hex(on).endsWith(`01${digest.slice(2)}`)).toBe(true);
    const d = await m.decode(signPayload(redeemCall(), { mode: 1, metadataHash: digest }), ctx);
    expect(lines(d)["Metadata check"]).toBe("On (matches this network)");
  });

  it("returns the MultiSignature and signed extrinsic, submits wallet-built payloads, refuses bad signatures before sending", async () => {
    const { m, ctx, log } = setup({}, { author_submitExtrinsic: () => `0x${"ee".repeat(32)}` });
    const signer = fixtureSigner(CF_FIX.pub, [CF_FIX.redeemSig]);
    const r = req(SUBSTRATE_METHODS.signPayload, { ...cfPayload(ME, redeemCall()), withSignedTransaction: true });
    const [p] = await m.prepare(r, ctx, "a1");
    const out = (await m.finalize(r, [signer.sign(p!)], ctx)) as { signature: string; signedTransaction: string };
    expect(out.signature).toBe(`0x01${CF_FIX.redeemSig}`);
    const xt = fromHex(out.signedTransaction);
    const body = xt.subarray([1, 2, 4].find((n) => compact.enc(xt.length - n).length === n)!);
    expect(hex(body.subarray(0, 99))).toBe(`8400${CF_FIX.pub}01${CF_FIX.redeemSig}`);
    expect(hex(body).endsWith(`e500${hex(compact.enc(7))}0000${hex(redeemCall())}`)).toBe(true);

    const submit = req(SUBSTRATE_METHODS.signAndSubmit, { payload: cfPayload(ME, redeemCall()) }, "clip-wallet");
    const bad = { scheme: "sr25519" as const, bytes: new Uint8Array(64).fill(7), publicKey: CF_FIX.pub };
    await expect(m.finalize(submit, [bad], ctx)).rejects.toMatchObject({ code: "substrate/bad-signature" });
    expect(log.some((c) => c.method === "author_submitExtrinsic")).toBe(false);
    await expect(m.finalize(submit, [signer.sign(p!)], ctx)).resolves.toEqual({ txHash: `0x${"ee".repeat(32)}` });
    expect(log.filter((c) => c.method === "author_submitExtrinsic")).toHaveLength(1);
  });
});
