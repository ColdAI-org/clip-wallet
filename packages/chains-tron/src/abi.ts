import { evmWord, fromEvmWord } from "./address.js";
import { concat, fromHex, hex } from "./util.js";

/**
 * The TRC-20 calls Clip explains (TIP-20, same ABI as ERC-20: https://github.com/tronprotocol/tips/blob/master/tip-20.md).
 * Selectors are the first 4 bytes of keccak256 of the signature.
 */
export const SELECTORS = {
  transfer: "a9059cbb", // transfer(address,uint256)
  transferFrom: "23b872dd", // transferFrom(address,address,uint256)
  approve: "095ea7b3", // approve(address,uint256)
  balanceOf: "70a08231", // balanceOf(address)
} as const;

export type Trc20Call =
  | { kind: "transfer"; to: Uint8Array; amount: bigint }
  | { kind: "transferFrom"; from: Uint8Array; to: Uint8Array; amount: bigint }
  | { kind: "approve"; spender: Uint8Array; amount: bigint };

const word = (b: Uint8Array, i: number) => b.subarray(4 + i * 32, 4 + (i + 1) * 32);
const uint = (w: Uint8Array) => BigInt(`0x${hex(w) || "0"}`);
/** An ABI address word: 12 zero bytes then 20 bytes. */
const isAddressWord = (w: Uint8Array) => w.length === 32 && w.subarray(0, 12).every((x) => x === 0);

/** Decodes exactly-sized TRC-20 transfer / transferFrom / approve calldata; anything else is null. */
export function decodeTrc20(data: Uint8Array): Trc20Call | null {
  if (data.length < 4) return null;
  const sel = hex(data.subarray(0, 4));
  const n = (data.length - 4) / 32;
  if (sel === SELECTORS.transfer && n === 2 && isAddressWord(word(data, 0))) {
    return { kind: "transfer", to: fromEvmWord(word(data, 0)), amount: uint(word(data, 1)) };
  }
  if (sel === SELECTORS.transferFrom && n === 3 && isAddressWord(word(data, 0)) && isAddressWord(word(data, 1))) {
    return { kind: "transferFrom", from: fromEvmWord(word(data, 0)), to: fromEvmWord(word(data, 1)), amount: uint(word(data, 2)) };
  }
  if (sel === SELECTORS.approve && n === 2 && isAddressWord(word(data, 0))) {
    return { kind: "approve", spender: fromEvmWord(word(data, 0)), amount: uint(word(data, 1)) };
  }
  return null;
}

function uintWord(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) throw new Error("uint256 out of range");
  return fromHex(v.toString(16).padStart(64, "0"));
}

const addressWord = (bytes21: Uint8Array) => concat(new Uint8Array(12), evmWord(bytes21));

export function encodeTransferCall(to21: Uint8Array, amount: bigint): Uint8Array {
  return concat(fromHex(SELECTORS.transfer), addressWord(to21), uintWord(amount));
}

export function encodeBalanceOf(owner21: Uint8Array): Uint8Array {
  return concat(fromHex(SELECTORS.balanceOf), addressWord(owner21));
}

/** uint256 from a constant call result (hex). */
export function decodeUint(resultHex: string | undefined): bigint | null {
  if (!resultHex || !/^[0-9a-f]{64,}$/i.test(resultHex)) return null;
  return BigInt(`0x${resultHex.slice(0, 64)}`);
}

/** ABI `string` (or a bytes32 symbol, as some old tokens return) from a constant call result. */
export function decodeString(resultHex: string | undefined): string | null {
  if (!resultHex || !/^([0-9a-f]{2})+$/i.test(resultHex)) return null;
  const b = fromHex(resultHex);
  try {
    if (b.length === 32) return new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(0, b.indexOf(0) < 0 ? 32 : b.indexOf(0))) || null;
    if (b.length < 64) return null;
    const off = Number(uint(b.subarray(0, 32)) & 0xffffffffn);
    if (off + 32 > b.length) return null;
    const len = Number(uint(b.subarray(off, off + 32)) & 0xffffffffn);
    if (off + 32 + len > b.length || len > 64) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(b.subarray(off + 32, off + 32 + len)) || null;
  } catch {
    return null;
  }
}

/** An approval this large is "unlimited" (max uint256, and anything past 2^255 that some apps use for it). */
export const isUnlimited = (amount: bigint) => amount >= 1n << 255n;
