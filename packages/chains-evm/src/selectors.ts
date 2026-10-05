/**
 * Bundled 4byte-style selector table for common contract functions. Each entry maps a signature to a
 * plain-language action, so the approval screen never shows a raw method name. Token transfers,
 * approvals and NFT moves are decoded in decode.ts with their own wording and are not listed here.
 */
import { type AbiFunction, parseAbiItem, toFunctionSelector } from "viem";

export interface KnownFunction {
  signature: string;
  /** "Swap tokens", "Deposit into a vault" — used as "<action> on <app>". */
  action: string;
  abi: AbiFunction;
  selector: `0x${string}`;
}

const TABLE: [string, string][] = [
  ["deposit()", "Deposit"],
  ["withdraw(uint256)", "Withdraw"],
  ["swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", "Swap tokens"],
  ["swapTokensForExactTokens(uint256,uint256,address[],address,uint256)", "Swap tokens"],
  ["swapExactETHForTokens(uint256,address[],address,uint256)", "Swap tokens"],
  ["swapExactTokensForETH(uint256,uint256,address[],address,uint256)", "Swap tokens"],
  ["swapETHForExactTokens(uint256,address[],address,uint256)", "Swap tokens"],
  ["exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))", "Swap tokens"],
  ["exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", "Swap tokens"],
  ["exactInput((bytes,address,uint256,uint256))", "Swap tokens"],
  ["exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))", "Swap tokens"],
  ["execute(bytes,bytes[],uint256)", "Swap tokens"],
  ["execute(bytes,bytes[])", "Swap tokens"],
  ["multicall(bytes[])", "Run several actions"],
  ["multicall(uint256,bytes[])", "Run several actions"],
  ["aggregate3((address,bool,bytes)[])", "Run several actions"],
  ["mint(uint256)", "Mint"],
  ["mint(address,uint256)", "Mint"],
  ["safeMint(address)", "Mint"],
  ["claim()", "Claim rewards"],
  ["claimRewards()", "Claim rewards"],
  ["getReward()", "Claim rewards"],
  ["claim(address,uint256,bytes32[])", "Claim tokens"],
  ["claim(uint256,address,uint256,bytes32[])", "Claim tokens"],
  ["stake(uint256)", "Stake"],
  ["unstake(uint256)", "Unstake"],
  ["supply(address,uint256,address,uint16)", "Lend"],
  ["borrow(address,uint256,uint256,uint16,address)", "Borrow"],
  ["repay(address,uint256,uint256,address)", "Repay a loan"],
  ["withdraw(address,uint256,address)", "Withdraw"],
  ["deposit(uint256,address)", "Deposit into a vault"],
  ["redeem(uint256,address,address)", "Withdraw from a vault"],
  ["withdraw(uint256,address,address)", "Withdraw from a vault"],
  ["permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", "Submit a spending permission"],
  ["depositETH(uint32,bytes)", "Move ETH to another network"],
  ["bridgeETHTo(address,uint32,bytes)", "Move ETH to another network"],
  ["depositTransaction(address,uint256,uint64,bool,bytes)", "Move funds to another network"],
  ["register(string,address,uint256,bytes32,address,bytes[],bool,uint16)", "Register a name"],
  // Settle on Hedera (CLPRouter src/settle): SettleDeposit.deposit(Quote, sig), SettleOrderBook claims.
  ["deposit((address,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bytes32,bytes32,uint256,address,uint256,address,uint64,uint64,uint64,bytes32),bytes)", "Pay a Connector"],
  ["claimDefault(bytes32)", "Claim a late payment back"],
  ["withdrawOwed(address)", "Collect a payout"],
];

export const KNOWN_FUNCTIONS: KnownFunction[] = TABLE.map(([signature, action]) => {
  const abi = parseAbiItem(`function ${signature}`) as AbiFunction;
  return { signature, action, abi, selector: toFunctionSelector(abi) };
});

const BY_SELECTOR = new Map<string, KnownFunction>();
for (const k of KNOWN_FUNCTIONS) if (!BY_SELECTOR.has(k.selector)) BY_SELECTOR.set(k.selector, k);

export const lookupSelector = (data: string): KnownFunction | undefined => BY_SELECTOR.get(data.slice(0, 10).toLowerCase());
