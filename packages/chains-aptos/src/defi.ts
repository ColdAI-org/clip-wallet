import { ClipError } from "@clip-wallet/core";
import {
  Deserializer,
  TransactionPayload,
  TransactionPayloadEntryFunction,
  type TypeTag,
  generateTransactionPayloadWithABI,
  parseTypeTag,
} from "@aptos-labs/ts-sdk";
import type { PayloadData } from "./module.js";
import { canonicalAddress, canonicalType, longAddress } from "./networks.js";
import { hex } from "./util.js";

/**
 * Wallet-built Aptos DeFi payloads (delegated staking, DEX swaps). Each is the wire form `aptos:signAndSubmitTransaction`
 * accepts (`{ function, typeArguments, functionArguments }`, numbers as decimal strings); this module fetches the
 * entry function's ABI, encodes, simulates and builds it. `encodeEntryPayload` / `decodeEntryPayload` run the same SDK
 * encoder offline (given the ABI) so callers and tests can read the exact BCS back.
 *
 * Delegated staking (aptos-labs/aptos-core aptos-move/framework/aptos-framework/sources/delegation_pool.move, checked
 * 2026-10-03): `add_stake(delegator, pool_address, amount)`, `unlock(...)`, `withdraw(...)`;
 * MIN_COINS_ON_SHARES_POOL = 1_000_000_000 octas (10 APT) for an active (or pending-inactive) balance.
 */
export const DELEGATION_POOL_MODULE = "0x1::delegation_pool";
export const MIN_DELEGATION_OCTAS = 1_000_000_000n;

export type DelegationAction = "add_stake" | "unlock" | "withdraw";

export function delegationPayload(action: DelegationAction, pool: string, amount: bigint): PayloadData {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(pool)) throw new ClipError("That staking pool doesn't look right.", "aptos/bad-address");
  if (amount <= 0n) throw new ClipError("Enter an amount greater than zero.", "aptos/bad-amount");
  return { function: `${DELEGATION_POOL_MODULE}::${action}`, typeArguments: [], functionArguments: [longAddress(pool), amount.toString()] };
}

/** ABI of one entry function as the fullnode returns it (`GET /accounts/{a}/module/{m}` → abi.exposed_functions[i]). */
export interface EntryAbi {
  generic_type_params: { constraints: string[] }[];
  params: string[];
}

/** BCS of the TransactionPayload (entry function) the module would build for `data`, using the given ABI. */
export function encodeEntryPayload(data: PayloadData, abi: EntryAbi): Uint8Array {
  const [rawAddr, mod, fn] = data.function.split("::") as [string, string, string];
  const parameters: TypeTag[] = abi.params.filter((p) => p !== "signer" && p !== "&signer").map((p) => parseTypeTag(p, { allowGenerics: true }));
  const payload = generateTransactionPayloadWithABI({
    function: `${canonicalAddress(rawAddr)}::${mod}::${fn}`,
    typeArguments: (data.typeArguments ?? []).map(canonicalType),
    functionArguments: (data.functionArguments ?? []) as never,
    abi: { typeParameters: abi.generic_type_params as never, parameters },
  });
  return payload.bcsToBytes();
}

export interface DecodedEntry {
  /** `0x1::delegation_pool::add_stake` (address as the SDK prints it). */
  function: string;
  typeArguments: string[];
  /** Raw BCS of each argument. */
  args: Uint8Array[];
}

/** Read an entry-function TransactionPayload back with the SDK. */
export function decodeEntryPayload(bytes: Uint8Array): DecodedEntry {
  const p = TransactionPayload.deserialize(new Deserializer(bytes));
  if (!(p instanceof TransactionPayloadEntryFunction)) throw new ClipError("This isn't an entry-function call.", "aptos/bad-transaction");
  const ef = p.entryFunction;
  return {
    function: `${ef.module_name.address.toString()}::${ef.module_name.name.identifier}::${ef.function_name.identifier}`,
    typeArguments: ef.type_args.map((t) => t.toString()),
    args: ef.args.map((a) => {
      const v = (a as unknown as { value?: { value?: Uint8Array } }).value?.value;
      return v instanceof Uint8Array ? v : a.bcsToBytes();
    }),
  };
}

export function bcsU64(b: Uint8Array): bigint {
  if (b.length !== 8) throw new Error("not a u64");
  return new Deserializer(b).deserializeU64();
}

export function bcsAddress(b: Uint8Array): string {
  if (b.length !== 32) throw new Error("not an address");
  return `0x${hex(b)}`;
}

/** vector<address>: ULEB128 length, then 32-byte addresses. */
export function bcsAddressVector(b: Uint8Array): string[] {
  const d = new Deserializer(b);
  const n = d.deserializeUleb128AsU32();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`0x${hex(d.deserializeFixedBytes(32))}`);
  return out;
}

