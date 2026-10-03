import { HEDERA_TESTNET } from "@clip-wallet/chains-hedera";
import { decodeFunctionData, encodeFunctionResult, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { FACTORY_ABI, NPM_ABI } from "../src/lp/abi.js";
import { Q96 } from "../src/lp/math.js";
import { saucerSwapPositions, uniswapPositions } from "../src/lp/readers.js";
import { BASE_MAINNET, ME_HEDERA, accountFor, mirrorAccount, mockFetch } from "./helpers.js";

const word = (v: bigint) => (v < 0n ? (1n << 256n) + v : v).toString(16).padStart(64, "0");
const SLOT0 = `0x${word(Q96)}${word(0n)}${"0".repeat(64 * 5)}`;
const POOL = "0x00000000000000000000000000000000000000aa";
const T0 = "0x0000000000000000000000000000000000000b01";
const T1 = "0x0000000000000000000000000000000000000b02";
const FACTORY = "0x00000000000000000000000000000000000000ff";

/** Answers v3 reads by decoding the call data. */
function v3Answer(to: string, data: `0x${string}`, positions: Record<string, unknown[]>): `0x${string}` {
  if (data.startsWith("0x3850c7bd")) return SLOT0 as `0x${string}`;
  try {
    const d = decodeFunctionData({ abi: NPM_ABI, data });
    if (d.functionName === "balanceOf") return encodeFunctionResult({ abi: NPM_ABI, functionName: "balanceOf", result: BigInt(Object.keys(positions).length) });
    if (d.functionName === "tokenOfOwnerByIndex") return encodeFunctionResult({ abi: NPM_ABI, functionName: "tokenOfOwnerByIndex", result: BigInt(Object.keys(positions)[Number(d.args[1])]!) });
    if (d.functionName === "factory") return encodeFunctionResult({ abi: NPM_ABI, functionName: "factory", result: FACTORY });
    if (d.functionName === "positions") return encodeFunctionResult({ abi: NPM_ABI, functionName: "positions", result: positions[String(d.args[0])] as never });
  } catch {
    /* not NPM */
  }
  try {
    decodeFunctionData({ abi: FACTORY_ABI, data });
    return encodeFunctionResult({ abi: FACTORY_ABI, functionName: "getPool", result: POOL });
  } catch {
    /* not factory */
  }
  const e = decodeFunctionData({ abi: erc20Abi, data });
  if (e.functionName === "symbol") return encodeFunctionResult({ abi: erc20Abi, functionName: "symbol", result: to.toLowerCase().endsWith("b01") ? "USDC" : "WETH" });
  return encodeFunctionResult({ abi: erc20Abi, functionName: "decimals", result: 6 });
}

const pos = (liquidity: bigint, owed0 = 0n, owed1 = 0n, t0 = T0, t1 = T1) => [0n, "0x0000000000000000000000000000000000000000", t0, t1, 3000, -600, 600, liquidity, 0n, 0n, owed0, owed1];

describe("LP positions (read-only)", () => {
  it("Uniswap v3: reads NonfungiblePositionManager on-chain, skips closed positions", async () => {
    const positions = { "11": pos(10n ** 12n, 1_000_000n, 0n), "12": pos(0n) };
    const { fetch, calls } = mockFetch([], { eth_call: (p) => v3Answer((p[0] as { to: string }).to, (p[0] as { data: `0x${string}` }).data, positions) });
    const list = await uniswapPositions({ network: BASE_MAINNET, account: accountFor(BASE_MAINNET), fetch }, (k) => ({ usdc: 1 })[k], (a) => (a.toLowerCase().endsWith("b01") ? "usdc" : undefined));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ app: "Uniswap", pair: "USDC / WETH", inRange: true, status: "Earning fees", url: "https://app.uniswap.org/positions/v3/11" });
    expect(list[0]!.fees).toBe("At least 1 USDC + 0 WETH waiting to be collected");
    expect(calls[0]!.params![0]).toMatchObject({ to: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" });
  });

  it("SaucerSwap V2: finds SSV2-LP NFTs on the mirror node and reads them via contracts/call", async () => {
    const whbar = `0x${(15058).toString(16).padStart(40, "0")}`;
    const sauce = `0x${(1183558).toString(16).padStart(40, "0")}`;
    const positions = { "42": pos(10n ** 10n, 0n, 0n, whbar, sauce) };
    const { fetch, calls } = mockFetch([
      [/\/accounts\/0\.0\.1001\/nfts\?token\.id=0\.0\.1310436/, { nfts: [{ serial_number: 42 }], links: { next: null } }],
      [/\/accounts\/0\.0\.1001/, mirrorAccount(ME_HEDERA)],
      [/\/api\/v1\/tokens\/0\.0\.1183558/, { token_id: "0.0.1183558", symbol: "SAUCE", name: "SAUCE", decimals: "6", type: "FUNGIBLE_COMMON" }],
      [/\/contracts\/call/, (_u: string, init?: RequestInit) => {
        const b = JSON.parse(String(init!.body)) as { to: string; data: `0x${string}` };
        return { result: v3Answer(b.to, b.data, positions) };
      }],
    ]);
    const list = await saucerSwapPositions({ network: HEDERA_TESTNET, account: accountFor(HEDERA_TESTNET), fetch }, (k) => ({ hbar: 0.25 })[k]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ app: "SaucerSwap", pair: "HBAR / SAUCE", inRange: true });
    expect(list[0]!.holdings).toMatch(/HBAR \+ .* SAUCE$/);
    const firstCall = calls.find((c) => c.url.endsWith("/contracts/call"))!;
    expect(JSON.parse(String(firstCall.init!.body)).to).toBe(`0x${(1308184).toString(16).padStart(40, "0")}`);
  });

  it("no positions → empty, never an error", async () => {
    const { fetch } = mockFetch([[/\/nfts/, { nfts: [], links: { next: null } }], [/\/accounts\//, mirrorAccount(ME_HEDERA)]]);
    expect(await saucerSwapPositions({ network: HEDERA_TESTNET, account: accountFor(HEDERA_TESTNET), fetch })).toEqual([]);
  });
});
