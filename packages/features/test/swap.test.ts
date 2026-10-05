import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { AccountAllowanceApproveTransaction, ContractExecuteTransaction, TokenAssociateTransaction, Transaction } from "@hiero-ledger/sdk";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { JUPITER_V6_PROGRAM, TOKEN_PROGRAM } from "../src/solana-verify.js";
import { refineDecoded } from "../src/steps.js";
import { JupiterSwap } from "../src/swap/jupiter.js";
import { ROUTER_ABI, SaucerSwap, encodePath } from "../src/swap/saucerswap.js";
import { SwapService } from "../src/swap/service.js";
import { ALLOWANCE_HOLDER_CANCUN, ZeroExSwap } from "../src/swap/zerox.js";
import type { RouteQuoter } from "../src/swap/cross.js";
import { BASE_MAINNET, DEVNET, ME_EVM, ME_HEDERA, ME_SOL, SEPOLIA, SOL_MAIN, accountFor, ethOn, fakeHost, flush, hbar, mirrorAccount, mockFetch, sauce, sol, usdcEvm, usdcHedera, usdcSol } from "./helpers.js";

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

/** A transaction calling the given programs (no signatures; tests only parse it). */
function txCalling(programs: string[]): string {
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(ME_SOL), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as never, lastValidBlockHeight: 10n }, m),
    (m) => appendTransactionMessageInstructions(programs.map((p) => ({ programAddress: address(p), accounts: [], data: new Uint8Array([1]) })), m),
  );
  return b64(new Uint8Array(getTransactionEncoder().encode(compileTransaction(msg))));
}

/* ------------------------------------------------------------------ Jupiter */

const ORDER = (transaction: string | null) => ({
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inAmount: "1000000000",
  outAmount: "180250000",
  otherAmountThreshold: "179348750",
  slippageBps: 50,
  priceImpactPct: "0.0012",
  routePlan: [{ swapInfo: { label: "Orca" }, percent: 60 }, { swapInfo: { label: "Raydium" }, percent: 40 }],
  router: "metis",
  transaction,
  requestId: "req-123",
  errorMessage: transaction ? undefined : "Insufficient funds",
});

describe("Jupiter (Swap API V2 /order + /execute)", () => {
  const ctx = (f: typeof fetch) => ({ network: SOL_MAIN, account: accountFor(SOL_MAIN), fetch: f });

  it("is mainnet only, in plain words", () => {
    expect(new JupiterSwap().availability(DEVNET)?.message).toBe("Swapping these tokens isn't available in this test version yet.");
    expect(new JupiterSwap().availability(SOL_MAIN)).toBeNull();
  });

  it("quotes with taker + slippage, reads route labels and price impact", async () => {
    const tx = txCalling([JUPITER_V6_PROGRAM, TOKEN_PROGRAM]);
    const { fetch, calls } = mockFetch([[/api\.jup\.ag\/swap\/v2\/order/, ORDER(tx)]]);
    const q = await new JupiterSwap().quote({ sell: sol(SOL_MAIN.id), buy: usdcSol(SOL_MAIN.id), amount: "1000000000", slippageBps: 50 }, ctx(fetch));
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get("inputMint")).toBe("So11111111111111111111111111111111111111112");
    expect(u.searchParams.get("taker")).toBe(ME_SOL);
    expect(u.searchParams.get("slippageBps")).toBe("50");
    expect(q).toMatchObject({ buyAmount: "180250000", minBuyAmount: "179348750", route: ["Orca", "Raydium"] });
    expect(q.priceImpactPct).toBeCloseTo(0.12);
  });

  it("plain error when Jupiter can't build the order", async () => {
    const { fetch } = mockFetch([[/order/, ORDER(null)]]);
    await expect(new JupiterSwap().quote({ sell: sol(SOL_MAIN.id), buy: usdcSol(SOL_MAIN.id), amount: "1", slippageBps: 50 }, ctx(fetch))).rejects.toMatchObject({ code: "swap/insufficient" });
  });

  it("signs only, then lands the signed transaction through /execute", async () => {
    const tx = txCalling([JUPITER_V6_PROGRAM]);
    const { fetch, calls } = mockFetch([
      [/order/, ORDER(tx)],
      [/execute/, { status: "Success", signature: "5ig", code: 0 }],
    ]);
    const j = new JupiterSwap({ apiKey: "portal-key" });
    const q = await j.quote({ sell: sol(SOL_MAIN.id), buy: usdcSol(SOL_MAIN.id), amount: "1000000000", slippageBps: 50 }, ctx(fetch));
    const [step] = await j.build(q, ctx(fetch));
    const req = step!.request as { method: string; params: { inputs: { transaction: string; chain: string }[] } };
    expect(req.method).toBe("solana:signTransaction");
    expect(req.params.inputs[0]).toMatchObject({ transaction: tx, chain: "solana:mainnet" });
    // chains-solana decodes Jupiter's route_v2 itself (platform §5b), so the step needs no program allowlist.
    expect(step!.verify).toBeUndefined();
    const out = await step!.finish!([{ signedTransaction: "c2lnbmVk" }]);
    expect(out).toEqual({ signature: "5ig" });
    const exec = calls.find((c) => c.url.endsWith("/execute"))!;
    expect(JSON.parse(String(exec.init!.body))).toEqual({ signedTransaction: "c2lnbmVk", requestId: "req-123" });
    expect((exec.init!.headers as Record<string, string>)["x-api-key"]).toBe("portal-key");
  });

  it("a transaction chains-solana can't read stays blind (no wallet-side override)", async () => {
    const tx = txCalling([JUPITER_V6_PROGRAM, "Stake11111111111111111111111111111111111111"]);
    const { fetch } = mockFetch([[/order/, ORDER(tx)]]);
    const j = new JupiterSwap();
    const [step] = await j.build(await j.quote({ sell: sol(SOL_MAIN.id), buy: usdcSol(SOL_MAIN.id), amount: "1", slippageBps: 50 }, ctx(fetch)), ctx(fetch));
    const blind = { requestId: "", title: "Unreadable request", lines: [], balanceChanges: [], simulated: true, blind: true, warnings: [], networkId: SOL_MAIN.id };
    expect(refineDecoded(step!.request as never, blind).blind).toBe(true);
  });
});

/* ------------------------------------------------------------------ SaucerSwap */

const QUOTER = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);

/** Mirror contracts/call mock: pays the best price on the 0.30 % direct pool. */
function saucerMirror(opts: { associated?: boolean; allowance?: number; maxAuto?: number } = {}) {
  return mockFetch([
    [
      /\/api\/v1\/contracts\/call/,
      (_u: string, init?: RequestInit) => {
        const body = JSON.parse(String(init!.body)) as { data: `0x${string}`; to: string };
        const { args } = decodeFunctionData({ abi: QUOTER, data: body.data });
        const path = (args[0] as string).toLowerCase();
        const direct3000 = encodePath(["0.0.15058", "0.0.1183558"], [3000]).toLowerCase();
        const direct500 = encodePath(["0.0.15058", "0.0.1183558"], [500]).toLowerCase();
        if (path === direct3000) return { result: encodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInput", result: [5_000_000n, [], [], 120_000n] }) };
        if (path === direct500) return { result: encodeFunctionResult({ abi: QUOTER, functionName: "quoteExactInput", result: [4_000_000n, [], [], 100_000n] }) };
        return undefined; // no pool → 404
      },
    ],
    [/\/accounts\/0\.0\.1001\/allowances\/tokens/, { allowances: opts.allowance ? [{ amount: opts.allowance }] : [] }],
    [/\/accounts\/0\.0\.1001\/tokens\?token\.id/, { tokens: opts.associated ? [{ token_id: "0.0.1183558", balance: 0, automatic_association: false }] : [] }],
    [/\/accounts\/0\.0\.1001\/tokens/, { tokens: [], links: { next: null } }],
    [/\/accounts\/0\.0\.1001/, mirrorAccount(ME_HEDERA, { evm_address: "0x00000000000000000000000000000000000003e9", max_automatic_token_associations: opts.maxAuto ?? 0 })],
  ]);
}

describe("SaucerSwap V2 (quote via mirror contracts/call, swap via ContractExecute)", () => {
  const ctx = (f: typeof fetch) => ({ network: HEDERA_TESTNET, account: accountFor(HEDERA_TESTNET), fetch: f });

  it("quotes every fee tier on-chain and keeps the best", async () => {
    const { fetch, calls } = saucerMirror();
    const q = await new SaucerSwap().quote({ sell: hbar(), buy: sauce(), amount: "100000000", slippageBps: 100 }, ctx(fetch));
    expect(q).toMatchObject({ buyAmount: "5000000", minBuyAmount: "4950000", route: ["SaucerSwap"] });
    expect(q.approval).toBeUndefined(); // selling HBAR needs no permission
    expect(q.association).toEqual({ tokenId: "0.0.1183558", symbol: "SAUCE" });
    const quoteCalls = calls.filter((c) => c.url.endsWith("/contracts/call"));
    expect(quoteCalls).toHaveLength(4);
    expect(JSON.parse(String(quoteCalls[0]!.init!.body)).to).toBe("0x" + (1390002).toString(16).padStart(40, "0"));
  });

  it("HBAR → token: add the token first, then multicall(exactInput, refundETH) paying HBAR", async () => {
    const { fetch } = saucerMirror();
    const s = new SaucerSwap();
    const q = await s.quote({ sell: hbar(), buy: sauce(), amount: "100000000", slippageBps: 100 }, ctx(fetch));
    const steps = await s.build(q, ctx(fetch));
    expect(steps.map((x) => x.title)).toEqual(["Add SAUCE to your account", "Swap 1 HBAR for ~5 SAUCE"]);
    const assoc = Transaction.fromBytes(Buffer.from(((await (steps[0]!.request as () => Promise<{ params: { transactionList: string } }>)()).params.transactionList), "base64"));
    expect(assoc).toBeInstanceOf(TokenAssociateTransaction);
    const swapReq = await (steps[1]!.request as () => Promise<{ params: { transactionList: string } }>)();
    const tx = Transaction.fromBytes(Buffer.from(swapReq.params.transactionList, "base64")) as ContractExecuteTransaction;
    expect(tx).toBeInstanceOf(ContractExecuteTransaction);
    expect(tx.contractId?.toString()).toBe("0.0.1414040");
    expect(tx.payableAmount?.toTinybars().toString()).toBe("100000000");
    const call = decodeFunctionData({ abi: ROUTER_ABI, data: `0x${Buffer.from(tx.functionParameters!).toString("hex")}` });
    expect(call.functionName).toBe("multicall");
    const inner = (call.args![0] as `0x${string}`[]).map((d) => decodeFunctionData({ abi: ROUTER_ABI, data: d }));
    expect(inner.map((i) => i.functionName)).toEqual(["exactInput", "refundETH"]);
    const params = inner[0]!.args![0] as { recipient: string; amountIn: bigint; amountOutMinimum: bigint };
    expect(params.recipient.toLowerCase()).toBe("0x00000000000000000000000000000000000003e9");
    expect(params.amountOutMinimum).toBe(4_950_000n);
  });

  it("token → HBAR: exact-amount allowance to the router, then exactInput to the router + unwrapWHBAR to you", async () => {
    const { fetch } = saucerMirror({ associated: true });
    const s = new SaucerSwap();
    // Reverse direction: the mock only knows WHBAR→SAUCE paths, so build from a hand-made quote.
    const q = {
      providerId: "saucerswap", provider: "SaucerSwap", networkId: HEDERA_TESTNET.id, sell: sauce(), buy: hbar(), sellAmount: "2500000", buyAmount: "50000000", minBuyAmount: "49500000",
      slippageBps: 100, route: ["SaucerSwap"], expiresAt: Date.now() + 30_000, approval: { spender: "0.0.1414040", spenderName: "SaucerSwap", amount: "2500000" },
      data: { path: encodePath(["0.0.1183558", "0.0.15058"], [3000]), gasEstimate: "120000", tokenIn: "0.0.1183558", tokenOut: "0.0.15058" },
    };
    const steps = await s.build(q, ctx(fetch));
    expect(steps.map((x) => x.title)).toEqual(["Allow SaucerSwap to use exactly 2.5 SAUCE", "Swap 2.5 SAUCE for ~0.5 HBAR"]);
    const allow = Transaction.fromBytes(Buffer.from((await (steps[0]!.request as () => Promise<{ params: { transactionList: string } }>)()).params.transactionList, "base64")) as AccountAllowanceApproveTransaction;
    expect(allow).toBeInstanceOf(AccountAllowanceApproveTransaction);
    const a = allow.tokenApprovals[0]!;
    expect(a.spenderAccountId?.toString()).toBe("0.0.1414040");
    expect(a.amount?.toString()).toBe("2500000"); // exact, never unlimited
    const tx = Transaction.fromBytes(Buffer.from((await (steps[1]!.request as () => Promise<{ params: { transactionList: string } }>)()).params.transactionList, "base64")) as ContractExecuteTransaction;
    const call = decodeFunctionData({ abi: ROUTER_ABI, data: `0x${Buffer.from(tx.functionParameters!).toString("hex")}` });
    const inner = (call.args![0] as `0x${string}`[]).map((d) => decodeFunctionData({ abi: ROUTER_ABI, data: d }));
    expect(inner.map((i) => i.functionName)).toEqual(["exactInput", "unwrapWHBAR"]);
    expect((inner[0]!.args![0] as { recipient: string }).recipient.toLowerCase()).toBe("0x" + (1414040).toString(16).padStart(40, "0"));
    expect(inner[1]!.args).toEqual([49_500_000n, "0x00000000000000000000000000000000000003e9"]);
    expect(tx.payableAmount?.toTinybars().toString() ?? "0").toBe("0");
  });

  it("skips the permission when an allowance already covers the amount; no route → plain error", async () => {
    const { fetch } = saucerMirror({ associated: true, allowance: 9_000_000 });
    const s = new SaucerSwap();
    const q = { providerId: "saucerswap", provider: "SaucerSwap", networkId: HEDERA_TESTNET.id, sell: sauce(), buy: hbar(), sellAmount: "2500000", buyAmount: "1", minBuyAmount: "1", slippageBps: 50, route: [], expiresAt: 0, approval: { spender: "0.0.1414040", spenderName: "SaucerSwap", amount: "2500000" }, data: { path: "0x", gasEstimate: "0", tokenIn: "", tokenOut: "" } };
    expect((await s.build(q as never, ctx(fetch))).map((x) => x.title)).toEqual(["Swap 2.5 SAUCE for ~0.00000001 HBAR"]);
    await expect(s.quote({ sell: usdcHedera(), buy: sauce(), amount: "1000", slippageBps: 50 }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
  });
});

/* ------------------------------------------------------------------ 0x */

const ZX = (over: Record<string, unknown> = {}) => ({
  liquidityAvailable: true,
  buyAmount: "25000000000000000",
  minBuyAmount: "24875000000000000",
  sellAmount: "100000000",
  issues: { allowance: { actual: "0", spender: ALLOWANCE_HOLDER_CANCUN }, balance: null },
  route: { fills: [{ source: "Uniswap_V3", proportionBps: "10000" }] },
  transaction: { to: ALLOWANCE_HOLDER_CANCUN, data: "0x2213bc0b00", value: "0", gas: "210000", gasPrice: "1" },
  ...over,
});

describe("0x Swap API v2 (AllowanceHolder)", () => {
  const ctx = (f: typeof fetch) => ({ network: BASE_MAINNET, account: accountFor(BASE_MAINNET), fetch: f });

  it("is off without an API key, and on test networks, in plain words", () => {
    expect(new ZeroExSwap().availability(BASE_MAINNET)).toEqual({ code: "swap/not-configured", message: "Swapping these tokens isn't switched on in this build." });
    expect(new ZeroExSwap({ apiKey: "k" }).availability(SEPOLIA)?.code).toBe("swap/mainnet-only");
    expect(new ZeroExSwap({ apiKey: "k" }).availability(BASE_MAINNET)).toBeNull();
  });

  it("quotes with the v2 headers, then builds an exact-amount approve and the swap", async () => {
    const { fetch, calls } = mockFetch([[/api\.0x\.org\/swap\/allowance-holder\/quote/, ZX()]]);
    const z = new ZeroExSwap({ apiKey: "test-key" });
    const q = await z.quote({ sell: usdcEvm(BASE_MAINNET), buy: ethOn(BASE_MAINNET), amount: "100000000", slippageBps: 50 }, ctx(fetch));
    const u = new URL(calls[0]!.url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ chainId: "8453", buyToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", sellAmount: "100000000", taker: ME_EVM, slippageBps: "50" });
    expect(calls[0]!.init!.headers).toMatchObject({ "0x-api-key": "test-key", "0x-version": "v2" });
    expect(u.toString()).not.toContain("test-key");
    expect(q.approval).toEqual({ spender: ALLOWANCE_HOLDER_CANCUN, spenderName: "0x", amount: "100000000" });
    expect(q.route).toEqual(["Uniswap V3"]);
    const steps = await z.build(q, ctx(fetch));
    expect(steps.map((s) => s.title)).toEqual(["Allow 0x to use exactly 100 USDC", "Swap 100 USDC for ~0.025 ETH"]);
    const approve = (steps[0]!.request as { params: { data: `0x${string}`; to: string }[] }).params[0]!;
    const d = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    expect(d.functionName).toBe("approve");
    expect(d.args).toEqual([ALLOWANCE_HOLDER_CANCUN, 100_000_000n]);
    const swap = steps[1]!.request as { method: string; params: { to: string; gas: string }[] };
    expect(swap.method).toBe("eth_sendTransaction");
    expect(swap.params[0]).toMatchObject({ to: ALLOWANCE_HOLDER_CANCUN, gas: "0x33450" });
    expect(steps[1]!.verify!(swap as never)).toBe(true);
  });

  it("refuses a quote that sends the swap or the permission anywhere but AllowanceHolder", async () => {
    const evil = "0x000000000000000000000000000000000000dEaD";
    const a = mockFetch([[/quote/, ZX({ transaction: { to: evil, data: "0x", value: "0" } })]]);
    await expect(new ZeroExSwap({ apiKey: "k" }).quote({ sell: usdcEvm(BASE_MAINNET), buy: ethOn(BASE_MAINNET), amount: "1", slippageBps: 50 }, ctx(a.fetch))).rejects.toMatchObject({ code: "swap/unexpected-target" });
    const b = mockFetch([[/quote/, ZX({ issues: { allowance: { actual: "0", spender: evil } } })]]);
    await expect(new ZeroExSwap({ apiKey: "k" }).quote({ sell: usdcEvm(BASE_MAINNET), buy: ethOn(BASE_MAINNET), amount: "1", slippageBps: 50 }, ctx(b.fetch))).rejects.toMatchObject({ code: "swap/unexpected-spender" });
    const c = mockFetch([[/quote/, { liquidityAvailable: false, zid: "z" }]]);
    await expect(new ZeroExSwap({ apiKey: "k" }).quote({ sell: usdcEvm(BASE_MAINNET), buy: ethOn(BASE_MAINNET), amount: "1", slippageBps: 50 }, ctx(c.fetch))).rejects.toMatchObject({ code: "swap/no-route" });
  });
});

/* ------------------------------------------------------------------ SwapService */

describe("SwapService", () => {
  it("picks the network where you hold the asset, adds plain warnings, and queues the steps", async () => {
    const { fetch } = saucerMirror();
    const host = fakeHost({
      networks: [HEDERA_TESTNET, DEVNET],
      assets: [hbar(), sauce(), sol(DEVNET.id)],
      balances: [{ asset: hbar(), amount: "500000000" }],
      fetch,
      usd: { hbar: 0.25, "hts:0.0.1183558": 0.01 },
    });
    const svc = new SwapService(host, [new SaucerSwap(), new JupiterSwap()]);
    const v = await svc.quote({ sell: "hbar", buy: "hts:0.0.1183558", amount: "1", slippageBps: 400 });
    expect(v).toMatchObject({ provider: "SaucerSwap", youGet: "You get ~5 SAUCE", atLeast: "At least 4.8 SAUCE, or nothing happens", route: "Via SaucerSwap", executable: true });
    expect(v.steps).toEqual(["Add SAUCE to your account", "Swap"]);
    // 1 HBAR = $0.25 in, 5 SAUCE = $0.05 out → large value loss; and slippage above 3 %.
    expect(v.warnings.map((w) => w.level)).toEqual(["danger", "caution"]);
    expect(v.warnings[0]!.message).toBe("You'd get about 80% less value than you put in.");
    const queued = await svc.execute(v.id);
    expect(queued).toMatchObject({ approvalId: "approval-1", steps: ["Add SAUCE to your account", "Swap 1 HBAR for ~5 SAUCE"] });
    expect(queued.stepMsgs?.map((m) => m?.id)).toEqual(["bg.req.addToYourAccount", "bg.req.swap"]);
    expect(queued.stepMsgs?.[1]?.values).toEqual({ pay: "1 HBAR", get: "~5 SAUCE" });
    // The swap is queued only after the association went through.
    expect(host.enqueued).toHaveLength(1);
    host.enqueued[0]!.resolve({ transactionId: "0.0.1001@1.1" });
    await flush();
    expect(host.enqueued).toHaveLength(2);
    expect(host.enqueued[1]!.request.method).toBe("hedera_signAndExecuteTransaction");
    // Refine leads with the plain title on a readable decode.
    const d = refineDecoded(host.enqueued[1]!.request, { requestId: "", title: "Swap", lines: [{ label: "Contract", value: "0.0.1414040" }], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: "" });
    expect(d.title).toBe("Swap 1 HBAR for ~5 SAUCE");
    await expect(svc.execute(v.id)).rejects.toMatchObject({ code: "swap/quote-expired" });
  });

  it("not enough of the asset → plain error; providers off → their plain reason", async () => {
    const { fetch } = saucerMirror();
    const host = fakeHost({ networks: [HEDERA_TESTNET, DEVNET], assets: [hbar(), sauce(), sol(DEVNET.id), usdcSol(DEVNET.id)], balances: [{ asset: sol(DEVNET.id), amount: "5" }], fetch });
    const svc = new SwapService(host, [new SaucerSwap(), new JupiterSwap()]);
    await expect(svc.quote({ sell: "hbar", buy: "hts:0.0.1183558", amount: "1" })).rejects.toMatchObject({ code: "swap/insufficient" });
    await expect(svc.quote({ sell: "sol", buy: "usdc", amount: "1" })).rejects.toMatchObject({ userMessage: "Swapping these tokens isn't available in this test version yet." });
    expect(svc.status()).toEqual([
      { id: "saucerswap", name: "SaucerSwap", family: "hedera" },
      { id: "jupiter", name: "Jupiter", family: "solana", unavailable: { code: "swap/mainnet-only", message: "Swapping these tokens isn't available in this test version yet." } },
    ]);
  });

  it("assets that never share a network go to CLPRouter for a quote-only preview", async () => {
    const { fetch } = mockFetch([]);
    const eth = ethOn(SEPOLIA);
    const host = fakeHost({ networks: [SEPOLIA, HEDERA_TESTNET], assets: [eth, hbar()], balances: [{ asset: eth, amount: "1000000000000000000" }], fetch, usd: { eth: 4000, hbar: 0.25 } });
    const asked: unknown[] = [];
    const route: RouteQuoter = {
      quote: async (req) => {
        asked.push(req);
        return [
          {
            id: "e1", from: SEPOLIA.id, to: HEDERA_TESTNET.id, mode: "balanced", title: "Pay 16000 HBAR on Hedera with ETH from Ethereum",
            youPay: { asset: eth, amount: "1010000000000000000", display: "1.01 ETH" }, escrow: { asset: eth, amount: "1", display: "" },
            fee: { asset: eth, amount: "1", display: "", usd: 1 }, time: { p90Seconds: 120, display: "2 min" }, carbon: { kgCO2e: 0, display: "" },
            trust: { tier: "attested", display: "" }, successProbability: 0.99, steps: [{ text: "Send 1.01 ETH from Ethereum", networkId: SEPOLIA.id }], warnings: [], usesTestVerifier: true, estimated: true,
          } as never,
        ];
      },
    };
    const v = await new SwapService(host, [new SaucerSwap()], { route }).quote({ sell: "eth", buy: "hbar", amount: "1" });
    expect(asked[0]).toMatchObject({ to: HEDERA_TESTNET.id, amount: "1600000000000", from: [SEPOLIA.id] });
    expect(v).toMatchObject({ provider: "CLPRouter", executable: false, youGet: "You get ~16,000 HBAR", sell: { display: "1.01 ETH" } });
    expect(v.note).toContain("isn't switched on");
  });
});
