/**
 * Coin selection, v1: largest-first.
 * Sort spendable UTXOs by value (descending) and add them until inputs cover amount + fee. Simple and
 * predictable, at the cost of privacy and of consolidating large coins first. Without an ord index,
 * coins at or below SMALL_UTXO_SATS go last because inscriptions usually sit on small outputs.
 * Change below the dust limit is dropped into the fee.
 */
import { ClipError } from "@clip-wallet/core";

export interface Utxo {
  txid: string;
  vout: number;
  value: bigint;
  script: Uint8Array;
  kind: "wpkh" | "tr";
}

/** vbytes per input / output type (signed, segwit discount applied). */
export const INPUT_VB = { wpkh: 68, tr: 57.5 } as const;
export const OUTPUT_VB: Record<string, number> = { wpkh: 31, tr: 43, wsh: 43, sh: 32, pkh: 34, other: 43 };
export const TX_OVERHEAD_VB = 10.5;
export const DUST_SATS = 546n;

export interface Selection {
  inputs: Utxo[];
  fee: bigint;
  change: bigint;
  vsize: number;
}

export function selectLargestFirst(
  utxos: Utxo[],
  outputs: { amount: bigint; type: string }[],
  feeRate: number,
  changeType: "wpkh" | "tr",
  deprioritize: (u: Utxo) => boolean = () => false,
): Selection {
  const target = outputs.reduce((s, o) => s + o.amount, 0n);
  if (target <= 0n) throw new ClipError("Enter an amount above zero.", "bad-amount");
  const sorted = [...utxos].sort((a, b) => {
    const pa = deprioritize(a) ? 1 : 0;
    const pb = deprioritize(b) ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return a.value === b.value ? 0 : a.value > b.value ? -1 : 1;
  });
  const outVb = outputs.reduce((s, o) => s + (OUTPUT_VB[o.type] ?? 43), 0);
  const picked: Utxo[] = [];
  let sum = 0n;
  for (const u of sorted) {
    picked.push(u);
    sum += u.value;
    const inVb = picked.reduce((s, x) => s + INPUT_VB[x.kind], 0);
    const vsizeWithChange = Math.ceil(TX_OVERHEAD_VB + inVb + outVb + OUTPUT_VB[changeType]!);
    const feeWithChange = BigInt(Math.ceil(vsizeWithChange * feeRate));
    if (sum >= target + feeWithChange) {
      const change = sum - target - feeWithChange;
      if (change >= DUST_SATS) return { inputs: picked, fee: feeWithChange, change, vsize: vsizeWithChange };
      const vsizeNoChange = Math.ceil(TX_OVERHEAD_VB + inVb + outVb);
      return { inputs: picked, fee: sum - target, change: 0n, vsize: vsizeNoChange };
    }
  }
  throw new ClipError("You don't have enough BTC to send this amount and pay the network fee.", "insufficient-funds");
}
