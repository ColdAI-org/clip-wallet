import { CallData, cairo } from "starknet";
import { describe, expect, it } from "vitest";
import { AVNU_EXCHANGE, ETH_ADDRESS, STRK_ADDRESS, approveCall, parseApprove, parseMultiRouteSwap } from "../src/index.js";

/** multi_route_swap ABI (avnu-contracts-v2 src/exchange.cairo; Route as its Direct variant serializes). */
const ABI = [
  {
    type: "struct",
    name: "core::integer::u256",
    members: [
      { name: "low", type: "core::integer::u128" },
      { name: "high", type: "core::integer::u128" },
    ],
  },
  {
    type: "struct",
    name: "avnu::models::Route",
    members: [
      { name: "sell_token", type: "core::starknet::contract_address::ContractAddress" },
      { name: "buy_token", type: "core::starknet::contract_address::ContractAddress" },
      { name: "exchange_address", type: "core::starknet::contract_address::ContractAddress" },
      { name: "percent", type: "core::integer::u128" },
      { name: "additional_swap_params", type: "core::array::Array::<core::felt252>" },
    ],
  },
  {
    type: "function",
    name: "multi_route_swap",
    inputs: [
      { name: "sell_token_address", type: "core::starknet::contract_address::ContractAddress" },
      { name: "sell_token_amount", type: "core::integer::u256" },
      { name: "buy_token_address", type: "core::starknet::contract_address::ContractAddress" },
      { name: "buy_token_amount", type: "core::integer::u256" },
      { name: "buy_token_min_amount", type: "core::integer::u256" },
      { name: "beneficiary", type: "core::starknet::contract_address::ContractAddress" },
      { name: "integrator_fee_amount_bps", type: "core::integer::u128" },
      { name: "integrator_fee_recipient", type: "core::starknet::contract_address::ContractAddress" },
      { name: "routes", type: "core::array::Array::<avnu::models::Route>" },
    ],
    outputs: [{ type: "core::bool" }],
    state_mutability: "external",
  },
];

const ME = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";

describe("AVNU helpers", () => {
  it("parses multi_route_swap calldata that starknet.js encodes from the contract ABI", () => {
    const big = (1n << 130n) + 7n; // exercises the u256 high word
    const cd = new CallData(ABI).compile("multi_route_swap", {
      sell_token_address: STRK_ADDRESS,
      sell_token_amount: cairo.uint256(10n ** 18n),
      buy_token_address: ETH_ADDRESS,
      buy_token_amount: cairo.uint256(big),
      buy_token_min_amount: cairo.uint256(big - 5n),
      beneficiary: ME,
      integrator_fee_amount_bps: 0,
      integrator_fee_recipient: 0,
      routes: [{ sell_token: STRK_ADDRESS, buy_token: ETH_ADDRESS, exchange_address: "0x5dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b", percent: 10n ** 12n, additional_swap_params: ["0x1", "0x2"] }],
    });
    const p = parseMultiRouteSwap(cd as string[]);
    expect(p).toMatchObject({ sellAmount: 10n ** 18n, buyAmount: big, buyMinAmount: big - 5n, integratorFeeBps: 0n, routesLen: 1 });
    expect(BigInt(p.sellToken)).toBe(BigInt(STRK_ADDRESS));
    expect(BigInt(p.buyToken)).toBe(BigInt(ETH_ADDRESS));
    expect(BigInt(p.beneficiary)).toBe(BigInt(ME));
  });

  it("builds an exact approve that matches starknet.js's u256 encoding", () => {
    const c = approveCall(STRK_ADDRESS, AVNU_EXCHANGE.SN_MAIN, 123n * 10n ** 18n);
    expect(c.entrypoint).toBe("approve");
    expect(c.calldata.map((x) => BigInt(x))).toEqual(CallData.compile([AVNU_EXCHANGE.SN_MAIN, cairo.uint256(123n * 10n ** 18n)]).map((x) => BigInt(x)));
    expect(parseApprove(c.calldata)).toEqual({ spender: AVNU_EXCHANGE.SN_MAIN, amount: 123n * 10n ** 18n });
    expect(() => approveCall(STRK_ADDRESS, AVNU_EXCHANGE.SN_MAIN, 0n)).toThrow();
  });

  it("refuses truncated calldata", () => {
    expect(() => parseMultiRouteSwap(["0x1", "0x2"])).toThrow();
  });
});
