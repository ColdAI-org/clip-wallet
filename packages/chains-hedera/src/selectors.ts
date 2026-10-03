import { keccak_256 } from "@noble/hashes/sha3.js";
import { hex } from "./util.js";

/**
 * Bundled function-selector table for ContractExecuteTransaction. Selectors are computed from the canonical
 * signatures at load time, so the table can't drift from the signatures it lists.
 *
 * `plain` is the plain-language verb for the approval screen.
 */
const SIGNATURES: { sig: string; plain: string }[] = [
  // ERC-20 / HIP-218 (HTS tokens behave as ERC-20 at their long-zero address)
  { sig: "transfer(address,uint256)", plain: "Send tokens" },
  { sig: "transferFrom(address,address,uint256)", plain: "Move tokens" },
  { sig: "approve(address,uint256)", plain: "Allow spending of tokens" },
  { sig: "increaseAllowance(address,uint256)", plain: "Raise a spending allowance" },
  { sig: "decreaseAllowance(address,uint256)", plain: "Lower a spending allowance" },
  // ERC-721 / HIP-376
  { sig: "setApprovalForAll(address,bool)", plain: "Allow access to all NFTs in a collection" },
  { sig: "safeTransferFrom(address,address,uint256)", plain: "Move an NFT" },
  { sig: "safeTransferFrom(address,address,uint256,bytes)", plain: "Move an NFT" },
  // HIP-719 token-facade
  { sig: "associate()", plain: "Add this token to your account" },
  { sig: "dissociate()", plain: "Remove this token from your account" },
  // HTS system contract (0x167)
  { sig: "associateToken(address,address)", plain: "Add a token to an account" },
  { sig: "associateTokens(address,address[])", plain: "Add tokens to an account" },
  { sig: "dissociateToken(address,address)", plain: "Remove a token from an account" },
  { sig: "transferToken(address,address,address,int64)", plain: "Send tokens" },
  { sig: "transferNFT(address,address,address,int64)", plain: "Send an NFT" },
  // WHBAR / WETH-style
  { sig: "deposit()", plain: "Wrap HBAR" },
  { sig: "withdraw(uint256)", plain: "Unwrap HBAR" },
  // Uniswap-v2-style routers (SaucerSwap V1 and others)
  { sig: "swapExactETHForTokens(uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapExactTokensForETH(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapETHForExactTokens(uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapTokensForExactETH(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)", plain: "Add liquidity" },
  { sig: "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)", plain: "Add liquidity" },
  { sig: "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)", plain: "Remove liquidity" },
  { sig: "removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)", plain: "Remove liquidity" },
  // Uniswap-v3-style (SaucerSwap V2)
  { sig: "multicall(bytes[])", plain: "Run several steps" },
  { sig: "multicall(uint256,bytes[])", plain: "Run several steps" },
  { sig: "exactInput((bytes,address,uint256,uint256))", plain: "Swap" },
  { sig: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", plain: "Swap" },
  { sig: "exactOutput((bytes,address,uint256,uint256))", plain: "Swap" },
  // SaucerSwap V2 SwapRouter: the original Uniswap V3 shapes, with `deadline` (saucerswaplabs-v2-periphery ISwapRouter.sol).
  // Full decoding with amounts lives in saucerswap.ts; these entries name the call for other V3-style routers.
  { sig: "exactInput((bytes,address,uint256,uint256,uint256))", plain: "Swap" },
  { sig: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", plain: "Swap" },
  { sig: "exactOutput((bytes,address,uint256,uint256,uint256))", plain: "Swap" },
  { sig: "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", plain: "Swap" },
  { sig: "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)", plain: "Swap" },
  { sig: "sweepToken(address,uint256,address)", plain: "Collect leftover tokens" },
  { sig: "refundETH()", plain: "Refund leftover HBAR" },
  { sig: "unwrapWHBAR(uint256,address)", plain: "Unwrap HBAR" },
  // Staking / misc
  { sig: "stake(uint256)", plain: "Stake" },
  { sig: "unstake(uint256)", plain: "Unstake" },
  { sig: "claim()", plain: "Claim" },
  { sig: "mint(uint256)", plain: "Mint" },
];

export interface SelectorEntry {
  selector: string;
  signature: string;
  name: string;
  plain: string;
}

export function selectorOf(signature: string): string {
  return hex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));
}

export const SELECTORS: ReadonlyMap<string, SelectorEntry> = new Map(
  SIGNATURES.map(({ sig, plain }) => {
    const selector = selectorOf(sig);
    return [selector, { selector, signature: sig, name: sig.slice(0, sig.indexOf("(")), plain }];
  }),
);

export function lookupSelector(data: Uint8Array | null | undefined): SelectorEntry | null {
  if (!data || data.length < 4) return null;
  return SELECTORS.get(hex(data.subarray(0, 4))) ?? null;
}

/** Reads the n-th 32-byte ABI word after the selector. */
export function abiWord(data: Uint8Array, n: number): Uint8Array | null {
  const start = 4 + n * 32;
  if (data.length < start + 32) return null;
  return data.subarray(start, start + 32);
}

export function abiAddress(data: Uint8Array, n: number): string | null {
  const w = abiWord(data, n);
  return w ? `0x${hex(w.subarray(12))}` : null;
}

export function abiUint(data: Uint8Array, n: number): bigint | null {
  const w = abiWord(data, n);
  return w ? BigInt(`0x${hex(w) || "0"}`) : null;
}
