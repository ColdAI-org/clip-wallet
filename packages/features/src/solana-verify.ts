import type { DappRequest } from "@clip-wallet/core";
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { b64ToBytes } from "./util.js";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PQRSuqhqJdmsSvd";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
/** Jupiter aggregator v6 (checked on mainnet: executable, owner BPFLoaderUpgradeab1e…). */
export const JUPITER_V6_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

/** Every transaction in a Solana request (Wallet Standard `inputs` form or WalletConnect form). */
function transactionsOf(request: DappRequest): Uint8Array[] {
  const p = (request.params ?? {}) as { inputs?: { transaction?: string }[]; transaction?: string };
  const list = p.inputs?.map((i) => i.transaction) ?? [p.transaction];
  return list.filter((t): t is string => typeof t === "string").map(b64ToBytes);
}

/**
 * Program ids a transaction calls. Program ids are always static accounts (lookup tables can't hold them),
 * so this works without resolving address lookup tables.
 */
export function programIdsOf(wire: Uint8Array): string[] {
  const [tx] = getTransactionDecoder().read(wire, 0);
  const [msg] = getCompiledTransactionMessageDecoder().read(tx.messageBytes, 0);
  // v1 messages (kit 8) carry instructions differently; refuse them rather than guess.
  if (!("instructions" in msg)) throw new Error("unsupported message version");
  const m = msg as { instructions: { programAddressIndex: number }[]; staticAccounts: readonly string[] };
  return m.instructions.map((ix) => String(m.staticAccounts[ix.programAddressIndex]));
}

/** True when every instruction of every transaction targets one of `allowed`, and there's at least one. */
export function onlyPrograms(request: DappRequest, allowed: readonly string[]): boolean {
  try {
    const txs = transactionsOf(request);
    if (!txs.length) return false;
    const ok = new Set(allowed);
    return txs.every((w) => {
      const ids = programIdsOf(w);
      return ids.length > 0 && ids.every((id) => ok.has(id));
    });
  } catch {
    return false;
  }
}
