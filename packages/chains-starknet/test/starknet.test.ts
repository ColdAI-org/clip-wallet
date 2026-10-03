import { ClipError } from "@clip-wallet/core";
import { ec, hash } from "starknet";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ARGENT_ACCOUNT_CLASS_HASH,
  ETH_ADDRESS,
  accountAddress,
  OZ_ACCOUNT_CLASS_HASH,
  STARKNET_MAINNET,
  STARKNET_NETWORKS,
  STARKNET_SEPOLIA,
  STRK_ADDRESS,
  chainOf,
  clearTokenCache,
  createStarknetModule,
  decodeStringResult,
  fromChainId,
  normalizeCalls,
  starkKeyX,
  tokenAssetKey,
  walletChainId,
} from "../src/index.js";
import { fromHex } from "../src/util.js";
import { BOB, TYPED_DATA, USDC, ctxFor, fixtureSigner, makeAccount, mockStarknet, req, transferCall } from "./helpers.js";
import { FIX } from "./signatures.js";

const PUB = FIX.publicKey;
const ME = FIX.address;
const signer = fixtureSigner(PUB, FIX.sigs);
const strk = BigInt(STRK_ADDRESS).toString();
const usdc = BigInt(USDC).toString();
const m = () => createStarknetModule({ deployWaitMs: 0, pollMs: 0 });

beforeEach(() => clearTokenCache());

describe("networks", () => {
  it("maps CAIP-2, short-string and felt chain ids", () => {
    expect(STARKNET_SEPOLIA.id).toBe("starknet:SN_SEPOLIA");
    expect(STARKNET_MAINNET.id).toBe("starknet:SN_MAIN");
    expect(walletChainId(STARKNET_SEPOLIA.id)).toBe("0x534e5f5345504f4c4941");
    expect(walletChainId(STARKNET_MAINNET.id)).toBe("0x534e5f4d41494e");
    expect(fromChainId("0x534E5F5345504F4C4941")).toBe("starknet:SN_SEPOLIA");
    expect(chainOf("SN_MAIN")).toBe("SN_MAIN");
    expect(chainOf("eip155:1")).toBeNull();
    expect(STARKNET_NETWORKS.filter((n) => n.testnet)).toEqual([STARKNET_SEPOLIA]);
    expect(STARKNET_SEPOLIA.nativeAsset).toMatchObject({ key: "strk", symbol: "STRK", decimals: 18 });
  });

  it("keys Circle USDC as usdc, StarkGate USDC.e as bridged, unknown tokens by contract", () => {
    expect(tokenAssetKey(STARKNET_SEPOLIA.id, USDC)).toBe("usdc");
    expect(tokenAssetKey(STARKNET_MAINNET.id, "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8")).toBe("usdc.e");
    expect(tokenAssetKey(STARKNET_SEPOLIA.id, "0x1234")).toBe(`starknet:0x${"1234".padStart(64, "0")}`);
  });

  it("reads felt and ByteArray strings", () => {
    expect(decodeStringResult(["0x55534443"])).toBe("USDC");
    expect(decodeStringResult(["0x0", "0x5354524b", "0x4"])).toBe("STRK");
    expect(decodeStringResult(["0x2", "0x1"])).toBeNull();
  });
});

describe("account", () => {
  it("derives the OpenZeppelin counterfactual address from the Stark key, in any key encoding", () => {
    const x = fromHex(PUB);
    const point = ec.starkCurve.ProjectivePoint.fromHex(`02${PUB}`);
    const compressed = point.toRawBytes(true);
    const uncompressed = point.toRawBytes(false);
    const mod = m();
    expect(mod.addressFromPublicKey(x, STARKNET_SEPOLIA)).toBe(ME);
    expect(mod.addressFromPublicKey(compressed, STARKNET_SEPOLIA)).toBe(ME);
    expect(mod.addressFromPublicKey(uncompressed, STARKNET_MAINNET)).toBe(ME);
    expect(starkKeyX(compressed)).toBe(BigInt(`0x${PUB}`));
    expect(ME).toBe(`0x${BigInt(hash.calculateContractAddressFromHash(`0x${PUB}`, OZ_ACCOUNT_CLASS_HASH, [`0x${PUB}`], 0)).toString(16).padStart(64, "0")}`);
    expect(() => mod.addressFromPublicKey(new Uint8Array(20), STARKNET_SEPOLIA)).toThrow();
  });

  it("validates addresses and finds every Starknet network for one", () => {
    const mod = m();
    expect(mod.isAddress(ME)).toBe(true);
    expect(mod.isAddress("0x0")).toBe(false);
    expect(mod.isAddress(`0x${"f".repeat(64)}`)).toBe(false); // above 2**251
    expect(mod.isAddress("0x123g")).toBe(false);
    expect(mod.networksForAddress(ME, [...STARKNET_NETWORKS, { ...STARKNET_SEPOLIA, id: "eip155:1", family: "evm" }])).toEqual(STARKNET_NETWORKS);
    expect(mod.derivationPath(3)).toBe("m/44'/9004'/0'/0/3");
  });

  it("reports an inactive account plainly and offers wallet_deploymentData", async () => {
    const mod = m();
    const { fetch } = mockStarknet({ deployed: false, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    expect(await mod.accountStatus(ctx)).toBe("not-deployed");
    expect(await mod.deploymentDataFor(ctx)).toEqual({ address: ME, class_hash: OZ_ACCOUNT_CLASS_HASH, salt: `0x${BigInt(`0x${PUB}`).toString(16)}`, calldata: [`0x${BigInt(`0x${PUB}`).toString(16)}`], version: 1 });
    const deployed = ctxFor(makeAccount(PUB, ME), mockStarknet({ deployed: true, nonce: 1n, balances: {} }).fetch);
    expect(await mod.accountStatus(deployed)).toBe("active");
    expect(await mod.deploymentDataFor(deployed)).toBeNull();
  });

  it("refuses an account whose stored address belongs to another account class", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, "0x0123"), fetch);
    await expect(m().getBalances(ctx)).rejects.toMatchObject({ code: "starknet/account-mismatch" });
  });
});

describe("Argent accounts", () => {
  it("computes Argent X 0.4.0 addresses and deploys with [0, key, 1]", async () => {
    const mod = createStarknetModule({ account: "argent", deployWaitMs: 0, pollMs: 0 });
    expect(mod.addressFromPublicKey(fromHex(PUB), STARKNET_SEPOLIA)).toBe(FIX.argentAddress);
    expect(accountAddress(fromHex(PUB), { kind: "argent", classHash: ARGENT_ACCOUNT_CLASS_HASH })).toBe(FIX.argentAddress);
    const mock = mockStarknet({ deployed: false, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, FIX.argentAddress), mock.fetch);
    const r = req("wallet_addInvokeTransaction", { calls: [transferCall(USDC, BOB, 2_500_000n)] }, "first");
    const payloads = await mod.prepare(r, ctx, "ap");
    await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    const deploy = mock.calls.find((c) => c.method === "starknet_addDeployAccountTransaction")!.params[0] as { constructor_calldata: string[]; class_hash: string };
    expect(deploy.class_hash).toBe(ARGENT_ACCOUNT_CLASS_HASH);
    expect(deploy.constructor_calldata).toEqual(["0x0", `0x${BigInt(`0x${PUB}`).toString(16)}`, "0x1"]);
    // the OpenZeppelin module refuses an Argent account address
    await expect(m().getBalances(ctx)).rejects.toMatchObject({ code: "starknet/account-mismatch" });
  });
});

describe("balances", () => {
  it("reads STRK always and other curated tokens when held", async () => {
    const { fetch } = mockStarknet({ deployed: false, nonce: 0n, balances: { [strk]: 5n * 10n ** 18n, [usdc]: 1_000_000n } });
    const b = await m().getBalances(ctxFor(makeAccount(PUB, ME), fetch));
    expect(b.map((x) => [x.asset.key, x.amount])).toEqual([
      ["strk", "5000000000000000000"],
      ["usdc", "1000000"],
    ]);
    expect(b[1]!.asset.address).toBe(USDC);
    expect(await m().getNfts(ctxFor(makeAccount(PUB, ME), fetch))).toEqual([]);
  });

  it("uses a plugged-in NFT indexer", async () => {
    const mod = createStarknetModule({
      nfts: async (owner, net) => [{ networkId: net.id, standard: "erc721", collection: { address: "0x1", name: "C" }, tokenId: owner }],
    });
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    expect((await mod.getNfts(ctxFor(makeAccount(PUB, ME), fetch)))[0]!.tokenId).toBe(ME);
  });
});

describe("decode", () => {
  const invoke = (calls: unknown[], id = "r1") => req("wallet_addInvokeTransaction", { calls }, id);

  it("describes an ERC-20 transfer, simulates it and shows the STRK fee", async () => {
    const mock = mockStarknet({ deployed: true, nonce: 7n, balances: { [strk]: 10n ** 18n }, events: [{ token: USDC, from: ME, to: BOB, amount: 2_500_000n }] });
    const d = await m().decode(invoke([transferCall(USDC, BOB, 2_500_000n)]), ctxFor(makeAccount(PUB, ME), mock.fetch));
    expect(d.title).toBe("Send 2.5 USDC to 0x0000…b0b0");
    expect(d.blind).toBe(false);
    expect(d.simulated).toBe(true);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc" }), delta: "-2500000" }]);
    expect(d.fee).toEqual({ asset: expect.objectContaining({ key: "strk" }), amount: BigInt("0xae67852d653556").toString() });
    expect(d.lines).toContainEqual({ label: "Network fee", value: "0.04909046763757295 STRK" });
    expect(d.warnings).toEqual([]);
    const sim = mock.calls.find((c) => c.method === "starknet_simulateTransactions")!;
    expect(sim.params[2]).toEqual(["SKIP_VALIDATE", "SKIP_FEE_CHARGE"]);
    expect((sim.params[1] as { version: string }[]).every((t) => t.version === "0x100000000000000000000000000000003")).toBe(true);
  });

  it("says plainly when the account isn't active and simulates its activation first", async () => {
    const mock = mockStarknet({ deployed: false, nonce: 0n, balances: {} });
    const d = await m().decode(invoke([transferCall(USDC, BOB, 1n)]), ctxFor(makeAccount(PUB, ME), mock.fetch));
    expect(d.lines).toContainEqual({ label: "Account", value: "Not active yet. This first transaction also activates it (one-time fee)." });
    const sim = mock.calls.find((c) => c.method === "starknet_simulateTransactions")!;
    expect((sim.params[1] as { type: string }[]).map((t) => t.type)).toEqual(["DEPLOY_ACCOUNT", "INVOKE"]);
    expect(d.warnings).toContainEqual(expect.objectContaining({ code: "high-fee", message: "You don't have enough STRK to pay the network fee." }));
  });

  it("flags unlimited approvals as danger and limited ones as caution", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 10n ** 18n } });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const max = `0x${"f".repeat(32)}`;
    const d = await m().decode(invoke([{ contract_address: USDC, entry_point: "approve", calldata: [BOB, max, max] }]), ctx);
    expect(d.title).toBe("Allow app.example to spend all your USDC");
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "unlimited-approval" }));
    const d2 = await m().decode(invoke([{ contract_address: USDC, entry_point: "approve", calldata: [BOB, "0xf4240", "0x0"] }]), ctx);
    expect(d2.title).toBe("Allow app.example to spend 1 USDC");
    expect(d2.warnings).toContainEqual(expect.objectContaining({ level: "caution", code: "unlimited-approval" }));
  });

  it("lists every call of a multicall and keeps unknown entry points readable", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 10n ** 18n } });
    const d = await m().decode(
      invoke([
        { contract_address: ETH_ADDRESS, entry_point: "approve", calldata: [BOB, "0x1", "0x0"] },
        { contract_address: BOB, entry_point: "swap_exact_tokens_for_tokens", calldata: ["0x1", "0x2"] },
      ]),
      ctxFor(makeAccount(PUB, ME), fetch),
    );
    expect(d.title).toBe("Approve 2 actions for app.example");
    expect(d.lines[0]).toEqual({ label: "Action 1", value: "Allow app.example to spend 0.000000000000000001 ETH" });
    expect(d.lines[1]).toEqual({ label: "Action 2", value: "Swap exact tokens for tokens on app.example" });
    expect(d.lines).toContainEqual({ label: "Swap exact tokens for tokens", value: "0x0000…b0b0 (2 values)" });
    expect(d.blind).toBe(false);
  });

  it("treats calls into your own account (upgrade, key change) as blind danger", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 10n ** 18n } });
    const d = await m().decode(invoke([{ contract_address: ME, entry_point: "set_public_key", calldata: ["0x1", "0x0"] }]), ctxFor(makeAccount(PUB, ME), fetch));
    expect(d.blind).toBe(true);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
  });

  it("turns a simulated revert into a plain warning", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 10n ** 18n }, revert: "0x753235365f737562204f766572666c6f77 ('u256_sub Overflow')" });
    const d = await m().decode(invoke([transferCall(USDC, BOB, 1n)]), ctxFor(makeAccount(PUB, ME), fetch));
    expect(d.simulated).toBe(false);
    expect(d.warnings).toContainEqual({ level: "danger", code: "simulation-failed", message: "This would fail: you don't have enough of a token it needs." });
  });

  it("refuses unreadable calls, declare and unknown methods", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    await expect(m().decode(invoke([]), ctx)).rejects.toMatchObject({ code: "starknet/bad-params" });
    await expect(m().decode(invoke([{ contract_address: USDC, entry_point: "transfer(x)", calldata: [] }]), ctx)).rejects.toMatchObject({ code: "starknet/bad-params" });
    await expect(m().decode(invoke([{ contract_address: USDC, entry_point: "transfer", calldata: [`0x${"f".repeat(64)}`] }]), ctx)).rejects.toMatchObject({ code: "starknet/bad-params" });
    await expect(m().decode(req("wallet_addDeclareTransaction", {}), ctx)).rejects.toMatchObject({ code: "starknet/unsupported-method" });
    await expect(m().decode(req("wallet_foo", {}), ctx)).rejects.toBeInstanceOf(ClipError);
  });

  it("accepts WalletConnect's shape but only for this account", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 10n ** 18n } });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const calls = [{ contractAddress: USDC, entrypoint: "transfer", calldata: [BOB, "0x1", "0x0"] }];
    expect(normalizeCalls({ executionRequest: { calls } })[0]!.entrypoint).toBe("transfer");
    const d = await m().decode(req("starknet_requestAddInvokeTransaction", { accountAddress: ME, executionRequest: { calls } }), ctx);
    expect(d.title).toBe("Send 0.000001 USDC to 0x0000…b0b0");
    await expect(m().decode(req("starknet_requestAddInvokeTransaction", { accountAddress: BOB, executionRequest: { calls } }), ctx)).rejects.toMatchObject({
      code: "starknet/wrong-account",
    });
  });
});

describe("typed data (SNIP-12)", () => {
  it("shows the message, signs its hash and returns [r, s]", async () => {
    const mod = m();
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const r = req("wallet_signTypedData", TYPED_DATA, "td-1");
    const d = await mod.decode(r, ctx);
    expect(d.title).toBe("Sign a message for app.example");
    expect(d.lines).toContainEqual({ label: "App", value: "Example App" });
    expect(d.lines).toContainEqual({ label: "Contents", value: "hello" });
    const payloads = await mod.prepare(r, ctx, "ap-1");
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ scheme: "stark-ecdsa", approvalId: "ap-1", accountId: "starknet:0" });
    const out = (await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx)) as string[];
    expect(out).toHaveLength(2);
    expect(out.every((x) => /^0x[0-9a-f]+$/.test(x))).toBe(true);
  });

  it("refuses typed data for another Starknet network", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const td = { ...TYPED_DATA, domain: { ...TYPED_DATA.domain, chainId: "SN_MAIN" } };
    await expect(m().decode(req("wallet_signTypedData", td), ctxFor(makeAccount(PUB, ME), fetch))).rejects.toMatchObject({ code: "starknet/network-mismatch" });
  });

  it("marks SNIP-9 outside-execution signatures as blind danger", async () => {
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const td = {
      types: {
        StarknetDomain: TYPED_DATA.types.StarknetDomain,
        OutsideExecution: [
          { name: "Caller", type: "ContractAddress" },
          { name: "Nonce", type: "felt" },
          { name: "Execute After", type: "u128" },
          { name: "Execute Before", type: "u128" },
          { name: "Calls", type: "Call*" },
        ],
        Call: [
          { name: "To", type: "ContractAddress" },
          { name: "Selector", type: "selector" },
          { name: "Calldata", type: "felt*" },
        ],
      },
      primaryType: "OutsideExecution",
      domain: { name: "Account.execute_from_outside", version: "2", chainId: "SN_SEPOLIA", revision: "1" },
      message: { Caller: "0x414e595f43414c4c4552", Nonce: "0x1", "Execute After": "0x0", "Execute Before": "0x6a000000", Calls: [{ To: USDC, Selector: "transfer", Calldata: [BOB, "0x1", "0x0"] }] },
    };
    const d = await m().decode(req("wallet_signTypedData", td), ctxFor(makeAccount(PUB, ME), fetch));
    expect(d.blind).toBe(true);
    expect(d.title).toBe("Let app.example act for your account");
    expect(d.lines).toContainEqual({ label: "Who can run it", value: "Anyone" });
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
  });

  it("answers WalletConnect with { signature }", async () => {
    const mod = m();
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const r = req("starknet_signTypedData", { accountAddress: ME, typedData: TYPED_DATA }, "td-wc");
    const p = await mod.prepare(r, ctx, "a");
    const out = (await mod.finalize(r, p.map((x) => signer.sign(x)), ctx)) as { signature: string[] };
    expect(out.signature).toHaveLength(2);
  });
});

describe("prepare / finalize", () => {
  it("first use: signs DEPLOY_ACCOUNT then INVOKE (nonce 1), sends both in order", async () => {
    const mod = m();
    const mock = mockStarknet({ deployed: false, nonce: 0n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), mock.fetch);
    const r = req("wallet_addInvokeTransaction", { calls: [transferCall(USDC, BOB, 2_500_000n)] }, "first");
    const payloads = await mod.prepare(r, ctx, "ap");
    expect(payloads).toHaveLength(2);
    expect(payloads.every((p) => p.scheme === "stark-ecdsa" && p.bytes.length === 32)).toBe(true);
    const est = mock.calls.find((c) => c.method === "starknet_estimateFee")!;
    expect((est.params[0] as { type: string }[]).map((t) => t.type)).toEqual(["DEPLOY_ACCOUNT", "INVOKE"]);
    const out = await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    expect(out).toEqual({ transaction_hash: `0x${"1abc".padStart(64, "0")}` });
    const sent = mock.calls.filter((c) => c.method.startsWith("starknet_add"));
    expect(sent.map((c) => c.method)).toEqual(["starknet_addDeployAccountTransaction", "starknet_addInvokeTransaction"]);
    const deploy = sent[0]!.params[0] as Record<string, unknown>;
    expect(deploy).toMatchObject({ type: "DEPLOY_ACCOUNT", version: "0x3", nonce: "0x0", class_hash: OZ_ACCOUNT_CLASS_HASH, tip: "0x0" });
    expect((deploy.signature as string[]).length).toBe(2);
    const inv = sent[1]!.params[0] as Record<string, unknown>;
    expect(inv).toMatchObject({ type: "INVOKE", version: "0x3", nonce: "0x1", sender_address: ME });
    // resource bounds = estimate + 50%
    expect((inv.resource_bounds as { l2_gas: { max_amount: string } }).l2_gas.max_amount).toBe(`0x${((0x24641en * 150n) / 100n + 1n).toString(16)}`);
    // execute calldata: [n_calls, to, selector, len, ...calldata]
    expect((inv.calldata as string[]).slice(0, 4)).toEqual(["0x1", BigInt(USDC).toString(16).replace(/^/, "0x"), hash.getSelectorFromName("transfer"), "0x3"]);
  });

  it("deployed account: one INVOKE at the current nonce", async () => {
    const mod = m();
    const mock = mockStarknet({ deployed: true, nonce: 7n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), mock.fetch);
    const r = req("wallet_addInvokeTransaction", { calls: [transferCall(STRK_ADDRESS, BOB, 10n ** 18n)] }, "second");
    const payloads = await mod.prepare(r, ctx, "ap");
    expect(payloads).toHaveLength(1);
    await mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx);
    const inv = mock.calls.find((c) => c.method === "starknet_addInvokeTransaction")!.params[0] as { nonce: string };
    expect(inv.nonce).toBe("0x7");
  });

  it("refuses wrong, missing or unprepared signatures and sends nothing", async () => {
    const mod = m();
    const mock = mockStarknet({ deployed: true, nonce: 7n, balances: {} });
    const ctx = ctxFor(makeAccount(PUB, ME), mock.fetch);
    const r = req("wallet_addInvokeTransaction", { calls: [transferCall(STRK_ADDRESS, BOB, 10n ** 18n)] }, "third");
    await expect(mod.finalize(r, [], ctx)).rejects.toMatchObject({ code: "starknet/not-prepared" });
    const payloads = await mod.prepare(r, ctx, "ap");
    const good = signer.sign(payloads[0]!);
    const bad = { ...good, bytes: good.bytes.slice().fill(1, 40, 41) };
    await expect(mod.finalize(r, [bad], ctx)).rejects.toMatchObject({ code: "starknet/bad-signature" });
    await expect(mod.finalize(r, [], ctx)).rejects.toMatchObject({ code: "starknet/bad-signature" });
    await expect(mod.finalize(r, [{ ...good, scheme: "ed25519" }], ctx)).rejects.toMatchObject({ code: "starknet/bad-signature" });
    expect(mock.calls.some((c) => c.method === "starknet_addInvokeTransaction")).toBe(false);
  });

  it("explains a failed broadcast in plain words", async () => {
    const mod = m();
    const mock = mockStarknet({ deployed: true, nonce: 7n, balances: {} }, {
      starknet_addInvokeTransaction: () => {
        throw { code: 55, message: "Account validation failed", data: "Resources bounds exceed balance" };
      },
    });
    const ctx = ctxFor(makeAccount(PUB, ME), mock.fetch);
    const r = req("wallet_addInvokeTransaction", { calls: [transferCall(STRK_ADDRESS, BOB, 10n ** 18n)] }, "fourth");
    const payloads = await mod.prepare(r, ctx, "ap");
    await expect(mod.finalize(r, payloads.map((p) => signer.sign(p)), ctx)).rejects.toMatchObject({
      code: "starknet/send-failed",
      userMessage: "You don't have enough STRK to pay the network fee.",
    });
  });
});

describe("buildTransfer", () => {
  it("builds an ERC-20 transfer request (STRK when the asset has no address)", async () => {
    const mod = m();
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 2n * 10n ** 18n } });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const r = await mod.buildTransfer({ asset: STARKNET_SEPOLIA.nativeAsset, to: BOB, amount: "1000000000000000000" }, ctx);
    expect(r).toMatchObject({ family: "starknet", networkId: "starknet:SN_SEPOLIA", method: "wallet_addInvokeTransaction", origin: "clip-wallet" });
    expect((r.params as { calls: unknown[] }).calls).toEqual([
      { contract_address: STRK_ADDRESS, entry_point: "transfer", calldata: [BOB, "0xde0b6b3a7640000", "0x0"] },
    ]);
  });

  it("refuses bad recipients and amounts in plain words", async () => {
    const mod = m();
    const { fetch } = mockStarknet({ deployed: true, nonce: 0n, balances: { [strk]: 1n } });
    const ctx = ctxFor(makeAccount(PUB, ME), fetch);
    const a = STARKNET_SEPOLIA.nativeAsset;
    await expect(mod.buildTransfer({ asset: a, to: "0xzz", amount: "1" }, ctx)).rejects.toMatchObject({ code: "starknet/bad-address" });
    await expect(mod.buildTransfer({ asset: a, to: ME, amount: "1" }, ctx)).rejects.toMatchObject({ code: "starknet/self-transfer" });
    await expect(mod.buildTransfer({ asset: a, to: USDC, amount: "1" }, ctx)).rejects.toMatchObject({ code: "starknet/token-recipient" });
    await expect(mod.buildTransfer({ asset: a, to: BOB, amount: "0" }, ctx)).rejects.toMatchObject({ code: "starknet/bad-amount" });
    await expect(mod.buildTransfer({ asset: a, to: BOB, amount: "2" }, ctx)).rejects.toMatchObject({ code: "starknet/insufficient-token", userMessage: "You don't have enough STRK." });
  });
});
