import { ClipError, type NetworkId } from "@clip-wallet/core";
import type { PartialTezosOperation } from "./build.js";
import { isTezosAddress } from "./encoding.js";
import { asAddress, asNat, pairArgs } from "./micheline.js";
import { TEZOS_MAINNET, TEZOS_SHADOWNET } from "./networks.js";
import type { TezosRpc } from "./rpc.js";

/**
 * Sirius DEX: the protocol's own Liquidity Baking CPMM (XTZ ↔ tzBTC), created by the protocol itself and readable
 * from the node: GET /chains/main/blocks/head/context/liquidity_baking/cpmm_address. Source:
 * tezos/tezos src/proto_alpha/lib_protocol/contracts/cpmm.mligo (fee 999/1000 plus a 0.1 % XTZ burn on each side).
 *
 * Allow-list per network (checked on 2026-10-03 with the RPC above and …/contracts/<cpmm>/storage):
 *  - mainnet:   cpmm KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5, token tzBTC KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn (FA1.2)
 *  - shadownet: cpmm KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5, token KT1VqarPDicMFn1ejmQqqshUkUXTCTXwmkCN (pool is empty)
 */
export const LIQUIDITY_BAKING: Record<NetworkId, { cpmm: string; token: string; tokenStandard: "fa1.2" }> = {
  [TEZOS_MAINNET.id]: { cpmm: "KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5", token: "KT1PWx2mnDueood7fEmfbBDKx1D9BAnnXitn", tokenStandard: "fa1.2" },
  [TEZOS_SHADOWNET.id]: { cpmm: "KT1TxqZ8QtKvLu3V3JH7Gx58n7Co8pgtpQU5", token: "KT1VqarPDicMFn1ejmQqqshUkUXTCTXwmkCN", tokenStandard: "fa1.2" },
};

export interface CpmmState {
  address: string;
  tokenPool: bigint;
  /** mutez */
  xtzPool: bigint;
  lqtTotal: bigint;
  tokenAddress: string;
  lqtAddress: string;
}

/** Storage: Pair tokenPool xtzPool lqtTotal tokenAddress lqtAddress (comb layout). */
export function parseCpmmStorage(address: string, storage: unknown): CpmmState {
  const p = pairArgs(storage, 5);
  const tokenPool = p && asNat(p[0]);
  const xtzPool = p && asNat(p[1]);
  const lqtTotal = p && asNat(p[2]);
  const tokenAddress = p && asAddress(p[3]);
  const lqtAddress = p && asAddress(p[4]);
  if (tokenPool == null || xtzPool == null || lqtTotal == null || !tokenAddress || !lqtAddress) {
    throw new ClipError("Couldn't read the exchange's prices right now. Try again in a moment.", "tezos/dex-unreadable");
  }
  return { address, tokenPool, xtzPool, lqtTotal, tokenAddress, lqtAddress };
}

/** Reads the protocol's CPMM address and its pools from the node. */
export async function readCpmm(rpc: TezosRpc): Promise<CpmmState> {
  const address = await rpc.get<string>("/chains/main/blocks/head/context/liquidity_baking/cpmm_address");
  if (typeof address !== "string" || !address.startsWith("KT1") || !isTezosAddress(address)) {
    throw new ClipError("Couldn't find the exchange on this network.", "tezos/dex-missing");
  }
  return parseCpmmStorage(address, await rpc.get<unknown>(`/chains/main/blocks/head/context/contracts/${address}/storage`));
}

const FEE = 999n;
const BURN_NUM = 999n;

/** Exactly the contract's xtz_to_token: 0.1 % of the XTZ is burnt, then a 0.1 % fee CPMM. */
export function cpmmXtzToToken(xtzIn: bigint, s: Pick<CpmmState, "tokenPool" | "xtzPool">): bigint {
  const net = (xtzIn * BURN_NUM) / 1000n;
  return (net * FEE * s.tokenPool) / (s.xtzPool * 1000n + net * FEE);
}

/** Exactly the contract's token_to_xtz (mutez you receive, after the 0.1 % burn). */
export function cpmmTokenToXtz(tokensIn: bigint, s: Pick<CpmmState, "tokenPool" | "xtzPool">): bigint {
  const bought = (tokensIn * FEE * s.xtzPool) / (s.tokenPool * 1000n + tokensIn * FEE);
  return (bought * BURN_NUM) / 1000n;
}

const nat = (v: bigint | string) => ({ int: BigInt(v).toString() });
const addr = (a: string) => ({ string: a });
/** Unix seconds as a Michelson timestamp. */
const ts = (unixSeconds: number) => ({ int: String(Math.floor(unixSeconds)) });

/** `xtzToToken (pair %to (pair %minTokensBought %deadline))` with `amount` mutez attached. */
export function cpmmXtzToTokenOp(p: { cpmm: string; to: string; mutez: bigint; minTokens: bigint; deadline: number }): PartialTezosOperation {
  return {
    kind: "transaction",
    amount: p.mutez.toString(),
    destination: p.cpmm,
    parameters: { entrypoint: "xtzToToken", value: { prim: "Pair", args: [addr(p.to), { prim: "Pair", args: [nat(p.minTokens), ts(p.deadline)] }] } },
  };
}

/** `tokenToXtz (pair %to (pair %tokensSold (pair %minXtzBought %deadline)))`, amount 0. */
export function cpmmTokenToXtzOp(p: { cpmm: string; to: string; tokens: bigint; minMutez: bigint; deadline: number }): PartialTezosOperation {
  return {
    kind: "transaction",
    amount: "0",
    destination: p.cpmm,
    parameters: {
      entrypoint: "tokenToXtz",
      value: { prim: "Pair", args: [addr(p.to), { prim: "Pair", args: [nat(p.tokens), { prim: "Pair", args: [nat(p.minMutez), ts(p.deadline)] }] }] },
    },
  };
}

/** FA1.2 (TZIP-7) `approve (pair %spender %value)`. */
export function fa12ApproveOp(token: string, spender: string, amount: bigint): PartialTezosOperation {
  return { kind: "transaction", amount: "0", destination: token, parameters: { entrypoint: "approve", value: { prim: "Pair", args: [addr(spender), nat(amount)] } } };
}

/** FA2 (TZIP-12) `update_operators` with one add_operator (Left) or remove_operator (Right). */
export function fa2OperatorOp(token: string, owner: string, operator: string, tokenId: string, add: boolean): PartialTezosOperation {
  const body = { prim: "Pair", args: [addr(owner), { prim: "Pair", args: [addr(operator), nat(tokenId)] }] };
  return { kind: "transaction", amount: "0", destination: token, parameters: { entrypoint: "update_operators", value: [{ prim: add ? "Left" : "Right", args: [body] }] } };
}

/**
 * Exact-amount spending permission around a contract call, in the same batch:
 *  - FA1.2: `approve 0` first (TZIP-7 tokens such as tzBTC refuse changing a nonzero allowance: UnsafeAllowanceChange),
 *    then `approve amount`. The call consumes exactly that amount, so the allowance ends at 0.
 *  - FA2: `add_operator` before and `remove_operator` after (FA2 has no amounts, so access never outlives the batch).
 */
export function spendPermissionOps(p: { standard: "fa1.2" | "fa2"; token: string; tokenId?: string; owner: string; spender: string; amount: bigint }): {
  before: PartialTezosOperation[];
  after: PartialTezosOperation[];
} {
  if (p.standard === "fa1.2") return { before: [fa12ApproveOp(p.token, p.spender, 0n), fa12ApproveOp(p.token, p.spender, p.amount)], after: [] };
  const id = p.tokenId ?? "0";
  return { before: [fa2OperatorOp(p.token, p.owner, p.spender, id, true)], after: [fa2OperatorOp(p.token, p.owner, p.spender, id, false)] };
}
