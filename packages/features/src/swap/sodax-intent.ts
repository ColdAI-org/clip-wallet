/**
 * SODAX swaps from an EVM network: the transaction the wallet builds and the check it passes before anything is
 * signed (docs/features/sodax-swaps.md). Pinned to @sodax/sdk 2.2.0 and @sodax/types 2.2.0; line numbers are in
 * their dist files.
 *
 * A swap is one call to the source network's SODAX asset manager (sdk dist/index.mjs:17361-17381, ABI :10287-10313):
 *   transfer(token, hubWallet, amount, hubCalls)
 * It moves `amount` (for the native coin, as the transaction's value) to your hub wallet on Sonic, which then runs
 * `hubCalls`, abi.encode((address,uint256,bytes)[]) of exactly two calls (:16620-16624, :25196-25232):
 *   1. sellHubAsset.approve(INTENTS, amount)
 *   2. INTENTS.createIntent(intent)
 * The intent sells `amount - fee` and pays `fee` (the Clip fee) to its receiver through `intent.data`, SODAX's single-entry
 * fee envelope encodePacked(uint8 1, abi.encode(uint256 fee, address receiver)) (:25114-25141, amount form
 * :25251-25284).
 *
 * @module
 */
import { ClipError, msg } from "@coldai/clip-wallet-core";
import {
  type Hex,
  decodeAbiParameters,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  erc20Abi,
  getAddress,
  isAddressEqual,
  parseAbi,
  parseAbiParameters,
} from "viem";
import { CLIP_FEE, isReviewedFeeReceiver, withinClipFee } from "./sodax-fee.js";

/** The intents contract on Sonic (sdk dist/index.mjs:5273-5277). */
export const SODAX_INTENTS = "0x6382D6ccD780758C5e8A6123c33ee8F4472F96ef";
/** Sonic, SODAX's hub: its RPC, the hub asset manager and the hub wallet factory (@sodax/types dist/chains/chains.js:996-1019). */
export const SONIC_RPC_URL = "https://rpc.soniclabs.com";
export const SODAX_HUB_ASSET_MANAGER = "0x60c5681bD1DB4e50735c4cA3386005A4BA4937C0";
export const SODAX_HUB_WALLET_FACTORY = "0xA0ed3047D358648F2C0583B415CffCA571FDB544";
/** SODAX's token address for an EVM network's native coin (the zero address on every EVM spoke). */
export const SODAX_NATIVE = "0x0000000000000000000000000000000000000000";
/** The deadline the wallet sets: ten minutes, as ExClip does (apps/web/src/components/TradeSheet.tsx:157). */
export const SODAX_DEADLINE_S = 600n;
/** The latest deadline the check accepts. */
export const SODAX_MAX_DEADLINE_S = 3600n;

export interface SodaxSpoke {
  /** SODAX's key for the network (@sodax/types dist/chains/chain-keys.js:15-38). */
  key: string;
  /** Relay chain id (dist/chains/chains.js:9-32): the intent's srcChain / dstChain and the hub wallet's lookup. */
  relayId: bigint;
  /** The network's SODAX asset manager: every swap from it is one call to this contract. */
  assetManager: `0x${string}`;
}

/**
 * EVM networks with a SODAX spoke that this wallet carries, by chain id (asset managers from
 * @sodax/types 2.2.0 dist/chains/chains.js, line per entry). All mainnets: SODAX has no test networks.
 */
export const SODAX_SPOKES: Readonly<Record<number, SodaxSpoke>> = {
  1: { key: "ethereum", relayId: 2n, assetManager: "0x39E77f86C1B1f3fbAb362A82b49D2E86C09659B4" }, // :909
  10: { key: "0xa.optimism", relayId: 24n, assetManager: "0x348BE44F63A458be9C1b13D6fD8e99048F297Bc3" }, // :493
  56: { key: "0x38.bsc", relayId: 4n, assetManager: "0x348BE44F63A458be9C1b13D6fD8e99048F297Bc3" }, // :508
  137: { key: "0x89.polygon", relayId: 5n, assetManager: "0x348BE44F63A458be9C1b13D6fD8e99048F297Bc3" }, // :523
  999: { key: "hyper", relayId: 26745n, assetManager: "0xAfd6A6e4287A511D3BAAd013093815268846FBb7" }, // :538
  4663: { key: "robinhood", relayId: 21071n, assetManager: "0x0df73542cC68bDC01b361d231c60F726B0e0bC05" }, // :971
  8217: { key: "0x2019.kaia", relayId: 27489n, assetManager: "0x6D2126DB97dd88AfA85127253807D04A066b6746" }, // :924
  8453: { key: "0x2105.base", relayId: 30n, assetManager: "0x348BE44F63A458be9C1b13D6fD8e99048F297Bc3" }, // :478
  42161: { key: "0xa4b1.arbitrum", relayId: 23n, assetManager: "0x348BE44F63A458be9C1b13D6fD8e99048F297Bc3" }, // :463
  43114: { key: "0xa86a.avax", relayId: 6n, assetManager: "0x5bDD1E1C5173F4c912cC919742FB94A55ECfaf86" }, // :448
};

const INTENT =
  "(uint256 intentId,address creator,address inputToken,address outputToken,uint256 inputAmount,uint256 minOutputAmount,uint256 deadline,bool allowPartialFill,uint256 srcChain,uint256 dstChain,bytes srcAddress,bytes dstAddress,address solver,bytes data)";
/** sdk dist/index.mjs:12065 (IntentsAbi createIntent). */
const INTENTS_ABI = parseAbi([`function createIntent(${INTENT} intent)`]);
const SPOKE_ABI = parseAbi(["function transfer(address token, bytes to, uint256 amount, bytes data) payable"]);
const HUB_CALLS = parseAbiParameters("(address,uint256,bytes)[]");
const FEE_DATA = parseAbiParameters("uint256 fee, address receiver");
/** Hub wallet factory (ExClip apps/wallet/src/sodax/hub.ts:29-33) and hub asset manager (sdk dist/index.mjs:7345-7368). */
const HUB_ABI = parseAbi([
  "function getDeployedAddress(uint256 chainId, bytes user) view returns (address computedAddress)",
  "function assetInfo(address asset) view returns (uint256 chainID, bytes spokeAddress)",
]);

export interface SodaxIntent {
  intentId: bigint;
  creator: `0x${string}`;
  inputToken: `0x${string}`;
  outputToken: `0x${string}`;
  inputAmount: bigint;
  minOutputAmount: bigint;
  deadline: bigint;
  allowPartialFill: boolean;
  srcChain: bigint;
  dstChain: bigint;
  srcAddress: `0x${string}`;
  dstAddress: `0x${string}`;
  solver: `0x${string}`;
  data: `0x${string}`;
}

/** Everything a SODAX swap must be, decided by the wallet before it builds the transaction. */
export interface SodaxSwapPlan {
  src: SodaxSpoke;
  dst: SodaxSpoke;
  /** Your address where you pay, and where the bought asset arrives. */
  from: string;
  to: string;
  /** The token sold on the source network, or SODAX_NATIVE for its native coin. */
  sellToken: string;
  /** Hub (Sonic) assets of the token sold and the token bought, each checked on Sonic against its spoke token. */
  sellHubAsset: string;
  buyHubAsset: string;
  /** Your hub wallet on Sonic. */
  hubWallet: string;
  /** Base units sold, the Clip fee included. */
  gross: bigint;
  fee: bigint;
  feeReceiver: string;
  minOut: bigint;
  intentId: bigint;
  deadline: bigint;
}

const hex = (s: string) => s.toLowerCase() as Hex;

/** The fee envelope for `intent.data`. */
export function sodaxFeeData(fee: bigint, receiver: string): Hex {
  return encodePacked(["uint8", "bytes"], [1, encodeAbiParameters(FEE_DATA, [fee, getAddress(receiver)])]);
}

export function sodaxIntent(p: SodaxSwapPlan): SodaxIntent {
  return {
    intentId: p.intentId,
    creator: getAddress(p.hubWallet),
    inputToken: getAddress(p.sellHubAsset),
    outputToken: getAddress(p.buyHubAsset),
    inputAmount: p.gross - p.fee,
    minOutputAmount: p.minOut,
    deadline: p.deadline,
    allowPartialFill: false,
    srcChain: p.src.relayId,
    dstChain: p.dst.relayId,
    srcAddress: hex(p.from),
    dstAddress: hex(p.to),
    solver: SODAX_NATIVE,
    data: sodaxFeeData(p.fee, p.feeReceiver),
  };
}

/** The transaction for a plan, the intent it creates and the hub calls (submit-tx's relayData). */
export function sodaxSwapTx(p: SodaxSwapPlan): { tx: { to: string; data: Hex; value: bigint }; intent: SodaxIntent; hubCalls: Hex } {
  const intent = sodaxIntent(p);
  const hubCalls = encodeAbiParameters(HUB_CALLS, [
    [
      [getAddress(p.sellHubAsset), 0n, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [SODAX_INTENTS, p.gross] })],
      [SODAX_INTENTS, 0n, encodeFunctionData({ abi: INTENTS_ABI, functionName: "createIntent", args: [intent] })],
    ],
  ]);
  const data = encodeFunctionData({ abi: SPOKE_ABI, functionName: "transfer", args: [getAddress(p.sellToken), hex(p.hubWallet), p.gross, hubCalls] });
  return { tx: { to: p.src.assetManager, data, value: isAddressEqual(getAddress(p.sellToken), SODAX_NATIVE) ? p.gross : 0n }, intent, hubCalls };
}

/** What a SODAX swap's calldata says: the amount moved and the intent, with its fee. Throws on anything else. */
export function decodeSodaxSwap(data: string): { amount: bigint; intent: SodaxIntent; fee: bigint; receiver: string } {
  const transfer = decodeFunctionData({ abi: SPOKE_ABI, data: data as Hex });
  const [, , amount, hubCalls] = transfer.args;
  const [calls] = decodeAbiParameters(HUB_CALLS, hubCalls);
  if (calls.length !== 2) throw new Error("expected two hub calls");
  const create = decodeFunctionData({ abi: INTENTS_ABI, data: calls[1]![2] });
  const intent = create.args[0] as SodaxIntent;
  // Only the single fee entry: no delivery data, no array envelope (0x, type byte 01, then two ABI words).
  if (!/^0x01[0-9a-fA-F]{128}$/.test(intent.data)) throw new Error("intent data isn't a single fee entry");
  const [fee, receiver] = decodeAbiParameters(FEE_DATA, `0x${intent.data.slice(4)}`);
  return { amount, intent, fee, receiver };
}

/**
 * The check every SODAX swap passes, on the exact bytes about to be signed:
 *   1. the fee is paid to a reviewed receiver (sodax-fee-receivers.json),
 *   2. the fee is at most 0.875 % of the amount sold (the Clip fee),
 *   3. the rest is exactly what the wallet planned: the network's asset manager, the token, the amount and value,
 *      your hub wallet, the two hub calls, the hub assets, both networks, your addresses on both, no solver, no
 *      partial fill, the minimum you get and a deadline within the hour (byte for byte against the plan's encoding).
 * Refuses in plain words, naming the wallet (`name`); nothing is signed.
 */
export function checkSodaxSwap(
  tx: { to?: string; data?: string; value?: string | bigint },
  plan: SodaxSwapPlan,
  opts: { name: string; nowSec: bigint; receivers?: readonly string[] },
): { intent: SodaxIntent; fee: bigint; receiver: string } {
  const mismatch = (why: string): never => {
    throw new ClipError(msg("bg.swap.intentMismatch", { name: opts.name }), "swap/intent-mismatch", why);
  };
  let read: ReturnType<typeof decodeSodaxSwap> | undefined;
  try {
    read = decodeSodaxSwap(tx.data ?? "0x");
  } catch {
    return mismatch("calldata");
  }
  if (!isReviewedFeeReceiver(read.receiver, opts.receivers)) {
    throw new ClipError(msg("bg.swap.feeReceiverUnknown", { name: opts.name }), "swap/fee-receiver-unknown");
  }
  if (!withinClipFee(read.fee, read.amount)) {
    throw new ClipError(msg("bg.swap.feeTooHigh", { name: CLIP_FEE.name, percent: `${CLIP_FEE.percent}%` }), "swap/fee-too-high");
  }
  if (read.intent.inputAmount + read.fee !== read.amount) mismatch("input amount");
  if (read.intent.deadline <= opts.nowSec || read.intent.deadline > opts.nowSec + SODAX_MAX_DEADLINE_S) mismatch("deadline");
  const want = sodaxSwapTx(plan).tx;
  if (!tx.to || !isAddressEqual(getAddress(tx.to), getAddress(want.to))) mismatch("to");
  let value: bigint;
  try {
    value = BigInt(tx.value ?? 0);
  } catch {
    return mismatch("value");
  }
  if (value !== want.value) mismatch("value");
  if (hex(tx.data ?? "") !== hex(want.data)) mismatch("calldata");
  return { intent: read.intent, fee: read.fee, receiver: read.receiver };
}

/** eth_call data asking Sonic for `user`'s hub wallet for swaps from `spoke` (ExClip apps/wallet/src/sodax/hub.ts:44-51). */
export function hubWalletCall(spoke: SodaxSpoke, user: string): { to: string; data: Hex } {
  return { to: SODAX_HUB_WALLET_FACTORY, data: encodeFunctionData({ abi: HUB_ABI, functionName: "getDeployedAddress", args: [spoke.relayId, hex(user)] }) };
}

/** The hub wallet in an eth_call result: exactly one ABI word holding a non-zero address. */
export function readHubWallet(result: Hex): string {
  if (result.length !== 66) throw new Error("hub wallet: unexpected result");
  const address = decodeFunctionResult({ abi: HUB_ABI, functionName: "getDeployedAddress", data: result });
  if (isAddressEqual(address, SODAX_NATIVE)) throw new Error("hub wallet: zero address");
  return getAddress(address);
}

/** eth_call data asking Sonic which spoke token a hub asset stands for. */
export function assetInfoCall(hubAsset: string): { to: string; data: Hex } {
  return { to: SODAX_HUB_ASSET_MANAGER, data: encodeFunctionData({ abi: HUB_ABI, functionName: "assetInfo", args: [getAddress(hubAsset)] }) };
}

/** Does an assetInfo result say the hub asset is `token` on `spoke`? */
export function isHubAssetOf(result: Hex, spoke: SodaxSpoke, token: string): boolean {
  try {
    const [chainId, spokeAddress] = decodeFunctionResult({ abi: HUB_ABI, functionName: "assetInfo", data: result });
    return chainId === spoke.relayId && hex(spokeAddress) === hex(token);
  } catch {
    return false;
  }
}
