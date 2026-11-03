import type { AssetRef, ClipError, DappRequest, DecodedRequest, Network } from "@coldai/clip-wallet-core";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  getAddress,
  parseAbi,
  parseAbiParameters,
} from "viem";
import { describe, expect, it } from "vitest";
import receiversFile from "../src/swap/sodax-fee-receivers.json" with { type: "json" };
import { CLIP_FEE, SODAX_FEE_RECEIVERS, clipFeeOn, isReviewedFeeReceiver, parseFeeReceivers, withinClipFee } from "../src/swap/sodax-fee.js";
import {
  SODAX_HUB_ASSET_MANAGER,
  SODAX_HUB_WALLET_FACTORY,
  SODAX_INTENTS,
  SODAX_NATIVE,
  SODAX_SPOKES,
  SONIC_RPC_URL,
  type SodaxIntent,
  type SodaxSwapPlan,
  checkSodaxSwap,
  decodeSodaxSwap,
  sodaxFeeData,
  sodaxSwapTx,
} from "../src/swap/sodax-intent.js";
import { SodaxSwap, type SodaxSwapOptions, sodaxTokens } from "../src/swap/sodax.js";
import { SwapService } from "../src/swap/service.js";
import { refineDecoded } from "../src/steps.js";
import { BASE_MAINNET, DEVNET, ME_EVM, SEPOLIA, accountFor, ethOn, fakeHost, flush, mockFetch, usdcEvm } from "./helpers.js";

/** ColdAI LLC's address, the one on the committed list (sodax-fee-receivers.json). */
const COLDAI = "0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f313";
/** Clearly fake: nobody holds it. Tests pass it as the reviewed list, so they don't depend on the committed one. */
const FAKE_RECEIVER = "0x00000000000000000000000000000000000fee01";
const OTHER = "0x000000000000000000000000000000000000dead";
const SERVER = "https://exclip.test";
/** GET /api/exclip/config from a server set up for SODAX with no fee of its own (ExClip services/config.ts:108-133). */
const FEE_FREE = { sodaxConfigured: true, tradingEnabled: true, partnerFeeBps: 0, feeReceiver: null, feeSplit: null };
const ARBITRUM: Network = {
  id: "eip155:42161",
  family: "evm",
  name: "Arbitrum One",
  nativeAsset: { key: "eth", symbol: "ETH", name: "Ether", decimals: 18, networkId: "eip155:42161" },
  testnet: false,
  rpcUrls: ["https://arbitrum.rpc.test"],
  explorerUrl: "https://arbiscan.io",
  chainId: 42161,
};
const USDC_BASE = usdcEvm(BASE_MAINNET).address!;
/** Hub (Sonic) assets and hub wallet: made-up addresses, confirmed by the mocked Sonic RPC below. */
const HUB_USDC = "0x00000000000000000000000000000000000a0001";
const HUB_ETH_ARB = "0x00000000000000000000000000000000000a0002";
const HUB_WALLET = "0x00000000000000000000000000000000000b0001";
const STOCK = { key: "tslax", symbol: "TSLAx", name: "Tesla xStock", decimals: 18, networkId: BASE_MAINNET.id, address: "0x00000000000000000000000000000000000c0001" } satisfies AssetRef;
/** Seconds-based clock far enough ahead that SwapService's own Date.now() checks never expire the quote. */
const NOW = 1_900_000_000_000;
const NOW_S = BigInt(NOW / 1000);

const TOKENS = {
  "0x2105.base": [
    { symbol: "USDC", name: "USD Coin", decimals: 6, address: USDC_BASE, hubAsset: HUB_USDC },
    { symbol: "TSLAx", name: "Tesla xStock", decimals: 18, address: STOCK.address, hubAsset: "0x00000000000000000000000000000000000a0009", isRwa: true },
  ],
  "0xa4b1.arbitrum": [{ symbol: "ETH", name: "Ether", decimals: 18, address: SODAX_NATIVE, hubAsset: HUB_ETH_ARB }],
};

const HUB = parseAbi([
  "function getDeployedAddress(uint256 chainId, bytes user) view returns (address computedAddress)",
  "function assetInfo(address asset) view returns (uint256 chainID, bytes spokeAddress)",
]);

/** Sonic answers the hub wallet and which spoke token each hub asset is; the source network answers the allowance. */
function chains(over: { assetInfo?: Record<string, [bigint, string]> } = {}) {
  const info: Record<string, [bigint, string]> = { [HUB_USDC]: [30n, USDC_BASE], [HUB_ETH_ARB]: [23n, SODAX_NATIVE], ...over.assetInfo };
  return {
    eth_call: (params: unknown[], url: string) => {
      const { to, data } = params[0] as { to: string; data: `0x${string}` };
      if (url === SONIC_RPC_URL && to.toLowerCase() === SODAX_HUB_WALLET_FACTORY.toLowerCase()) {
        return encodeFunctionResult({ abi: HUB, functionName: "getDeployedAddress", result: getAddress(HUB_WALLET) });
      }
      if (url === SONIC_RPC_URL && to.toLowerCase() === SODAX_HUB_ASSET_MANAGER.toLowerCase()) {
        const { args } = decodeFunctionData({ abi: HUB, data });
        const [chain, spoke] = info[String(args[0]).toLowerCase()]!;
        return encodeFunctionResult({ abi: HUB, functionName: "assetInfo", result: [chain, spoke.toLowerCase() as `0x${string}`] });
      }
      return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: 0n });
    },
    eth_getTransactionReceipt: () => ({ status: "0x1" }),
  };
}

function server(over: { config?: unknown; quote?: unknown; submit?: (body: Record<string, unknown>) => unknown } = {}) {
  return mockFetch(
    [
      [/^https:\/\/exclip\.test\/api\/exclip\/config$/, over.config ?? FEE_FREE],
      [/^https:\/\/exclip\.test\/api\/exclip\/sodax\/swaps\/tokens$/, TOKENS],
      [/^https:\/\/exclip\.test\/api\/exclip\/sodax\/swaps\/quote$/, over.quote ?? { quotedAmount: "2500000000000000" }],
      [/^https:\/\/exclip\.test\/api\/exclip\/sodax\/swaps\/submit-tx$/, (_u: string, init?: RequestInit) => (over.submit ?? (() => ({ success: true, data: { status: "pending" } })))(JSON.parse(String(init?.body)))],
    ],
    chains(),
  );
}

const sodax = (over: Partial<SodaxSwapOptions> = {}) =>
  new SodaxSwap({ serverUrl: SERVER, feeReceiver: FAKE_RECEIVER, walletName: "Test Wallet", testnet: false, receivers: [FAKE_RECEIVER], now: () => NOW, sleep: async () => {}, ...over });

const ctx = (f: typeof fetch, network = BASE_MAINNET) => ({ network, account: accountFor(network), fetch: f });
const ask = (amount = "100000000") => ({ sell: usdcEvm(BASE_MAINNET), buy: ethOn(ARBITRUM), amount, slippageBps: 50, destination: { network: ARBITRUM, address: ME_EVM } });

const PLAN: SodaxSwapPlan = {
  src: SODAX_SPOKES[8453]!,
  dst: SODAX_SPOKES[42161]!,
  from: getAddress(ME_EVM),
  to: getAddress(ME_EVM),
  sellToken: getAddress(USDC_BASE),
  sellHubAsset: getAddress(HUB_USDC),
  buyHubAsset: getAddress(HUB_ETH_ARB),
  hubWallet: getAddress(HUB_WALLET),
  gross: 100_000_000n,
  fee: 875_000n,
  feeReceiver: getAddress(FAKE_RECEIVER),
  minOut: 2_487_500_000_000_000n,
  intentId: 7n,
  deadline: NOW_S + 600n,
};

const SPOKE_ABI = parseAbi(["function transfer(address token, bytes to, uint256 amount, bytes data) payable"]);
const INTENTS_ABI = parseAbi([
  "function createIntent((uint256 intentId,address creator,address inputToken,address outputToken,uint256 inputAmount,uint256 minOutputAmount,uint256 deadline,bool allowPartialFill,uint256 srcChain,uint256 dstChain,bytes srcAddress,bytes dstAddress,address solver,bytes data) intent)",
]);
const HUB_CALLS = parseAbiParameters("(address,uint256,bytes)[]");

/** The plan's swap with its intent changed: what a tampered quote, or a bug, would hand the signer. */
function withIntent(plan: SodaxSwapPlan, change: (i: SodaxIntent) => SodaxIntent): string {
  const intent = change(sodaxSwapTx(plan).intent);
  const calls = encodeAbiParameters(HUB_CALLS, [
    [
      [getAddress(plan.sellHubAsset), 0n, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SODAX_INTENTS, plan.gross] })],
      [SODAX_INTENTS, 0n, encodeFunctionData({ abi: INTENTS_ABI, functionName: "createIntent", args: [intent] })],
    ],
  ]);
  return encodeFunctionData({ abi: SPOKE_ABI, functionName: "transfer", args: [getAddress(plan.sellToken), plan.hubWallet as `0x${string}`, plan.gross, calls] });
}

function refusal(run: () => unknown): ClipError {
  try {
    run();
  } catch (e) {
    return e as ClipError;
  }
  throw new Error("expected a refusal");
}

const check = (tx: { to?: string; data?: string; value?: string | bigint }, plan = PLAN) =>
  checkSodaxSwap(tx, plan, { name: "Test Wallet", nowSec: NOW_S, receivers: [FAKE_RECEIVER] });

/* ------------------------------------------------------------------ the Clip fee */

describe("Clip fee", () => {
  it("pins the reviewed receiver list: ColdAI LLC's address, and no other", () => {
    // Changing sodax-fee-receivers.json means changing these two lines in the same reviewed commit.
    expect(receiversFile.receivers).toEqual(["0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f313"]);
    expect(SODAX_FEE_RECEIVERS).toEqual(["0x90291104f2d1ef9ffe2bc1635a3a270a09c8f313"]);
    expect(Object.isFrozen(SODAX_FEE_RECEIVERS)).toBe(true);
    // Committed with its EIP-55 checksum, so a mistyped character shows here.
    expect(getAddress(COLDAI)).toBe(COLDAI);
    expect(isReviewedFeeReceiver(COLDAI)).toBe(true);
    expect(isReviewedFeeReceiver(COLDAI.toLowerCase())).toBe(true);
    // Any other address isn't, one digit off included.
    expect(isReviewedFeeReceiver("0x90291104f2D1ef9Ffe2Bc1635A3a270A09C8f314")).toBe(false);
    expect(isReviewedFeeReceiver(FAKE_RECEIVER)).toBe(false);
    expect(isReviewedFeeReceiver(OTHER)).toBe(false);
    expect(isReviewedFeeReceiver(undefined)).toBe(false);
    // A list passed in replaces the committed one.
    expect(isReviewedFeeReceiver(FAKE_RECEIVER, [FAKE_RECEIVER])).toBe(true);
    expect(isReviewedFeeReceiver(FAKE_RECEIVER.toUpperCase().replace("0X", "0x"), [FAKE_RECEIVER])).toBe(true);
    expect(isReviewedFeeReceiver(COLDAI, [FAKE_RECEIVER])).toBe(false);
  });

  it("is exactly 875 / 100 000 of the amount sold, rounded down, and paid to ColdAI LLC", () => {
    expect(CLIP_FEE).toMatchObject({ percent: 0.875, name: "Clip", receivedBy: "ColdAI LLC" });
    expect(clipFeeOn(100_000_000n)).toBe(875_000n); // 100 USDC → 0.875 USDC
    expect(clipFeeOn(10n ** 18n)).toBe(8_750_000_000_000_000n); // 1 ETH → 0.00875 ETH
    expect(clipFeeOn(114n)).toBe(0n);
    expect(withinClipFee(875_000n, 100_000_000n)).toBe(true);
    expect(withinClipFee(0n, 100_000_000n)).toBe(true);
    expect(withinClipFee(875_001n, 100_000_000n)).toBe(false);
    expect(withinClipFee(-1n, 100_000_000n)).toBe(false);
  });

  it("reads a malformed receiver list as an error, never as an empty or a permissive one", () => {
    expect(() => parseFeeReceivers({})).toThrow(/receivers must be a list/);
    expect(() => parseFeeReceivers({ receivers: FAKE_RECEIVER })).toThrow(/receivers must be a list/);
    expect(() => parseFeeReceivers({ receivers: ["0x1234"] })).toThrow(/isn't an EVM address/);
    expect(() => parseFeeReceivers({ receivers: [SODAX_NATIVE] })).toThrow(/isn't an EVM address/);
    expect(() => parseFeeReceivers({ receivers: [FAKE_RECEIVER, getAddress(FAKE_RECEIVER)] })).toThrow(/listed twice/);
    expect(parseFeeReceivers({ receivers: [getAddress(FAKE_RECEIVER)] })).toEqual([FAKE_RECEIVER]);
    expect(() => sodax({ receivers: ["nope"] })).toThrow(/isn't an EVM address/);
  });

  it("travels in the intent as SODAX's single fee entry: type 1, then abi.encode(fee, receiver)", () => {
    expect(sodaxFeeData(875_000n, FAKE_RECEIVER)).toBe(`0x01${(875_000).toString(16).padStart(64, "0")}${FAKE_RECEIVER.slice(2).padStart(64, "0")}`);
  });
});

/* ------------------------------------------------------------------ token list */

describe("SODAX token list", () => {
  it("never offers a tokenised stock (isRwa), and drops anything malformed", () => {
    const list = sodaxTokens({
      ...TOKENS,
      "0x38.bsc": [
        { symbol: "AAPLx", decimals: 18, address: "0x00000000000000000000000000000000000c0002", hubAsset: HUB_USDC, isRwa: "true" },
        { symbol: "NVDAx", decimals: 18, address: "0x00000000000000000000000000000000000c0003", hubAsset: HUB_USDC, isRwa: 1 },
        { symbol: "BAD", decimals: 18, address: "not an address", hubAsset: HUB_USDC },
        { symbol: "OK", decimals: 18, address: "0x00000000000000000000000000000000000c0004", hubAsset: HUB_USDC, isRwa: false },
      ],
      "0xa.optimism": "not a list",
    });
    expect(list["0x2105.base"]!.map((t) => t.symbol)).toEqual(["USDC"]);
    expect(list["0x38.bsc"]!.map((t) => t.symbol)).toEqual(["OK"]);
    expect(list["0xa4b1.arbitrum"]!.map((t) => t.symbol)).toEqual(["ETH"]);
    expect(list["0xa.optimism"]).toBeUndefined();
    expect(sodaxTokens(null)).toEqual({});
    expect(sodaxTokens([TOKENS])).toEqual({});
  });

  it("refuses to quote a tokenised stock even when the server lists it", async () => {
    const { fetch } = server();
    await expect(sodax().quote({ ...ask(), sell: STOCK, amount: "1000000000000000000" }, ctx(fetch))).rejects.toMatchObject({ code: "swap/asset-unavailable" });
  });
});

/* ------------------------------------------------------------------ availability */

describe("SODAX availability (fails closed)", () => {
  it("is off without the server, without a reviewed fee receiver, in test builds and off its networks", () => {
    expect(sodax().availability(BASE_MAINNET)).toBeNull();
    expect(sodax().availability(ARBITRUM)).toBeNull();
    expect(sodax({ serverUrl: undefined }).availability(BASE_MAINNET)).toEqual({ code: "swap/not-configured", message: "Swapping these tokens isn't switched on in this build." });
    expect(sodax({ serverUrl: "http://exclip.test" }).availability(BASE_MAINNET)?.code).toBe("swap/not-configured");
    expect(sodax({ feeReceiver: undefined }).availability(BASE_MAINNET)?.code).toBe("swap/not-configured");
    // The committed list: a build that sets ColdAI LLC's address gets SODAX, one that sets any other address doesn't.
    expect(sodax({ receivers: undefined, feeReceiver: COLDAI }).availability(BASE_MAINNET)).toBeNull();
    expect(sodax({ receivers: undefined, feeReceiver: COLDAI.toLowerCase() }).availability(BASE_MAINNET)).toBeNull();
    expect(sodax({ receivers: undefined }).availability(BASE_MAINNET)?.code).toBe("swap/fee-receiver-not-allowed");
    expect(sodax({ feeReceiver: OTHER }).availability(BASE_MAINNET)?.code).toBe("swap/fee-receiver-not-allowed");
    expect(sodax({ testnet: true }).availability(BASE_MAINNET)?.code).toBe("swap/mainnet-only");
    expect(sodax().availability(SEPOLIA)?.code).toBe("swap/mainnet-only");
    expect(sodax().availability(DEVNET)?.code).toBe("swap/wrong-family");
    expect(sodax().availability({ ...BASE_MAINNET, id: "eip155:324", chainId: 324 })?.code).toBe("swap/unsupported-network");
  });

  it("only swaps between two of its networks, to an address of yours", async () => {
    const { fetch, calls } = server();
    await expect(sodax().quote({ ...ask(), destination: undefined }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(sodax().quote({ ...ask(), destination: { network: BASE_MAINNET, address: ME_EVM } }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(sodax().quote({ ...ask(), destination: { network: SEPOLIA, address: ME_EVM } }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    await expect(sodax().quote({ ...ask(), destination: { network: ARBITRUM, address: "me" } }, ctx(fetch))).rejects.toMatchObject({ code: "swap/no-route" });
    expect(calls).toHaveLength(0);
  });

  it("needs the server set up for it: SODAX on and trading on", async () => {
    for (const config of [{ ...FEE_FREE, tradingEnabled: false }, { ...FEE_FREE, sodaxConfigured: false }, {}]) {
      const { fetch } = server({ config });
      await expect(sodax().quote(ask(), ctx(fetch))).rejects.toMatchObject({ code: "swap/server-not-ready", userMessage: "Swapping isn't available right now." });
    }
  });

  it("can't use a server that charges a fee of its own, plain or split", async () => {
    // A split as ExClip publishes it (services/config.ts:108-133): partnerFeeBps 0 and feeReceiver null, the fee in feeSplit.
    const split = { receiver: OTHER, totalRate: 975, platform: { name: "Platform", rate: 875 }, operator: { name: "Operator", rate: 100 }, stockFee: null };
    for (const config of [
      { ...FEE_FREE, partnerFeeBps: 25, feeReceiver: OTHER },
      { ...FEE_FREE, partnerFeeBps: 25 },
      { ...FEE_FREE, feeReceiver: OTHER },
      { ...FEE_FREE, feeSplit: split },
      { ...FEE_FREE, feeSplit: {} },
      // A server that doesn't say it has no fee receiver.
      { sodaxConfigured: true, tradingEnabled: true, partnerFeeBps: 0 },
      { sodaxConfigured: true, tradingEnabled: true, feeReceiver: null },
    ]) {
      const { fetch, calls } = server({ config });
      await expect(sodax().quote(ask(), ctx(fetch)), JSON.stringify(config)).rejects.toMatchObject({
        code: "swap/server-fee",
        userMessage: "Swapping isn't available right now.",
      });
      // Refused before anything else is asked: no token list, no quote, nothing from Sonic.
      expect(calls.map((c) => c.url)).toEqual([`${SERVER}/api/exclip/config`]);
    }
  });

  it("uses a server with no fee of its own: partnerFeeBps 0, feeReceiver null and no feeSplit", async () => {
    for (const config of [FEE_FREE, { sodaxConfigured: true, tradingEnabled: true, partnerFeeBps: 0, feeReceiver: null }]) {
      const { fetch } = server({ config });
      await expect(sodax().quote(ask(), ctx(fetch)), JSON.stringify(config)).resolves.toMatchObject({ provider: "SODAX", buyAmount: "2500000000000000" });
    }
  });
});

/* ------------------------------------------------------------------ quote and review */

describe("SODAX quote and review", () => {
  it("quotes what's left after the 0.875 % Clip fee and asks for a permission of exactly what you sell", async () => {
    const { fetch, calls } = server();
    const q = await sodax().quote(ask(), ctx(fetch));
    const quoted = calls.find((c) => c.url.endsWith("/sodax/swaps/quote"))!;
    // No partnerFee is sent: the Clip fee travels in the intent the wallet builds, not through the server.
    expect(JSON.parse(String(quoted.init!.body))).toEqual({
      tokenSrc: USDC_BASE,
      tokenSrcChainKey: "0x2105.base",
      tokenDst: SODAX_NATIVE,
      tokenDstChainKey: "0xa4b1.arbitrum",
      amount: "99125000",
      quoteType: "exact_input",
    });
    expect(q).toMatchObject({
      provider: "SODAX",
      networkId: BASE_MAINNET.id,
      sellAmount: "100000000",
      buyAmount: "2500000000000000",
      minBuyAmount: "2487500000000000",
      clipFee: { pct: 0.875, amount: "875000", receiver: getAddress(FAKE_RECEIVER), name: "Clip", receivedBy: "ColdAI LLC" },
      approval: { spender: SODAX_SPOKES[8453]!.assetManager, spenderName: "SODAX", amount: "100000000" },
    });
    // Nothing went anywhere but the server and the two networks' RPCs.
    expect(new Set(calls.map((c) => new URL(c.url).origin))).toEqual(new Set([SERVER, SONIC_RPC_URL, "https://base.rpc.test"]));
  });

  it("stops when Sonic doesn't confirm a hub asset is the token you chose", async () => {
    const { fetch } = mockFetch(
      [
        [/\/config$/, FEE_FREE],
        [/\/swaps\/tokens$/, TOKENS],
      ],
      chains({ assetInfo: { [HUB_USDC]: [30n, OTHER] } }),
    );
    await expect(sodax().quote(ask(), ctx(fetch))).rejects.toMatchObject({ code: "swap/hub-asset-mismatch" });
  });

  it("an amount whose fee would round to nothing is too small", async () => {
    const { fetch } = server();
    await expect(sodax().quote(ask("114"), ctx(fetch))).rejects.toMatchObject({ code: "swap/too-small" });
  });

  it("shows the Clip fee, who gets it and where you get paid before you sign; the bytes say the same", async () => {
    const { fetch } = server();
    const s = sodax();
    const q = await s.quote(ask(), ctx(fetch));
    const steps = await s.build(q, ctx(fetch));
    expect(steps.map((x) => x.title)).toEqual(["Allow SODAX to use exactly 100 USDC", "Swap 100 USDC for ~0.0025 ETH"]);
    const approve = (steps[0]!.request as DappRequest).params as { to: string; data: `0x${string}` }[];
    expect(approve[0]!.to).toBe(getAddress(USDC_BASE));
    expect(decodeFunctionData({ abi: erc20Abi, data: approve[0]!.data }).args).toEqual([SODAX_SPOKES[8453]!.assetManager, 100_000_000n]);

    expect(steps[1]!.lines).toEqual([
      { label: "Clip fee", labelMsg: { id: "bg.label.walletFee", values: { name: "Clip" }, fallback: "Clip fee" }, value: "0.875% · 0.875 USDC" },
      { label: "Fee goes to", value: `ColdAI LLC, ${getAddress(FAKE_RECEIVER)}` },
      { label: "You get at least", value: "0.002487 ETH" },
      { label: "Arrives on", value: "Arbitrum One" },
    ]);
    const request = await (steps[1]!.request as () => Promise<DappRequest>)();
    const tx = (request.params as { to: string; data: string; value: string }[])[0]!;
    expect(request).toMatchObject({ method: "eth_sendTransaction", networkId: BASE_MAINNET.id, family: "evm" });
    expect(tx).toMatchObject({ from: getAddress(ME_EVM), to: SODAX_SPOKES[8453]!.assetManager, value: "0x0" });
    const read = decodeSodaxSwap(tx.data);
    expect(read).toMatchObject({ amount: 100_000_000n, fee: 875_000n, receiver: getAddress(FAKE_RECEIVER) });
    expect(read.intent).toMatchObject({
      creator: getAddress(HUB_WALLET),
      inputToken: getAddress(HUB_USDC),
      outputToken: getAddress(HUB_ETH_ARB),
      inputAmount: 99_125_000n,
      minOutputAmount: 2_487_500_000_000_000n,
      deadline: NOW_S + 600n,
      allowPartialFill: false,
      srcChain: 30n,
      dstChain: 23n,
      srcAddress: ME_EVM,
      dstAddress: ME_EVM,
      solver: SODAX_NATIVE,
    });
    expect(steps[1]!.verify!(request)).toBe(true);
    // The same request with any other bytes isn't verified, so it stays unreadable (blind) on the review.
    const changed = { ...request, params: [{ ...tx, data: withIntent({ ...PLAN, intentId: read.intent.intentId }, (i) => ({ ...i, minOutputAmount: 1n })) }] };
    expect(steps[1]!.verify!(changed)).toBe(false);
  });

  it("a quote built for a receiver this wallet hasn't reviewed is stopped before the permission is asked", async () => {
    const { fetch } = server();
    const q = await sodax().quote(ask(), ctx(fetch));
    await expect(sodax({ receivers: [OTHER] }).build(q, ctx(fetch))).rejects.toMatchObject({ code: "swap/fee-receiver-unknown" });
  });

  it("with the committed list, a build set to ColdAI LLC's address quotes and builds a swap that pays it", async () => {
    const { fetch } = server();
    const s = sodax({ receivers: undefined, feeReceiver: COLDAI });
    const q = await s.quote(ask(), ctx(fetch));
    expect(q.clipFee).toMatchObject({ amount: "875000", receiver: getAddress(COLDAI), receivedBy: "ColdAI LLC" });
    const steps = await s.build(q, ctx(fetch));
    expect(steps[1]!.lines).toContainEqual({ label: "Fee goes to", value: `ColdAI LLC, ${getAddress(COLDAI)}` });
    const request = await (steps[1]!.request as () => Promise<DappRequest>)();
    expect(decodeSodaxSwap((request.params as { data: string }[])[0]!.data)).toMatchObject({ fee: 875_000n, receiver: getAddress(COLDAI) });
    expect(steps[1]!.verify!(request)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the check before signing */

describe("the wallet's own check of a SODAX swap", () => {
  const own = sodaxSwapTx(PLAN).tx;

  it("passes the swap it planned", () => {
    expect(check({ to: own.to, data: own.data, value: "0x0" })).toMatchObject({ fee: 875_000n, receiver: getAddress(FAKE_RECEIVER) });
  });

  it("refuses a fee paid to an address it hasn't reviewed, naming the wallet", () => {
    const tx = sodaxSwapTx({ ...PLAN, feeReceiver: OTHER }).tx;
    expect(refusal(() => check({ to: tx.to, data: tx.data, value: 0n }))).toMatchObject({
      code: "swap/fee-receiver-unknown",
      userMessage: "This swap would pay its fee to an address Test Wallet hasn't reviewed, so it was stopped. Nothing was signed.",
    });
  });

  it("with the committed list, passes a fee paid to ColdAI LLC's address and refuses any other", () => {
    const committed = { name: "Test Wallet", nowSec: NOW_S };
    const plan = { ...PLAN, feeReceiver: getAddress(COLDAI) };
    const tx = sodaxSwapTx(plan).tx;
    expect(checkSodaxSwap({ to: tx.to, data: tx.data, value: 0n }, plan, committed)).toMatchObject({ fee: 875_000n, receiver: getAddress(COLDAI) });
    expect(refusal(() => checkSodaxSwap({ to: own.to, data: own.data, value: 0n }, PLAN, committed)).code).toBe("swap/fee-receiver-unknown");
  });

  it("refuses a fee above 0.875 %, naming the Clip fee", () => {
    const plan = { ...PLAN, fee: 875_001n };
    const tx = sodaxSwapTx(plan).tx;
    expect(refusal(() => check({ to: tx.to, data: tx.data, value: 0n }, plan))).toMatchObject({
      code: "swap/fee-too-high",
      userMessage: "This swap would charge more than the 0.875% Clip fee, so it was stopped. Nothing was signed.",
    });
  });

  it("refuses anything else that isn't the plan: amounts, addresses, deadline, solver, extra intent data, target, value", () => {
    const cases: [string, { to?: string; data?: string; value?: string | bigint }][] = [
      ["input amount", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, inputAmount: i.inputAmount + 1n })), value: 0n }],
      ["minimum out", { to: own.to, data: sodaxSwapTx({ ...PLAN, minOut: 1n }).tx.data, value: 0n }],
      ["paid out elsewhere", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, dstAddress: OTHER })), value: 0n }],
      ["another network", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, dstChain: 2n })), value: 0n }],
      ["a solver", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, solver: getAddress(OTHER) })), value: 0n }],
      ["partial fill", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, allowPartialFill: true })), value: 0n }],
      ["more intent data", { to: own.to, data: withIntent(PLAN, (i) => ({ ...i, data: `${i.data}00` })), value: 0n }],
      ["deadline passed", { to: own.to, data: sodaxSwapTx({ ...PLAN, deadline: NOW_S }).tx.data, value: 0n }],
      ["deadline too far", { to: own.to, data: sodaxSwapTx({ ...PLAN, deadline: NOW_S + 3601n }).tx.data, value: 0n }],
      ["another contract", { to: OTHER, data: own.data, value: 0n }],
      ["a value", { to: own.to, data: own.data, value: "0x1" }],
      ["no data", { to: own.to, value: 0n }],
      ["not a SODAX call", { to: own.to, data: "0xdeadbeef", value: 0n }],
    ];
    for (const [why, tx] of cases) {
      expect(refusal(() => check(tx)), why).toMatchObject({
        code: "swap/intent-mismatch",
        userMessage: "This swap doesn't match what you asked for, so Test Wallet stopped it. Nothing was signed.",
      });
    }
    // Still in the hour, but planned for another deadline: not this plan.
    const planned = sodaxSwapTx({ ...PLAN, deadline: NOW_S + 900n }).tx;
    expect(refusal(() => check({ to: planned.to, data: planned.data, value: 0n })).code).toBe("swap/intent-mismatch");
  });

  it("selling the native coin moves it as the transaction's value", () => {
    const plan = { ...PLAN, sellToken: SODAX_NATIVE, gross: 10n ** 18n, fee: clipFeeOn(10n ** 18n) };
    const tx = sodaxSwapTx(plan).tx;
    expect(tx.value).toBe(10n ** 18n);
    expect(check({ to: tx.to, data: tx.data, value: "0xde0b6b3a7640000" }, plan).fee).toBe(8_750_000_000_000_000n);
    expect(refusal(() => check({ to: tx.to, data: tx.data, value: 0n }, plan)).code).toBe("swap/intent-mismatch");
  });
});

/* ------------------------------------------------------------------ through the swap service */

describe("SODAX through SwapService", () => {
  const usdc = usdcEvm(BASE_MAINNET);
  const eth = ethOn(ARBITRUM);
  const setup = (submit?: (body: Record<string, unknown>) => unknown) => {
    const { fetch, calls } = server({ submit });
    const host = fakeHost({ networks: [BASE_MAINNET, ARBITRUM], assets: [usdc, eth], balances: [{ asset: usdc, amount: "500000000" }], fetch });
    const s = new SodaxSwap({ serverUrl: SERVER, feeReceiver: FAKE_RECEIVER, walletName: "Test Wallet", testnet: false, receivers: [FAKE_RECEIVER], kv: host.kv, now: () => NOW, sleep: async () => {} });
    return { host, calls, svc: new SwapService(host, [s]) };
  };
  const HASH = (b: string) => `0x${b.repeat(32)}`;

  it("quotes across networks with the Clip fee and where it arrives, apart from any network fee", async () => {
    const { svc } = setup();
    const v = await svc.quote({ sell: "usdc", buy: "eth", amount: "100" });
    expect(v).toMatchObject({
      provider: "SODAX",
      youGet: "You get ~0.0025 ETH",
      atLeast: "At least 0.002487 ETH, or the order isn't filled",
      sell: { display: "100 USDC", amount: "100000000" },
      clipFee: { pct: 0.875, amount: "875000", display: "0.875 USDC", name: "Clip", receivedBy: "ColdAI LLC" },
      arrivesOn: { networkId: ARBITRUM.id, name: "Arbitrum One" },
      steps: ["Allow SODAX to use exactly 100 USDC", "Swap"],
      executable: true,
      networkId: BASE_MAINNET.id,
    });
  });

  it("never stands in for a same-network swap", async () => {
    const { fetch } = server();
    const host = fakeHost({ networks: [BASE_MAINNET], assets: [usdc, ethOn(BASE_MAINNET)], balances: [{ asset: usdc, amount: "500000000" }], fetch });
    await expect(new SwapService(host, [sodax()]).quote({ sell: "usdc", buy: "eth", amount: "100" })).rejects.toMatchObject({ code: "swap/no-route" });
  });

  it("a server with a fee of its own stops the quote in the same words as one that isn't set up", async () => {
    for (const [config, code] of [
      [{ ...FEE_FREE, tradingEnabled: false }, "swap/server-not-ready"],
      [{ ...FEE_FREE, partnerFeeBps: 25, feeReceiver: OTHER }, "swap/server-fee"],
    ] as const) {
      const { fetch } = server({ config });
      const host = fakeHost({ networks: [BASE_MAINNET, ARBITRUM], assets: [usdc, eth], balances: [{ asset: usdc, amount: "500000000" }], fetch });
      await expect(new SwapService(host, [sodax()]).quote({ sell: "usdc", buy: "eth", amount: "100" })).rejects.toMatchObject({
        code,
        userMessage: "Swapping isn't available right now.",
      });
    }
  });

  it("after the permission is in a block it queues the swap, then hands the sent swap to SODAX", async () => {
    const { svc, host, calls } = setup();
    const v = await svc.quote({ sell: "usdc", buy: "eth", amount: "100" });
    await svc.execute(v.id);
    expect(host.enqueued).toHaveLength(1);
    host.enqueued[0]!.resolve(HASH("aa"));
    await flush();
    expect(calls.some((c) => c.method === "eth_getTransactionReceipt" && (c.params as string[])[0] === HASH("aa"))).toBe(true);
    expect(host.enqueued).toHaveLength(2);
    const swap = host.enqueued[1]!.request;
    host.enqueued[1]!.resolve(HASH("bb"));
    await flush();
    const submitted = calls.filter((c) => c.url.endsWith("/sodax/swaps/submit-tx")).map((c) => JSON.parse(String(c.init!.body)));
    const tx = (swap.params as { data: string }[])[0]!;
    const { intent } = decodeSodaxSwap(tx.data);
    expect(submitted).toEqual([
      {
        txHash: HASH("bb"),
        srcChainKey: "0x2105.base",
        walletAddress: getAddress(ME_EVM),
        intent: expect.objectContaining({ intentId: intent.intentId.toString(), inputAmount: "99125000", minOutputAmount: "2487500000000000", srcChain: "30", dstChain: "23", data: intent.data }),
        relayData: expect.stringMatching(/^0x[0-9a-f]+$/),
      },
    ]);
    expect(host.store.get("features:sodax:pending-submits")).toEqual([]);
  });

  it("the review shows the Clip fee even when the network can't dry-run the swap; other bytes lose it", async () => {
    const { svc, host } = setup();
    const v = await svc.quote({ sell: "usdc", buy: "eth", amount: "100" });
    await svc.execute(v.id);
    host.enqueued[0]!.resolve(HASH("aa"));
    await flush();
    const swap = host.enqueued[1]!.request;
    // What the EVM module reads from a call it doesn't know: unreadable, with its own lines.
    const read: DecodedRequest = {
      requestId: swap.id,
      title: "Unreadable request from Test Wallet",
      lines: [{ label: "Requested by", value: "Test Wallet" }],
      balanceChanges: [],
      simulated: true,
      blind: true,
      warnings: [{ level: "danger", code: "blind-signing", message: "We can't read what this does." }],
      networkId: BASE_MAINNET.id,
    };
    // A clean dry run: the plain title, the fee first.
    const lifted = refineDecoded(swap, read);
    expect(lifted).toMatchObject({ blind: false, title: "Swap 100 USDC for ~0.0025 ETH" });
    expect(lifted.lines[0]).toMatchObject({ label: "Clip fee", value: "0.875% · 0.875 USDC" });
    // No dry run: still unreadable (blocked unless blind signing is allowed), and the fee still shows.
    const unsimulated = refineDecoded(swap, { ...read, simulated: false });
    expect(unsimulated).toMatchObject({ blind: true, title: read.title });
    expect(unsimulated.lines.map((l) => l.label)).toEqual(["Clip fee", "Fee goes to", "You get at least", "Arrives on", "Requested by"]);
    // Bytes that aren't the plan prove nothing: only what the module read.
    const tx = (swap.params as { data: string }[])[0]!;
    tx.data = `${tx.data}00`;
    expect(refineDecoded(swap, { ...read, simulated: false }).lines).toEqual(read.lines);
    expect(refineDecoded(swap, read)).toMatchObject({ blind: true, lines: read.lines });
  });

  it("a hand-over that doesn't go through is kept on the device and retried with the next quote", async () => {
    let up = false;
    const { svc, host, calls } = setup(() => ({ success: up }));
    const v = await svc.quote({ sell: "usdc", buy: "eth", amount: "100" });
    await svc.execute(v.id);
    host.enqueued[0]!.resolve(HASH("aa"));
    await flush();
    host.enqueued[1]!.resolve(HASH("bb"));
    await flush();
    const submits = () => calls.filter((c) => c.url.endsWith("/sodax/swaps/submit-tx")).length;
    expect(submits()).toBe(3);
    expect(host.store.get("features:sodax:pending-submits")).toMatchObject([{ at: NOW, body: { txHash: HASH("bb") } }]);
    up = true;
    await svc.quote({ sell: "usdc", buy: "eth", amount: "100" });
    await flush();
    expect(submits()).toBe(4);
    expect(host.store.get("features:sodax:pending-submits")).toEqual([]);
  });
});
