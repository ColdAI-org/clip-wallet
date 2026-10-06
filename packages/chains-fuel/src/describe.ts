import { type AssetRef, type BalanceChange, type Msg, type NetworkId, type Warning, msg, say } from "@clip-wallet/core";
import type { Receipt } from "./gql.js";
import { assetFor } from "./networks.js";
import { type ScriptTx, RETURN_ZERO_SCRIPT, ZERO32 } from "./tx.js";
import { formatUnits, hex0x, short } from "./util.js";

/**
 * What a Script transaction does to this account, from what can be proven:
 *  - Inputs and outputs prove the plain coin flows: what you put in (your coin inputs), Coin outputs (fixed amounts
 *    to fixed owners) and Change outputs (whatever is left of an asset after the script runs and the fee is paid).
 *  - A script other than fuels-ts' "return 0" (or any contract input) can move coins on its own: forward them into
 *    contract calls (CALL receipts), transfer them (TRANSFER / TRANSFER_OUT) or receive some back from contracts
 *    (TRANSFER_OUT to you, into Variable outputs). Those flows only show up when the transaction is run, so the
 *    module dry-runs it and reads the receipts (`simulated: true`).
 *  - Predicate inputs (programs that own coins) and non-Script transactions aren't explained: blind.
 */

export interface Analysis {
  /** Asset id (lower case) → base units. */
  mineIn: Map<string, bigint>;
  /** Witness slots this account signs. */
  myWitnesses: Set<number>;
  sends: { to: string; assetId: string; amount: bigint }[];
  toMe: Map<string, bigint>;
  /** Change output recipient per asset. */
  change: Map<string, string>;
  /** Sum of all inputs (anyone's) and Coin outputs per asset, for the leftover. */
  allIn: Map<string, bigint>;
  coinOut: Map<string, bigint>;
  contracts: string[];
  predicates: number;
  /** Message inputs that carry data (bridge messages for a script to consume). */
  dataMessages: number;
  othersSign: boolean;
  plainScript: boolean;
}

const add = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);

export function analyze(tx: ScriptTx, me: string): Analysis {
  const a: Analysis = {
    mineIn: new Map(),
    myWitnesses: new Set(),
    sends: [],
    toMe: new Map(),
    change: new Map(),
    allIn: new Map(),
    coinOut: new Map(),
    contracts: [],
    predicates: 0,
    dataMessages: 0,
    othersSign: false,
    plainScript: false,
  };
  for (const i of tx.inputs) {
    if (i.type === 1) {
      a.contracts.push(i.contractId);
      continue;
    }
    if (i.predicate.length) a.predicates++;
    if (i.type === 0) {
      add(a.allIn, i.assetId, i.amount);
      if (!i.predicate.length && i.owner === me) {
        add(a.mineIn, i.assetId, i.amount);
        a.myWitnesses.add(i.witnessIndex);
      } else if (!i.predicate.length) a.othersSign = true;
    } else {
      if (i.data.length) a.dataMessages++;
      // A message coin (no data) spends like a base-asset coin of its recipient.
      if (!i.data.length) add(a.allIn, "base", i.amount);
      if (!i.predicate.length && i.recipient === me) {
        if (!i.data.length) add(a.mineIn, "base", i.amount);
        a.myWitnesses.add(i.witnessIndex);
      } else if (!i.predicate.length) a.othersSign = true;
    }
  }
  for (const o of tx.outputs) {
    if (o.type === 0) {
      add(a.coinOut, o.assetId, o.amount);
      if (o.to === me) add(a.toMe, o.assetId, o.amount);
      else a.sends.push({ to: o.to, assetId: o.assetId, amount: o.amount });
    } else if (o.type === 2) a.change.set(o.assetId, o.to);
  }
  a.plainScript = hex0x(tx.script) === RETURN_ZERO_SCRIPT && tx.scriptData.length === 0 && a.contracts.length === 0 && a.dataMessages === 0;
  return a;
}

/** Moves from the script's own balances (receipt `id` empty or zero) and transfers to `me`, read from receipts. */
export interface Simulated {
  /** Coins the script forwarded to contracts or sent out itself, per asset. */
  spent: Map<string, bigint>;
  /** Coins contracts sent to this account (TRANSFER_OUT to you), per asset. */
  received: Map<string, bigint>;
  calls: string[];
}

const fromScript = (r: Receipt) => !r.id || r.id === ZERO32;

export function readReceipts(receipts: Receipt[], me: string): Simulated {
  const s: Simulated = { spent: new Map(), received: new Map(), calls: [] };
  for (const r of receipts) {
    const amount = BigInt(r.amount ?? "0");
    const asset = (r.assetId ?? "").toLowerCase();
    switch (r.receiptType) {
      case "CALL":
        if (r.to && !s.calls.includes(r.to.toLowerCase())) s.calls.push(r.to.toLowerCase());
        if (fromScript(r) && amount > 0n) add(s.spent, asset, amount);
        break;
      case "TRANSFER":
        if (fromScript(r) && amount > 0n) add(s.spent, asset, amount);
        break;
      case "TRANSFER_OUT":
        if (fromScript(r) && amount > 0n) add(s.spent, asset, amount);
        if ((r.toAddress ?? "").toLowerCase() === me && amount > 0n) add(s.received, asset, amount);
        break;
    }
  }
  return s;
}

export interface Described {
  title: string;
  titleMsg?: Msg;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  simulated: boolean;
  blind: boolean;
}

export const amountText = (asset: AssetRef, v: bigint) => `${formatUnits(v, asset.decimals)} ${asset.symbol}`;

/**
 * Balance changes for this account, the network fee excluded (it is shown on its own): what you put in comes back as
 * Coin outputs to you, coins contracts sent you, and the leftover of each asset when its Change output is yours.
 * Leftover = everything put in − Coin outputs − what the script spent (simulation); the fee is taken from the base
 * asset's leftover by the network.
 */
export function describeFlows(
  tx: ScriptTx,
  a: Analysis,
  sim: Simulated | null,
  ctx: { networkId: NetworkId; me: string; baseAssetId: string; maxFee: bigint },
): { balanceChanges: BalanceChange[]; warnings: Warning[]; lines: { label: string; value: string }[] } {
  const norm = (k: string) => (k === "base" ? ctx.baseAssetId : k);
  const mineIn = new Map<string, bigint>();
  for (const [k, v] of a.mineIn) add(mineIn, norm(k), v);
  const allIn = new Map<string, bigint>();
  for (const [k, v] of a.allIn) add(allIn, norm(k), v);
  const assets = new Set<string>([...mineIn.keys(), ...a.toMe.keys(), ...(sim ? sim.received.keys() : [])]);
  const warnings: Warning[] = [];
  const lines: { label: string; value: string }[] = [];
  const changes: BalanceChange[] = [];
  for (const id of assets) {
    const asset = assetFor(ctx.networkId, id);
    const leftover = (allIn.get(id) ?? 0n) - (a.coinOut.get(id) ?? 0n) - (sim?.spent.get(id) ?? 0n);
    let delta = -(mineIn.get(id) ?? 0n) + (a.toMe.get(id) ?? 0n) + (sim?.received.get(id) ?? 0n);
    const changeTo = a.change.get(id);
    if (leftover > 0n) {
      if (changeTo === ctx.me) delta += leftover;
      else if (mineIn.get(id)) {
        if (changeTo) {
          const m = msg("bg.fuel.changeToOther", { symbol: asset.symbol, to: short(changeTo) });
          warnings.push({ level: "danger", code: "malicious-transaction", message: m.fallback, msg: m });
        } else {
          // No Change output: what's left after the fee isn't sent anywhere and is lost.
          const lost = id === ctx.baseAssetId ? leftover - ctx.maxFee : leftover;
          if (lost > 0n) {
            const m = msg("bg.fuel.leftoverLost", { amount: amountText(asset, lost) });
            warnings.push({ level: "danger", code: "malicious-transaction", message: m.fallback, msg: m });
          }
        }
      }
    }
    if (delta !== 0n) changes.push({ asset, delta: delta.toString() });
  }
  return { balanceChanges: changes, warnings, lines };
}

/** "Send 0.5 ETH to 0x033d…5e17" when exactly one asset leaves to exactly one other owner, else a general title. */
export function transferTitle(a: Analysis, networkId: NetworkId): { title: string; titleMsg?: Msg } | null {
  if (!a.sends.length) return null;
  const to = new Set(a.sends.map((s) => s.to));
  const assets = new Set(a.sends.map((s) => s.assetId));
  if (to.size === 1 && assets.size === 1) {
    const asset = assetFor(networkId, a.sends[0]!.assetId);
    const total = a.sends.reduce((t, s) => t + s.amount, 0n);
    const m = msg("bg.req.sendTo", { amount: amountText(asset, total), to: short(a.sends[0]!.to) });
    return { title: m.fallback, titleMsg: m };
  }
  const m = msg("bg.req.sendToCount", { count: to.size });
  return { title: m.fallback, titleMsg: m };
}

export function sendLines(a: Analysis, networkId: NetworkId): { label: string; value: string }[] {
  return a.sends.map((s) => ({ label: "To", value: `${s.to} (${amountText(assetFor(networkId, s.assetId), s.amount)})` }));
}

/** The dry run failed or couldn't run: the network's reason is raw node text, so it isn't shown. */
export function simulationFailed(): Warning {
  return { level: "danger", code: "simulation-failed", message: say("bg.warn.cantTestRun") };
}
