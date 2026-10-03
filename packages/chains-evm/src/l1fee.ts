/**
 * OP-stack L1 data fee. On OP-stack chains a transaction pays its L2 execution gas **plus** a fee for posting
 * its data to Ethereum, charged outside `gasUsed × gasPrice`. The GasPriceOracle predeploy computes it:
 *   GasPriceOracle at 0x420000000000000000000000000000000000000F, `getL1Fee(bytes _data) view returns (uint256)`,
 *   where `_data` is the unsigned RLP-encoded transaction (the oracle adds the signature overhead itself).
 * Sources: ethereum-optimism/optimism packages/contracts-bedrock/src/L2/GasPriceOracle.sol;
 * https://docs.optimism.io/stack/transactions/fees (L1 data fee); viem's `estimateL1Fee` (viem/op-stack), whose
 * stub gas/fee values we copy so the estimate matches what wallets built on viem show.
 *
 * Which chains: those in our registry whose viem chain definition declares `contracts.gasPriceOracle` (viem 2.57):
 * OP Mainnet, Base, Ink, Soneium, Unichain, World Chain, Fraxtal, BOB, Blast, MegaETH, and the OP Sepolia /
 * Base Sepolia testnets. test/l1fee.test.ts checks this list against viem so it can't drift silently.
 */
import type { ChainContext } from "@clip-wallet/core";
import { type Hex, decodeFunctionResult, encodeFunctionData, parseAbi, parseGwei, serializeTransaction } from "viem";
import { rpc } from "./rpc.js";

export const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
export const gasPriceOracleAbi = parseAbi(["function getL1Fee(bytes _data) view returns (uint256)"]);

export const OP_STACK_CHAIN_IDS: ReadonlySet<number> = new Set([10, 8453, 57073, 1868, 130, 480, 252, 60808, 81457, 4326, 11155420, 84532]);

export function isOpStack(chainId: number): boolean {
  return OP_STACK_CHAIN_IDS.has(chainId);
}

/** L1 data fee in wei for a transaction with this to/data/value on an OP-stack chain. Throws on RPC failure. */
export async function l1DataFee(ctx: ChainContext, chainId: number, tx: { to?: string | undefined; data: Hex; value: bigint }): Promise<bigint> {
  const serialized = serializeTransaction({
    chainId,
    type: "eip1559",
    ...(tx.to ? { to: tx.to as `0x${string}` } : {}),
    data: tx.data,
    value: tx.value,
    // Same stubs as viem's estimateL1Fee: they change a few bytes, not the data length that dominates the fee.
    gas: tx.data && tx.data !== "0x" ? 300_000n : 21_000n,
    maxFeePerGas: parseGwei("5"),
    maxPriorityFeePerGas: parseGwei("1"),
    nonce: 1,
  });
  const out = await rpc<Hex>(ctx.network, ctx.fetch, "eth_call", [
    { to: GAS_PRICE_ORACLE, data: encodeFunctionData({ abi: gasPriceOracleAbi, functionName: "getL1Fee", args: [serialized] }) },
    "latest",
  ]);
  return decodeFunctionResult({ abi: gasPriceOracleAbi, functionName: "getL1Fee", data: out });
}
