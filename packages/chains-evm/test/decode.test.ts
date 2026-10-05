import type { DappRequest, DecodedRequest } from "@clip-wallet/core";
import { encodeAbiParameters, getAddress, encodeFunctionData, erc20Abi, maxUint256, numberToHex, parseAbi, stringToHex, toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";
import { createEvmModule } from "../src/module.js";
import { NATIVE_PSEUDO_TOKEN, TRANSFER_TOPIC, addressTopic } from "../src/simulate.js";
import { PERMIT_TYPED, SEPOLIA_STATE, TYPED } from "./fixtures.js";
import { BOB, ME, type MockSpec, RpcErr, SEPOLIA, SEPOLIA_USDC, ctxFor, mockFetch } from "./helpers.js";

const mod = createEvmModule();
const UNI = getAddress("0x66a9893cc07d91d95644aedd05d03f95e1dba8af"); // Uniswap Universal Router (KNOWN_APPS)
const UNKNOWN_TOKEN = "0x00000000000000000000000000000000000a11ce";
const NFT = "0x00000000000000000000000000000000000000f7";

const h = (s: string) => s as `0x${string}`;
const abiString = (s: string) => encodeAbiParameters([{ type: "string" }], [s]);
const abiUint = (n: bigint | number) => encodeAbiParameters([{ type: "uint256" }], [BigInt(n)]);

/** eth_call router for token metadata: USDC-like unknown token and an NFT collection (no decimals()). */
function tokenCalls(params: unknown[]) {
  const { to, data } = params[0] as { to: string; data: string };
  const t = to.toLowerCase();
  const s = data.slice(0, 10);
  if (t === UNKNOWN_TOKEN) {
    if (s === "0x95d89b41") return abiString("PEPE");
    if (s === "0x06fdde03") return abiString("Pepe");
    if (s === "0x313ce567") return abiUint(18);
  }
  if (t === NFT) {
    if (s === "0x95d89b41") return abiString("APE");
    if (s === "0x06fdde03") return abiString("Cool Apes");
    if (s === "0x313ce567") return new RpcErr(3, "execution reverted");
  }
  return "0x";
}

function spec(extra: MockSpec["rpc"] = {}): MockSpec {
  return { rpc: { ...SEPOLIA_STATE.rpc, eth_call: tokenCalls, ...extra } };
}

const tx = (p: Record<string, unknown>, origin = "https://app.example.com"): DappRequest => ({
  id: "r1",
  origin,
  via: "injected",
  family: "evm",
  networkId: SEPOLIA,
  method: "eth_sendTransaction",
  params: [{ from: ME, ...p }],
});

async function decode(req: DappRequest, s: MockSpec = spec()): Promise<DecodedRequest> {
  return mod.decode(req, ctxFor(SEPOLIA, mockFetch(s)));
}

const codes = (d: DecodedRequest) => d.warnings.map((w) => w.code);
const NO_RAW_METHOD = /eth_|transferFrom|approve\(|setApprovalForAll|0x[0-9a-f]{8}\b/;

describe("decode eth_sendTransaction", () => {
  it("native transfer, plain title, fee in ETH", async () => {
    const d = await decode(tx({ to: BOB, value: numberToHex(25n * 10n ** 15n) }));
    expect(d.title).toBe("Send 0.025 ETH to 0x1234…5678");
    expect(d.blind).toBe(false);
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "eth-testnet" }), delta: "-25000000000000000" }]);
    // gas 21000 * 1.2 * (base 1 gwei + tip 1 gwei)
    expect(d.fee).toEqual({ asset: expect.objectContaining({ symbol: "ETH" }), amount: (25200n * 2_000_000_000n).toString() });
    // eth_simulateV1 not available in the mock → fallback, flagged
    expect(d.simulated).toBe(false);
    expect(codes(d)).toEqual(["simulation-failed"]);
    expect(d.warnings[0]!.level).toBe("caution");
  });

  it("ERC-20 transfer of curated USDC", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BOB, 25_000_000n] });
    const d = await decode(tx({ to: SEPOLIA_USDC, data }));
    expect(d.title).toBe("Send 25 USDC to 0x1234…5678");
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ key: "usdc", address: SEPOLIA_USDC }), delta: "-25000000" }]);
    expect(d.title).not.toMatch(NO_RAW_METHOD);
  });

  it("ERC-20 transfer of an unknown token reads symbol/decimals from the contract", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [BOB, 1500n * 10n ** 18n] });
    const d = await decode(tx({ to: UNKNOWN_TOKEN, data }));
    expect(d.title).toBe("Send 1,500 PEPE to 0x1234…5678");
    expect(d.balanceChanges[0]!.asset.key).toBe(`${SEPOLIA}/${UNKNOWN_TOKEN}`);
  });

  it("transferFrom someone else to someone", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [BOB, ME, 1_000_000n] });
    const d = await decode(tx({ to: SEPOLIA_USDC, data }));
    expect(d.title).toBe("Move 1 USDC from 0x1234…5678 to 0x9858…da94");
    expect(d.balanceChanges[0]!.delta).toBe("1000000");
  });

  it("transferFrom on an NFT contract (shared selector) reads as an NFT send", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [ME, BOB, 42n] });
    const d = await decode(tx({ to: NFT, data }));
    expect(d.title).toBe("Send NFT #42 from Cool Apes to 0x1234…5678");
  });

  it("unlimited approve → danger warning, app named", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [UNI, maxUint256] });
    const d = await decode(tx({ to: SEPOLIA_USDC, data }));
    expect(d.title).toBe("Allow Uniswap to spend all your USDC");
    expect(d.warnings.find((w) => w.code === "unlimited-approval")?.level).toBe("danger");
    // Translatable: same English as the fallback, values are data.
    expect(d.titleMsg).toEqual({ id: "bg.req.allowSpendAll", values: { spender: "Uniswap", symbol: "USDC" }, fallback: d.title });
    const w = d.warnings.find((x) => x.code === "unlimited-approval")!;
    expect(w.msg).toMatchObject({ id: "bg.warn.letsTakeAll", fallback: w.message });
  });

  it("limited approve and revoke", async () => {
    const lim = await decode(tx({ to: SEPOLIA_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [BOB, 5_000_000n] }) }));
    expect(lim.title).toBe("Allow 0x1234…5678 to spend up to 5 USDC");
    expect(codes(lim)).not.toContain("unlimited-approval");
    const rev = await decode(tx({ to: SEPOLIA_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [UNI, 0n] }) }));
    expect(rev.title).toBe("Stop Uniswap from spending your USDC");
  });

  it("setApprovalForAll → approval-for-all danger", async () => {
    const abi = parseAbi(["function setApprovalForAll(address operator, bool approved)"]);
    const d = await decode(tx({ to: NFT, data: encodeFunctionData({ abi, functionName: "setApprovalForAll", args: [BOB, true] }) }));
    expect(d.title).toBe("Allow 0x1234…5678 to move all your Cool Apes NFTs");
    expect(d.warnings.find((w) => w.code === "approval-for-all")?.level).toBe("danger");
    const off = await decode(tx({ to: NFT, data: encodeFunctionData({ abi, functionName: "setApprovalForAll", args: [BOB, false] }) }));
    expect(off.title).toBe("Stop 0x1234…5678 from moving your Cool Apes NFTs");
    expect(codes(off)).not.toContain("approval-for-all");
  });

  it("ERC-721 safeTransferFrom", async () => {
    const abi = parseAbi(["function safeTransferFrom(address from, address to, uint256 tokenId)"]);
    const d = await decode(tx({ to: NFT, data: encodeFunctionData({ abi, functionName: "safeTransferFrom", args: [ME, BOB, 7n] }) }));
    expect(d.title).toBe("Send NFT #7 from Cool Apes to 0x1234…5678");
  });

  it("known selector from the bundled table → plain action, not blind", async () => {
    const abi = parseAbi(["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"]);
    const data = encodeFunctionData({ abi, functionName: "swapExactTokensForTokens", args: [1n, 2n, [SEPOLIA_USDC, UNKNOWN_TOKEN], ME, 9n] });
    const d = await decode(tx({ to: BOB, data }, "https://swap.example.org"));
    expect(d.title).toBe("Swap tokens on swap.example.org");
    expect(d.blind).toBe(false);
    const viaUni = await decode(tx({ to: UNI, data: toFunctionSelector("function execute(bytes,bytes[],uint256)") + encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }, { type: "uint256" }], ["0x00", [], 1n]).slice(2) }));
    expect(viaUni.title).toBe("Swap tokens on Uniswap");
  });

  it("unknown calldata → blind with danger warning", async () => {
    const d = await decode(tx({ to: BOB, data: "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001" }));
    expect(d.blind).toBe(true);
    expect(d.warnings.find((w) => w.code === "blind-signing")?.level).toBe("danger");
    expect(d.title).toBe("Approve an unreadable request from app.example.com");
  });

  it("contract call with value shows the extra native amount", async () => {
    const d = await decode(tx({ to: BOB, value: numberToHex(10n ** 18n), data: toFunctionSelector("function deposit()") }));
    expect(d.title).toBe("Deposit on app.example.com");
    expect(d.lines).toContainEqual({ label: "Also sends", value: "1 ETH" });
    expect(d.balanceChanges).toEqual([{ asset: expect.objectContaining({ symbol: "ETH" }), delta: "-1000000000000000000" }]);
  });

  it("uses eth_simulateV1 balance changes (native + token in, token out)", async () => {
    const data = h(toFunctionSelector("function swapExactTokensForETH(uint256,uint256,address[],address,uint256)") + "00".repeat(32 * 5));
    const logs = [
      { address: SEPOLIA_USDC, topics: [TRANSFER_TOPIC, addressTopic(ME), addressTopic(BOB)], data: numberToHex(100_000_000n, { size: 32 }) },
      { address: NATIVE_PSEUDO_TOKEN, topics: [TRANSFER_TOPIC, addressTopic(BOB), addressTopic(ME)], data: numberToHex(3n * 10n ** 16n, { size: 32 }) },
      { address: NFT, topics: [TRANSFER_TOPIC, addressTopic(BOB), addressTopic(ME), numberToHex(9n, { size: 32 })], data: "0x" },
    ];
    const d = await decode(
      tx({ to: BOB, data }),
      spec({ eth_simulateV1: [{ calls: [{ status: "0x1", gasUsed: "0x30d40", logs }] }] }),
    );
    expect(d.simulated).toBe(true);
    expect(codes(d)).not.toContain("simulation-failed");
    expect(d.balanceChanges).toEqual([
      { asset: expect.objectContaining({ key: "usdc" }), delta: "-100000000" },
      { asset: expect.objectContaining({ key: "eth-testnet" }), delta: "30000000000000000" },
    ]);
    expect(d.lines).toContainEqual({ label: "You receive", value: expect.stringMatching(/^NFT #9 from/) });
    expect(d.fee?.amount).toBe(((200_000n * 12n) / 10n * 2_000_000_000n).toString());
  });

  it("simulateV1 says it reverts → danger simulation-failed", async () => {
    const d = await decode(
      tx({ to: BOB, value: "0x1" }),
      spec({ eth_simulateV1: [{ calls: [{ status: "0x0", gasUsed: "0x5208", logs: [], error: { message: "execution reverted: expired" } }] }] }),
    );
    const w = d.warnings.find((x) => x.code === "simulation-failed")!;
    expect(w.level).toBe("danger");
    expect(w.message).toContain("expired");
  });

  it("fallback eth_call revert → danger simulation-failed", async () => {
    const d = await decode(tx({ to: BOB, value: "0x1" }), { rpc: { ...SEPOLIA_STATE.rpc, eth_call: new RpcErr(3, "execution reverted") } });
    expect(d.warnings.find((x) => x.code === "simulation-failed")?.level).toBe("danger");
  });
});

describe("decode personal_sign", () => {
  const ps = (message: string, origin = "https://app.example.com"): DappRequest => ({
    id: "p", origin, via: "injected", family: "evm", networkId: SEPOLIA, method: "personal_sign", params: [message, ME],
  });

  it("shows the text", async () => {
    const d = await decode(ps(stringToHex("Welcome! Sign to continue.")));
    expect(d.title).toBe("Sign a message for app.example.com");
    expect(d.lines[0]).toEqual({ label: "Message", value: "Welcome! Sign to continue." });
    expect(d.warnings).toEqual([]);
  });

  it("accepts [address, message] order too", async () => {
    const d = await mod.decode({ ...ps("hi"), params: [ME, "hi"] }, ctxFor(SEPOLIA, mockFetch({})));
    expect(d.lines[0]!.value).toBe("hi");
  });

  const siwe = (domain: string) =>
    `${domain} wants you to sign in with your Ethereum account:\n${ME}\n\nSign in.\n\nURI: https://${domain}\nVersion: 1\nChain ID: 11155111\nNonce: abcdef12\nIssued At: 2026-10-03T00:00:00Z`;

  it("SIWE → Sign in to <domain>", async () => {
    const d = await decode(ps(stringToHex(siwe("app.example.com"))));
    expect(d.title).toBe("Sign in to app.example.com");
    expect(codes(d)).not.toContain("domain-mismatch");
  });

  it("SIWE for a different domain → domain-mismatch danger", async () => {
    const d = await decode(ps(stringToHex(siwe("bank.example.net")), "https://evil.example.com"));
    expect(d.title).toBe("Sign in to bank.example.net");
    expect(d.warnings.find((w) => w.code === "domain-mismatch")?.level).toBe("danger");
  });

  it("binary data is shown as data with a caution", async () => {
    const d = await decode(ps("0x" + "ff00".repeat(16)));
    expect(d.title).toBe("Sign data for app.example.com");
    expect(codes(d)).toContain("blind-signing");
  });

  it("rejects a request for another account", async () => {
    await expect(mod.decode({ ...ps("hi"), params: ["hi", BOB] }, ctxFor(SEPOLIA, mockFetch({})))).rejects.toMatchObject({ code: "wrong-account" });
  });
});

describe("decode eth_signTypedData_v4", () => {
  it("EIP-2612 Permit (unlimited, to Permit2) → permit + unlimited warnings", async () => {
    const d = await decode(TYPED);
    expect(d.title).toBe("Allow Uniswap Permit2 to spend all your USDC");
    expect(d.warnings.find((w) => w.code === "permit")?.level).toBe("danger");
    expect(codes(d)).toContain("unlimited-approval");
    expect(d.lines).toContainEqual({ label: "Permission expires", value: "2030-01-01T00:00:00Z" });
  });

  it("Permit2 PermitSingle with a limited amount → caution permit", async () => {
    const td = {
      types: {
        PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
        PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
      },
      primaryType: "PermitSingle",
      domain: { name: "Permit2", chainId: 11155111, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      message: { details: { token: SEPOLIA_USDC, amount: "12500000", expiration: "1893456000", nonce: "0" }, spender: UNI, sigDeadline: "1893456000" },
    };
    const d = await decode({ ...TYPED, params: [ME, td] });
    expect(d.title).toBe("Allow Uniswap to spend 12.5 USDC");
    expect(d.warnings.find((w) => w.code === "permit")?.level).toBe("caution");
  });

  it("generic typed data shows domain and key fields", async () => {
    const td = {
      types: { Order: [{ name: "maker", type: "address" }, { name: "price", type: "uint256" }] },
      primaryType: "Order",
      domain: { name: "Example Market", version: "1", chainId: 1, verifyingContract: BOB },
      message: { maker: ME, price: "100" },
    };
    const d = await decode({ ...TYPED, params: [ME, JSON.stringify(td)] });
    expect(d.title).toBe("Sign a message for app.example.com");
    expect(d.lines).toContainEqual({ label: "App", value: "Example Market" });
    expect(d.lines).toContainEqual({ label: "Price", value: "100" });
    expect(d.warnings.find((w) => w.code === "network-matters")).toBeTruthy(); // chainId 1 ≠ Sepolia
  });

  it("matches the fixture domain", () => {
    expect(PERMIT_TYPED.domain.chainId).toBe(11155111);
  });
});

describe("decode eth_sign", () => {
  it("is blind and refused", async () => {
    const d = await decode({ ...TYPED, method: "eth_sign", params: [ME, "0x" + "11".repeat(32)] });
    expect(d.blind).toBe(true);
    expect(d.warnings[0]).toMatchObject({ level: "danger", code: "blind-signing" });
  });
});

describe("plain language", () => {
  it("no title contains a raw method name", async () => {
    const reqs = [
      tx({ to: SEPOLIA_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [UNI, maxUint256] }) }),
      tx({ to: SEPOLIA_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transferFrom", args: [BOB, ME, 1n] }) }),
      tx({ to: BOB, data: toFunctionSelector("function multicall(bytes[])") + encodeAbiParameters([{ type: "bytes[]" }], [[]]).slice(2) }),
    ];
    for (const r of reqs) expect((await decode(r)).title).not.toMatch(NO_RAW_METHOD);
  });
});
