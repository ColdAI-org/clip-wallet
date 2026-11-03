/**
 * The Clip fee on SODAX swaps and the reviewed list of addresses it may be paid to (docs/features/sodax-swaps.md).
 * The fee is 0.875 % of the amount sold, paid to ColdAI LLC as SODAX's partner fee in its exact-amount form
 * (@sodax/sdk 2.2.0 dist/index.mjs:25257-25258, :6791-6796), because the percentage form only takes whole basis
 * points: it is BigInt(percentage) over a scale of 10 000 (:5254, :6782-6784), and BigInt(87.5) throws.
 *
 * No runtime imports but the JSON: the extension build reads this in Node (@coldai/clip-wallet-features/sodax-fee) to refuse
 * a mainnet build whose CLIP_SODAX_FEE_RECEIVER isn't on the list, and the swap provider (./sodax.ts) checks every
 * intent against it before anything is signed.
 *
 * @module
 */
import file from "./sodax-fee-receivers.json" with { type: "json" };

/**
 * 0.875 % as an exact fraction (875 / 100 000), so the fee is never rounded up. `name` is the fee's, not the
 * wallet's: a wallet built from the kit shows "Clip fee" too, because the fee is ColdAI's (`receivedBy`).
 */
export const CLIP_FEE = { numerator: 875n, denominator: 100_000n, percent: 0.875, name: "Clip", receivedBy: "ColdAI LLC" } as const;

/** The Clip fee on `gross` base units of the asset sold, rounded down. */
export function clipFeeOn(gross: bigint): bigint {
  return (gross * CLIP_FEE.numerator) / CLIP_FEE.denominator;
}

/** Is `fee` at most 0.875 % of `gross`? */
export function withinClipFee(fee: bigint, gross: bigint): boolean {
  return fee >= 0n && fee * CLIP_FEE.denominator <= gross * CLIP_FEE.numerator;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/;

/** Is `address` an EVM address (0x and 40 hex digits) other than the zero address? */
export function isFeeReceiverAddress(address: string | undefined): address is string {
  return !!address && ADDRESS.test(address) && !ZERO.test(address);
}

/**
 * The receivers in a sodax-fee-receivers.json document, lower case. Anything but `{ receivers: [...] }` of distinct
 * non-zero EVM addresses throws: a malformed list must never read as an empty or a permissive one.
 */
export function parseFeeReceivers(doc: unknown): string[] {
  const list = doc && typeof doc === "object" ? (doc as { receivers?: unknown }).receivers : undefined;
  if (!Array.isArray(list)) throw new Error("sodax-fee-receivers.json: receivers must be a list of addresses");
  const out: string[] = [];
  for (const a of list) {
    if (typeof a !== "string" || !isFeeReceiverAddress(a)) throw new Error(`sodax-fee-receivers.json: ${JSON.stringify(a)} isn't an EVM address`);
    const lower = a.toLowerCase();
    if (out.includes(lower)) throw new Error(`sodax-fee-receivers.json: ${a} is listed twice`);
    out.push(lower);
  }
  return out;
}

/** The committed list, lower case. A build whose fee receiver isn't on it offers no SODAX swaps. */
export const SODAX_FEE_RECEIVERS: readonly string[] = Object.freeze(parseFeeReceivers(file));

/** Is `address` on the reviewed list? */
export function isReviewedFeeReceiver(address: string | undefined, list: readonly string[] = SODAX_FEE_RECEIVERS): boolean {
  return isFeeReceiverAddress(address) && list.includes(address.toLowerCase());
}
