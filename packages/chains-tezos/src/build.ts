import { ClipError } from "@clip-wallet/core";
import { LocalForger, ProtocolsHash } from "@taquito/local-forging";
import { ZERO_SIGNATURE, isTezosAddress, isUint } from "./encoding.js";
import { type OperationResult, RpcError, type SimulationResult, type TezosRpc, type TezosRpcErrorItem, plainTezosError, simulationErrors } from "./rpc.js";

/** A manager operation as sent by a dapp (Beacon `PartialTezosOperation` / WalletConnect `tezos_send`). */
export interface PartialTezosOperation {
  kind: string;
  source?: string;
  fee?: string;
  counter?: string;
  gas_limit?: string;
  storage_limit?: string;
  [k: string]: unknown;
}

export interface TezosOperation extends PartialTezosOperation {
  source: string;
  fee: string;
  counter: string;
  gas_limit: string;
  storage_limit: string;
}

/** Manager operations @taquito/local-forging can forge. The first four are described; the rest are blind. */
export const MANAGER_KINDS = [
  "reveal",
  "transaction",
  "delegation",
  "origination",
  "register_global_constant",
  "increase_paid_storage",
  "transfer_ticket",
  "set_deposits_limit",
  "update_consensus_key",
  "update_companion_key",
  "smart_rollup_originate",
  "smart_rollup_add_messages",
  "smart_rollup_execute_outbox_message",
  "dal_publish_commitment",
] as const;

/**
 * Fee constants: octez mempool filter defaults, checked with GET /chains/main/mempool/filter on shadownet
 * (minimal_fees 100 mutez, minimal_nanotez_per_byte 1000, minimal_nanotez_per_gas_unit 100):
 * fee ≥ 100 + 1 mutez × bytes + 0.1 mutez × gas.
 */
export const MINIMAL_FEE_MUTEZ = 100n;
export const NANOTEZ_PER_BYTE = 1000n;
export const NANOTEZ_PER_GAS = 100n;
/** Protocol constants (same on mainnet and shadownet, GET …/context/constants, Oct 2026). */
export const HARD_GAS_LIMIT_PER_BLOCK = 1040000;
export const HARD_STORAGE_LIMIT_PER_OPERATION = 60000;
export const COST_PER_BYTE_MUTEZ = 250n;
export const ORIGINATION_SIZE = 257n;
export const GAS_BUFFER = 100n;
export const STORAGE_BUFFER = 20n;

export interface OpEstimate {
  gas: bigint;
  storage: bigint;
  /** Storage burn seen in the simulation (mutez). */
  burn: bigint;
  allocates: boolean;
}

export interface BuiltOperation {
  branch: string;
  contents: TezosOperation[];
  /** Hex of the forged (unsigned) operation. */
  forged: string;
  revealAdded: boolean;
  simulated: boolean;
  /** Plain-language reason the simulation failed. */
  simulationError?: string;
  simulationErrorIds?: string[];
  estimates: OpEstimate[];
  /** Sum of baker fees (mutez). */
  fees: bigint;
  /** Worst-case storage burn: sum of storage limits × cost per byte (mutez). */
  maxBurn: bigint;
  /** Storage burn the simulation saw (mutez). */
  burn: bigint;
  createdAt: number;
}

export interface BuildOptions {
  me: string;
  /** edpk… */
  publicKey: string;
  chainId: string;
  simulate: boolean;
  protocol: ProtocolsHash;
  now?: () => number;
}

const bad = (msg: string) => new ClipError(msg, "tezos/bad-operation");

function toUintString(v: unknown, what: string): string {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === "bigint" && v >= 0n) return v.toString();
  if (isUint(v)) return BigInt(v).toString();
  throw bad(`This request has an invalid ${what}.`);
}

/** Validates and normalises the dapp's operations (no network). */
export function normalizeOperations(ops: unknown, me: string): PartialTezosOperation[] {
  if (!Array.isArray(ops) || !ops.length) throw new ClipError("This request is missing its operations.", "tezos/bad-params");
  if (ops.length > 50) throw bad("This request has too many operations.");
  return ops.map((raw) => {
    if (!raw || typeof raw !== "object") throw bad("This request has an invalid operation.");
    const op = { ...(raw as PartialTezosOperation) };
    if (typeof op.kind !== "string") throw bad("This request has an invalid operation.");
    if (!(MANAGER_KINDS as readonly string[]).includes(op.kind)) {
      throw new ClipError("Clip Wallet can't sign this kind of Tezos operation.", "tezos/unsupported-operation");
    }
    if (op.source != null && op.source !== me) throw new ClipError("This request is for a different account than the one you connected.", "tezos/wrong-account");
    for (const k of ["fee", "gas_limit", "storage_limit"] as const) if (op[k] != null) op[k] = toUintString(op[k], k.replace("_", " "));
    delete op.counter;
    if (op.kind === "transaction") {
      op.amount = toUintString(op.amount ?? "0", "amount");
      if (typeof op.destination !== "string" || !isTezosAddress(op.destination)) throw bad("This request sends to an invalid address.");
      if (op.parameters != null) {
        const p = op.parameters as { entrypoint?: unknown; value?: unknown };
        if (typeof p.entrypoint !== "string" || p.value === undefined) throw bad("This request has invalid contract parameters.");
      }
    } else if (op.kind === "delegation") {
      if (op.delegate != null && (typeof op.delegate !== "string" || !/^tz[1-4]/.test(op.delegate) || !isTezosAddress(op.delegate))) {
        throw bad("That isn't a valid baker address.");
      }
    } else if (op.kind === "origination") {
      op.balance = toUintString(op.balance ?? "0", "balance");
      const s = op.script as { code?: unknown; storage?: unknown } | undefined;
      if (!s || s.code === undefined || s.storage === undefined) throw bad("This request creates a contract without code.");
    }
    return op;
  });
}

function defaultLimits(op: PartialTezosOperation): { gas: bigint; storage: bigint } {
  switch (op.kind) {
    case "reveal":
      return { gas: 1000n, storage: 0n };
    case "delegation":
      return { gas: 1000n, storage: 0n };
    case "transaction":
      if (op.parameters == null && String(op.destination).startsWith("tz")) return { gas: 2300n, storage: ORIGINATION_SIZE };
      return { gas: 15000n, storage: 1000n };
    case "origination":
      return { gas: 15000n, storage: 1000n + ORIGINATION_SIZE };
    default:
      return { gas: 15000n, storage: 1000n };
  }
}

function sumResult(r: OperationResult | undefined): OpEstimate {
  const e: OpEstimate = { gas: 0n, storage: 0n, burn: 0n, allocates: false };
  if (!r) return e;
  e.gas += BigInt(r.consumed_milligas ?? "0");
  e.storage += BigInt(r.paid_storage_size_diff ?? "0");
  if (r.allocated_destination_contract) {
    e.storage += ORIGINATION_SIZE;
    e.allocates = true;
  }
  e.storage += ORIGINATION_SIZE * BigInt(r.originated_contracts?.length ?? 0);
  for (const b of r.balance_updates ?? []) if (b.kind === "burned" && b.category === "storage fees") e.burn += BigInt(b.change);
  return e;
}

/** Per-operation gas (milligas → gas), storage and burn from a simulation result, internal operations included. */
export function estimatesFrom(sim: SimulationResult): OpEstimate[] {
  return sim.contents.map((c) => {
    const e = sumResult(c.metadata?.operation_result);
    for (const i of c.metadata?.internal_operation_results ?? []) {
      const x = sumResult(i.result);
      e.gas += x.gas;
      e.storage += x.storage;
      e.burn += x.burn;
      e.allocates ||= x.allocates;
    }
    const milligas = e.gas;
    e.gas = (milligas + 999n) / 1000n + GAS_BUFFER;
    if (e.storage > 0n) e.storage += STORAGE_BUFFER;
    return e;
  });
}

const maxBig = (a: bigint, b: string | undefined) => (b != null && BigInt(b) > a ? BigInt(b) : a);

/** fee = 100 + 1 mutez/byte + 0.1 mutez/gas, rounded up (octez minimal fee formula). */
export function minimalFee(bytes: number, gas: bigint): bigint {
  return MINIMAL_FEE_MUTEZ + (NANOTEZ_PER_BYTE * BigInt(bytes) + NANOTEZ_PER_GAS * gas + 999n) / 1000n;
}

export async function forge(forger: LocalForger, branch: string, contents: TezosOperation[]): Promise<string> {
  try {
    const hex = await forger.forge({ branch, contents } as never);
    const back = (await forger.parse(hex)) as { branch: string; contents: { kind: string }[] };
    if (back.branch !== branch || back.contents.length !== contents.length || back.contents.some((c, i) => c.kind !== contents[i]!.kind)) {
      throw new Error("forge round trip mismatch");
    }
    return hex;
  } catch (cause) {
    if (cause instanceof ClipError) throw cause;
    throw new ClipError("This request has an operation Clip Wallet can't encode. Nothing was signed.", "tezos/forge-failed", cause);
  }
}

/**
 * Builds the operation the user approves: source, counter, branch, an automatic reveal for a new account,
 * limits from simulate_operation and the minimal fee. Dapp-supplied fee/limits are kept when higher.
 */
export async function buildOperation(rpc: TezosRpc, partial: PartialTezosOperation[], o: BuildOptions): Promise<BuiltOperation> {
  const forger = new LocalForger(o.protocol);
  const [managerKey, counter, branch] = await Promise.all([rpc.managerKey(o.me), rpc.counter(o.me), rpc.branch()]);

  let ops = partial.slice();
  let revealAdded = false;
  if (managerKey) ops = ops.filter((op) => op.kind !== "reveal");
  else {
    const given = ops.filter((op) => op.kind === "reveal");
    for (const r of given) if (r.public_key !== o.publicKey) throw new ClipError("This request publishes a different key for your account.", "tezos/bad-reveal");
    ops = ops.filter((op) => op.kind !== "reveal");
    ops.unshift({ kind: "reveal", public_key: o.publicKey, ...(given[0] ? pickLimits(given[0]) : {}) });
    revealAdded = given.length === 0;
  }
  if (!ops.length) throw new ClipError("There's nothing to send in this request.", "tezos/bad-params");

  const withBase = (op: PartialTezosOperation, i: number, fee: string, gas: string, storage: string): TezosOperation => ({
    ...op,
    source: o.me,
    fee,
    counter: (counter + 1n + BigInt(i)).toString(),
    gas_limit: gas,
    storage_limit: storage,
  });

  let estimates: OpEstimate[] = ops.map((op) => ({ ...defaultLimits(op), burn: 0n, allocates: false }));
  let simulated = false;
  let simulationError: string | undefined;
  let simulationErrorIds: string[] | undefined;
  if (o.simulate) {
    const perOpGas = Math.floor(HARD_GAS_LIMIT_PER_BLOCK / ops.length).toString();
    const contents = ops.map((op, i) => withBase(op, i, "0", perOpGas, String(HARD_STORAGE_LIMIT_PER_OPERATION)));
    try {
      const sim = await rpc.simulate({ operation: { branch, contents, signature: ZERO_SIGNATURE }, chain_id: o.chainId });
      const errs = simulationErrors(sim);
      if (errs) {
        simulationError = plainTezosError(errs);
        simulationErrorIds = errs.map((e) => e.id);
      } else {
        estimates = estimatesFrom(sim);
        simulated = true;
      }
    } catch (e) {
      if (!(e instanceof RpcError)) throw e;
      const errs: TezosRpcErrorItem[] = e.errors;
      simulationError = plainTezosError(errs);
      simulationErrorIds = errs.map((x) => x.id);
    }
  }

  const limits = ops.map((op, i) => ({
    gas: maxBig(estimates[i]!.gas, op.gas_limit),
    storage: maxBig(estimates[i]!.storage, op.storage_limit),
  }));

  // Fee depends on the size, which depends on the fee (zarith): iterate until stable.
  let fees = ops.map(() => 0n);
  let contents: TezosOperation[] = [];
  for (let round = 0; round < 4; round++) {
    contents = ops.map((op, i) => withBase(op, i, fees[i]!.toString(), limits[i]!.gas.toString(), limits[i]!.storage.toString()));
    const next: bigint[] = [];
    for (let i = 0; i < contents.length; i++) {
      const alone = await forge(forger, branch, [contents[i]!]);
      // Each op pays for its own bytes; the first also carries the branch (32) and the signature (64).
      const bytes = alone.length / 2 - 32 + (i === 0 ? 32 + 64 : 0);
      next.push(maxBig(minimalFee(bytes, limits[i]!.gas), ops[i]!.fee));
    }
    const stable = next.every((f, i) => f === fees[i]);
    fees = next;
    if (stable) break;
  }
  contents = ops.map((op, i) => withBase(op, i, fees[i]!.toString(), limits[i]!.gas.toString(), limits[i]!.storage.toString()));
  const forged = await forge(forger, branch, contents);

  const totalStorage = limits.reduce((a, l) => a + l.storage, 0n);
  return {
    branch,
    contents,
    forged,
    revealAdded,
    simulated,
    ...(simulationError ? { simulationError, simulationErrorIds } : {}),
    estimates,
    fees: fees.reduce((a, f) => a + f, 0n),
    maxBurn: totalStorage * COST_PER_BYTE_MUTEZ,
    burn: estimates.reduce((a, e) => a + e.burn, 0n),
    createdAt: (o.now ?? Date.now)(),
  };
}

function pickLimits(op: PartialTezosOperation): Partial<PartialTezosOperation> {
  const out: Partial<PartialTezosOperation> = {};
  if (op.fee != null) out.fee = op.fee;
  if (op.gas_limit != null) out.gas_limit = op.gas_limit;
  if (op.storage_limit != null) out.storage_limit = op.storage_limit;
  return out;
}

export { ProtocolsHash };
