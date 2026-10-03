import { decodeFunctionData, encodeAbiParameters, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { MULTICALL3, getBalances, getNfts } from "../src/balances.js";
import { BASE, ME, RpcErr, SEPOLIA, SEPOLIA_USDC, ctxFor, mockFetch } from "./helpers.js";

const BS = "https://eth-sepolia.blockscout.com/api/v2";
const SCAM = "0x00000000000000000000000000000000005ca111";
const PLAIN = "0x0000000000000000000000000000000000000abc";

describe("getBalances via Blockscout", () => {
  it("native + ERC-20 with curated keys and spam flags", async () => {
    const m = mockFetch({
      rpc: { eth_getBalance: "0xde0b6b3a7640000" },
      http: {
        [`${BS}/addresses/${ME}/token-balances`]: [
          { token: { address_hash: SEPOLIA_USDC, symbol: "USDC", name: "USDC", decimals: "6", type: "ERC-20", exchange_rate: "1.0" }, value: "25000000" },
          { token: { address_hash: SCAM, symbol: "Visit usdc-claim.com", name: "Claim rewards", decimals: "18", type: "ERC-20" }, value: "1" },
          { token: { address_hash: PLAIN, symbol: "FOO", name: "Foo", decimals: "18", type: "ERC-20", exchange_rate: "0.5" }, value: "7" },
          { token: { address_hash: PLAIN, symbol: "NFT", name: "N", decimals: null, type: "ERC-721" }, value: "1" },
          { token: { address_hash: PLAIN, symbol: "ZERO", name: "Zero", decimals: "18", type: "ERC-20" }, value: "0" },
        ],
      },
    });
    const b = await getBalances(ctxFor(SEPOLIA, m));
    expect(b).toHaveLength(4);
    expect(b[0]).toMatchObject({ asset: { key: "eth-testnet", symbol: "ETH" }, amount: "1000000000000000000" });
    expect(b[1]).toMatchObject({ asset: { key: "usdc-testnet", decimals: 6 }, amount: "25000000" });
    expect(b[1]!.asset.spam).toBeUndefined();
    expect(b[2]!.asset.spam).toBe(true);
    expect(b[3]!.asset).toMatchObject({ key: `${SEPOLIA}/${PLAIN}`, symbol: "FOO", address: getAddress(PLAIN) });
    expect(b[3]!.asset.spam).toBeUndefined();
  });

  it("a token copying a famous ticker without a price is spam; bridged USDC.e keeps its own key", async () => {
    const m = mockFetch({
      rpc: { eth_getBalance: "0x0" },
      http: {
        "/token-balances": [
          { token: { address_hash: PLAIN, symbol: "USDC", name: "USD Coin", decimals: "6", type: "ERC-20" }, value: "5" },
        ],
      },
    });
    const b = await getBalances(ctxFor(SEPOLIA, m));
    expect(b[1]!.asset.spam).toBe(true);
  });
});

describe("getBalances fallback: curated list + Multicall3", () => {
  it("reads curated tokens through aggregate3 when there is no indexer", async () => {
    const m = mockFetch({
      rpc: {
        eth_getBalance: "0x1",
        eth_call: (params: unknown[]) => {
          const { to, data } = params[0] as { to: string; data: `0x${string}` };
          expect(to).toBe(MULTICALL3);
          const abi = [{ type: "function", name: "aggregate3", stateMutability: "payable", inputs: [{ name: "c", type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "allowFailure", type: "bool" }, { name: "callData", type: "bytes" }] }], outputs: [] }] as const;
          const { args } = decodeFunctionData({ abi, data });
          const results = args[0].map((c, i) => ({ success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [i === 0 ? 42_000_000n : 0n]) }));
          return encodeAbiParameters([{ type: "tuple[]", components: [{ name: "success", type: "bool" }, { name: "returnData", type: "bytes" }] }], [results]);
        },
      },
    });
    const ctx = ctxFor(BASE, m, { indexerUrl: undefined });
    const b = await getBalances(ctx);
    expect(b).toHaveLength(2);
    expect(b[1]).toMatchObject({ asset: { key: "usdc", networkId: BASE }, amount: "42000000" });
    expect(m.gets).toEqual([]);
  });

  it("falls back to single eth_calls when Multicall3 is missing", async () => {
    const m = mockFetch({
      rpc: {
        eth_getBalance: "0x0",
        eth_call: (params: unknown[]) => {
          const { to } = params[0] as { to: string };
          if (to === MULTICALL3) return new RpcErr(3, "execution reverted");
          return encodeAbiParameters([{ type: "uint256" }], [9n]);
        },
      },
    });
    const b = await getBalances(ctxFor(SEPOLIA, m, { indexerUrl: undefined }));
    expect(b[1]).toMatchObject({ asset: { key: "usdc-testnet" }, amount: "9" });
  });
});

describe("getNfts", () => {
  it("maps Blockscout ERC-721/1155 items and follows pagination", async () => {
    const m = mockFetch({
      http: {
        "nft?type=ERC-721%2CERC-1155&page=2": {
          items: [{ id: "5", token_type: "ERC-1155", value: "3", token: { address_hash: PLAIN, name: "Badges", type: "ERC-1155" }, metadata: null }],
          next_page_params: null,
        },
        "nft?type=ERC-721%2CERC-1155": {
          items: [
            {
              id: "1",
              token_type: "ERC-721",
              image_url: "https://img.example/1.png",
              metadata: { name: "Ape #1", attributes: [{ trait_type: "Hat", value: "Red" }] },
              token: { address_hash: SCAM, name: "Cool Apes", type: "ERC-721" },
            },
            { id: "2", token_type: "ERC-721", metadata: { name: "Free airdrop at scam.xyz" }, token: { address_hash: SCAM, name: "Airdrop", type: "ERC-721" } },
          ],
          next_page_params: { page: 2 },
        },
      },
    });
    const n = await getNfts(ctxFor(SEPOLIA, m));
    expect(n).toHaveLength(3);
    expect(n[0]).toMatchObject({ standard: "erc721", tokenId: "1", name: "Ape #1", mediaUrl: "https://img.example/1.png", attributes: [{ trait: "Hat", value: "Red" }], collection: { name: "Cool Apes" } });
    expect(n[0]!.spam).toBeUndefined();
    expect(n[1]!.spam).toBe(true);
    expect(n[2]).toMatchObject({ standard: "erc1155", tokenId: "5" });
  });

  it("returns nothing without an indexer", async () => {
    expect(await getNfts(ctxFor(SEPOLIA, mockFetch({}), { indexerUrl: undefined }))).toEqual([]);
  });
});
