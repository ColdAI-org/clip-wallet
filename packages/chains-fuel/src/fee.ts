import type { ChainInfo, DependentCost } from "./gql.js";
import { encodeScriptTx, type ScriptTx } from "./tx.js";

/**
 * Fee maths for Script transactions (specs: tx-validity "Max fee"; fuel-vm `TransactionFee`; fuels-ts
 * providers/utils/gas.ts `getMinGas` / `getMaxGas` / `calculateGasFee`, which the tests cross-check):
 *
 *   min_gas = vm_init(size) + size·gas_per_byte + Σ inputs (ecr1 once per distinct witness; predicates:
 *             vm_init(size) + contract_root(len(predicate)) + predicate_gas_used) + s256(size)   [tx id]
 *   max_gas = min_gas + (witness_limit − witness bytes)·gas_per_byte (when a witness limit is set) + script_gas_limit
 *   fee(gas) = gas·gas_price / gas_price_factor (rounded up by fuel-vm) + tip
 *
 * `size` is the whole serialized transaction, witnesses included.
 */

export function dependentCost(units: bigint, c: DependentCost): bigint {
  const base = BigInt(c.base);
  if (c.unitsPerGas !== undefined) return base + units / BigInt(c.unitsPerGas);
  return base + units * BigInt(c.gasPerUnit ?? 0);
}

export function minGas(tx: ScriptTx, chain: ChainInfo): bigint {
  const size = BigInt(encodeScriptTx(tx).length);
  const g = chain.gasCosts;
  const vmInit = dependentCost(size, g.vmInitialization);
  let inputs = 0n;
  const seen = new Set<number>();
  for (const i of tx.inputs) {
    if (i.type === 1) continue;
    if (i.predicate.length) {
      inputs += vmInit + dependentCost(BigInt(i.predicate.length), g.contractRoot) + i.predicateGasUsed;
    } else if (!seen.has(i.witnessIndex)) {
      seen.add(i.witnessIndex);
      inputs += g.ecr1;
    }
  }
  return vmInit + size * chain.gasPerByte + inputs + dependentCost(size, g.s256);
}

export function maxGas(tx: ScriptTx, chain: ChainInfo, min = minGas(tx, chain)): bigint {
  const witnessBytes = BigInt(tx.witnesses.reduce((a, w) => a + w.length, 0));
  const wl = tx.policies.witnessLimit;
  const extra = wl !== undefined && wl > 0n && wl >= witnessBytes ? (wl - witnessBytes) * chain.gasPerByte : 0n;
  const max = min + extra + tx.scriptGasLimit;
  return max > chain.maxGasPerTx ? chain.maxGasPerTx : max;
}

/** fuel-vm gas_to_fee: ceil(gas · price / factor). */
export function gasToFee(gas: bigint, gasPrice: bigint, factor: bigint): bigint {
  const n = gas * gasPrice;
  return (n + factor - 1n) / factor;
}

/** The smallest max_fee the node accepts for `tx` at `gasPrice` (fuels-ts adds 1 to its floor-division estimate). */
export function requiredMaxFee(tx: ScriptTx, chain: ChainInfo, gasPrice: bigint): bigint {
  return gasToFee(maxGas(tx, chain), gasPrice, chain.gasPriceFactor) + (tx.policies.tip ?? 0n);
}
