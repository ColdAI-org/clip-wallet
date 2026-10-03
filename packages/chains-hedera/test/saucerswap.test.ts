import type { DappRequest } from "@clip-wallet/core";
import { AccountId, Client, ContractExecuteTransaction, ContractId, Hbar, type Transaction, TransactionId } from "@hiero-ledger/sdk";
import { encodeFunctionData, encodePacked, parseAbi } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import { SAUCERSWAP, aliasAddress, clearMirrorCache, createHederaModule, decodeSaucerSwap, hbarAsset, selectorOf } from "../src/index.js";
import { b64encode } from "../src/util.js";
import { SAUCE, USDC, ctxFor, makeAccount, mockFetch } from "./helpers.js";
import { FIX } from "./signatures.js";

/** ABIs as published in saucerswaplabs/saucerswap-periphery and saucerswaplabs-v2-periphery (encoded here with viem, independently of the decoder). */
const V1 = parseAbi([
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline) returns (uint[] amounts)",
  "function swapTokensForExactETH(uint amountOut, uint amountInMax, address[] path, address to, uint deadline) returns (uint[] amounts)",
]);
const V2 = parseAbi([
  "struct ExactInputParams { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }",
  "struct ExactOutputParams { bytes path; address recipient; uint256 deadline; uint256 amountOut; uint256 amountInMaximum; }",
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInput(ExactInputParams params) payable returns (uint256 amountOut)",
  "function exactOutput(ExactOutputParams params) payable returns (uint256 amountIn)",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
  "function unwrapWHBAR(uint256 amountMinimum, address recipient) payable",
]);

const ME = "0.0.1001";
const evm = (id: string) => `0x${BigInt(id.split(".")[2]!).toString(16).padStart(40, "0")}` as `0x${string}`;
const T = SAUCERSWAP.testnet;
const WHBAR = evm(T.whbarToken);
const SAUCE_EVM = evm("0.0.731861");
const USDC_EVM = evm("0.0.429274");
const MY_ALIAS = aliasAddress(FIX.alicePublicKey) as `0x${string}`;
const BOB = evm("0.0.1234");
const DEADLINE = 1_900_000_000n;

const hexToBytes = (h: string) => Uint8Array.from(h.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));
const M = /^https:\/\/testnet\.mirrornode\.hedera\.com\/api\/v1/;
const r = (path: string) => new RegExp(M.source + path.replace(/\./g, "\\."));

function frozen(tx: Transaction): string {
  const c = Client.forName("testnet", { scheduleNetworkUpdate: false });
  try {
    tx.setTransactionId(TransactionId.generate(AccountId.fromString(ME))).freezeWith(c);
  } finally {
    c.close();
  }
  return b64encode(tx.toBytes());
}
const call = (router: string, data: string, hbar = 0): DappRequest => ({
  id: "s1",
  origin: "https://www.saucerswap.finance",
  via: "walletconnect",
  family: "hedera",
  networkId: "hedera:testnet",
  method: "hedera_signAndExecuteTransaction",
  params: {
    signerAccountId: `hedera:testnet:${ME}`,
    transactionList: frozen(new ContractExecuteTransaction().setContractId(ContractId.fromString(router)).setGas(300_000).setFunctionParameters(hexToBytes(data)).setPayableAmount(Hbar.fromTinybars(hbar))),
  },
});

async function decode(req: DappRequest) {
  const { fetch } = mockFetch([
    [r("/tokens/0.0.731861$"), SAUCE],
    [r("/tokens/0.0.429274$"), USDC],
  ]);
  return createHederaModule().decode(req, ctxFor(makeAccount(FIX.alicePublicKey, ME), fetch));
}

beforeEach(() => clearMirrorCache());

describe("SaucerSwap V1 (Uniswap V2 router; ETH = HBAR)", () => {
  it("swapExactETHForTokens: pays the HBAR sent, at least N SAUCE, to me", async () => {
    const data = encodeFunctionData({ abi: V1, functionName: "swapExactETHForTokens", args: [25_000_000n, [WHBAR, SAUCE_EVM], MY_ALIAS, DEADLINE] });
    const d = await decode(call(T.v1Router, data, 100 * 1e8));
    expect(d.title).toBe("Swap 100 HBAR for at least 25 SAUCE on SaucerSwap");
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: hbarAsset("hedera:testnet"), delta: "-10000000000" }]);
    expect(d.warnings).toEqual([]);
    expect(d.lines).toContainEqual({ label: "App", value: `SaucerSwap (router ${T.v1Router})` });
  });

  it("swapExactTokensForTokens through HBAR shows the route", async () => {
    const data = encodeFunctionData({ abi: V1, functionName: "swapExactTokensForTokens", args: [5_000_000n, 1_000_000n, [USDC_EVM, WHBAR, SAUCE_EVM], evm(ME), DEADLINE] });
    const d = await decode(call(T.v1Router, data));
    expect(d.title).toBe("Swap 5 USDC for at least 1 SAUCE on SaucerSwap");
    expect(d.lines).toContainEqual({ label: "Route", value: "USDC → HBAR → SAUCE" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc" }), delta: "-5000000" }]);
  });

  it("swapTokensForExactETH (exact out): up to N SAUCE for exactly M HBAR", async () => {
    const data = encodeFunctionData({ abi: V1, functionName: "swapTokensForExactETH", args: [2n * 10n ** 8n, 9_000_000n, [SAUCE_EVM, WHBAR], MY_ALIAS, DEADLINE] });
    const d = await decode(call(T.v1Router, data));
    expect(d.title).toBe("Swap up to 9 SAUCE for 2 HBAR on SaucerSwap");
  });

  it("output to someone else → danger", async () => {
    const data = encodeFunctionData({ abi: V1, functionName: "swapExactETHForTokens", args: [1n, [WHBAR, SAUCE_EVM], BOB, DEADLINE] });
    const d = await decode(call(T.v1Router, data, 1e8));
    expect(d.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "new-recipient" }));
    expect(d.lines).toContainEqual({ label: "Sends what you get to", value: "0.0.1234" });
  });
});

describe("SaucerSwap V2 (Uniswap V3 router with deadline)", () => {
  const path = (...xs: (string | number)[]) =>
    encodePacked(
      xs.map((x) => (typeof x === "number" ? "uint24" : "address")),
      xs as never,
    );

  it("exactInputSingle token → token", async () => {
    const data = encodeFunctionData({
      abi: V2,
      functionName: "exactInputSingle",
      args: [{ tokenIn: USDC_EVM, tokenOut: SAUCE_EVM, fee: 3000, recipient: MY_ALIAS, deadline: DEADLINE, amountIn: 10_000_000n, amountOutMinimum: 40_000_000n, sqrtPriceLimitX96: 0n }],
    });
    const d = await decode(call(T.v2Router, data));
    expect(d.title).toBe("Swap 10 USDC for at least 40 SAUCE on SaucerSwap");
  });

  it("multicall([exactInput, refundETH]) for HBAR in", async () => {
    const swap = encodeFunctionData({
      abi: V2,
      functionName: "exactInput",
      args: [{ path: path(WHBAR, 1500, SAUCE_EVM), recipient: MY_ALIAS, deadline: DEADLINE, amountIn: 50n * 10n ** 8n, amountOutMinimum: 12_000_000n }],
    });
    const data = encodeFunctionData({ abi: V2, functionName: "multicall", args: [[swap, encodeFunctionData({ abi: V2, functionName: "refundETH" })]] });
    const d = await decode(call(T.v2Router, data, 50 * 1e8));
    expect(d.title).toBe("Swap 50 HBAR for at least 12 SAUCE on SaucerSwap");
    expect(d.balanceChanges).toEqual([{ asset: hbarAsset("hedera:testnet"), delta: "-5000000000" }]);
    expect(d.warnings).toEqual([]);
  });

  it("multicall([exactInput → router, unwrapWHBAR(min, me)]) for HBAR out: the recipient is the unwrap target", async () => {
    const swap = encodeFunctionData({
      abi: V2,
      functionName: "exactInput",
      args: [{ path: path(SAUCE_EVM, 1500, WHBAR), recipient: evm(T.v2Router), deadline: DEADLINE, amountIn: 7_000_000n, amountOutMinimum: 3n * 10n ** 8n }],
    });
    const unwrap = encodeFunctionData({ abi: V2, functionName: "unwrapWHBAR", args: [3n * 10n ** 8n, MY_ALIAS] });
    const d = await decode(call(T.v2Router, encodeFunctionData({ abi: V2, functionName: "multicall", args: [[swap, unwrap]] })));
    expect(d.title).toBe("Swap 7 SAUCE for at least 3 HBAR on SaucerSwap");
    expect(d.warnings).toEqual([]);

    const toBob = encodeFunctionData({ abi: V2, functionName: "unwrapWHBAR", args: [1n, BOB] });
    const stolen = await decode(call(T.v2Router, encodeFunctionData({ abi: V2, functionName: "multicall", args: [[swap, toBob]] })));
    expect(stolen.warnings).toContainEqual(expect.objectContaining({ level: "danger", code: "new-recipient" }));
  });

  it("exactOutput reads the reversed path", () => {
    const data = encodeFunctionData({
      abi: V2,
      functionName: "exactOutput",
      args: [{ path: path(SAUCE_EVM, 3000, USDC_EVM), recipient: MY_ALIAS, deadline: DEADLINE, amountOut: 5_000_000n, amountInMaximum: 6_000_000n }],
    });
    expect(decodeSaucerSwap(T.v2Router, hexToBytes(data), 0n, "testnet")).toMatchObject({ tokenIn: "0.0.429274", tokenOut: "0.0.731861", exactIn: false, amountIn: 6_000_000n, amountOut: 5_000_000n });
  });

  it("multicall with anything unexpected is not treated as a swap", () => {
    const a = encodeFunctionData({ abi: V2, functionName: "refundETH" });
    expect(decodeSaucerSwap(T.v2Router, hexToBytes(encodeFunctionData({ abi: V2, functionName: "multicall", args: [[a]] })), 0n, "testnet")).toBeNull();
  });

  it("only the documented routers are decoded", () => {
    const data = encodeFunctionData({ abi: V1, functionName: "swapExactETHForTokens", args: [1n, [WHBAR, SAUCE_EVM], MY_ALIAS, DEADLINE] });
    expect(decodeSaucerSwap("0.0.5555", hexToBytes(data), 1n, "testnet")).toBeNull();
    expect(decodeSaucerSwap(SAUCERSWAP.mainnet.v1Router, hexToBytes(data), 1n, "mainnet")).toMatchObject({ version: 1, tokenIn: "0.0.15058" }); // testnet WHBAR is just a token on mainnet
  });

  it("selector table now has SaucerSwap's V2 shapes (with deadline)", () => {
    expect(selectorOf("exactInput((bytes,address,uint256,uint256,uint256))")).toBe(encodeFunctionData({ abi: V2, functionName: "exactInput", args: [{ path: "0x", recipient: MY_ALIAS, deadline: 0n, amountIn: 0n, amountOutMinimum: 0n }] }).slice(2, 10));
  });
});
