/**
 * Plain-language description of a Cardano transaction from the signer's point of view, plus which of the
 * account's keys must sign (payment, stake) and which signatures belong to someone else.
 */
import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { type Credential, addressToBech32, poolIdToBech32, shortAddress } from "./address.js";
import { CborMap, CborTag, type CborValue, asInt } from "./cbor.js";
import type { AssetMeta } from "./tokens.js";
import { assetRefFor } from "./tokens.js";
import { type ParsedTx, type TxInput, type TxOutput, addressCred, usesScripts } from "./tx.js";
import { type Value, addValue, displayAssetName, emptyValue, nameOf } from "./value.js";
import { equal, formatUnits, hex, joinWords } from "./util.js";
import { adaAsset } from "./networks.js";
import { say } from "@clip-wallet/core";

export interface Me {
  paymentKeyHash: Uint8Array;
  stake?: Credential;
  networkId: number;
}

export interface Resolved {
  address: Uint8Array;
  value: Value;
}

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
  /** True when every input was resolved, so balance changes are exact. */
  complete: boolean;
  fee: bigint;
  needs: { payment: boolean; stake: boolean };
  /** Key hashes (hex) that must sign and aren't this account's. */
  foreign: string[];
  /** Assets referenced (for metadata lookups by the caller). */
  units: string[];
}

export const refOf = (i: TxInput) => `${hex(i.txHash)}#${i.index}`;

const isMine = (me: Me, c: Credential | undefined, role: "payment" | "stake") =>
  !!c && c.kind === "key" && equal(c.hash, role === "payment" ? me.paymentKeyHash : (me.stake?.hash ?? new Uint8Array()));

export function isMyAddress(me: Me, address: Uint8Array): boolean {
  const c = addressCred(address);
  return !!c && isMine(me, c.payment, "payment");
}

export function ada(lovelace: bigint): string {
  return `${formatUnits(lovelace, 6)} ADA`;
}

export function assetAmount(unit: string, qty: bigint, metas: Map<string, AssetMeta>): string {
  const m = metas.get(unit);
  const sym = m?.ticker ?? m?.name ?? displayAssetName(nameOf(unit));
  return `${formatUnits(qty, m?.decimals ?? 0)} ${sym}`;
}

export function valueText(v: Value, metas: Map<string, AssetMeta>): string {
  const parts: string[] = [];
  if (v.coin !== 0n) parts.push(ada(v.coin));
  for (const [u, q] of v.assets) parts.push(assetAmount(u, q, metas));
  return joinWords(parts) || "nothing";
}

function drepText(d: NonNullable<import("./tx.js").Certificate["drep"]>): string {
  if (d.kind === "abstain") return "Always abstain";
  if (d.kind === "no-confidence") return "Always no confidence";
  return `DRep ${hex(d.hash).slice(0, 12)}…`;
}

/** CIP-20 message (label 674) and other labels from auxiliary data. */
export function auxLines(aux: CborValue): { label: string; value: string }[] {
  let md: CborValue = null;
  if (aux instanceof CborMap) md = aux;
  else if (Array.isArray(aux) && aux[0] instanceof CborMap) md = aux[0];
  else if (aux instanceof CborTag && aux.tag === 259 && aux.value instanceof CborMap) md = aux.value.get(0) ?? null;
  if (!(md instanceof CborMap)) return [];
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of md.entries) {
    const label = asInt(k);
    if (label === 674n && v instanceof CborMap) {
      const msg = v.get("msg");
      const text = Array.isArray(msg) ? msg.filter((x) => typeof x === "string").join("") : typeof msg === "string" ? msg : "";
      if (text) out.push({ label: "Message", value: text });
      continue;
    }
    out.push({ label: "Attached data", value: label === 721n ? "NFT details (CIP-25)" : `Label ${label}` });
  }
  return out;
}

export function describeTx(
  tx: ParsedTx,
  p: { me: Me; resolved: Map<string, Resolved>; metas: Map<string, AssetMeta>; networkId: NetworkId; host: string; pools?: Map<string, string>; keyDeposit?: bigint },
): Described {
  const { me, resolved, metas } = p;
  const b = tx.body;
  const lines: { label: string; value: string }[] = [];
  const warnings: Warning[] = [];
  const foreign = new Set<string>();
  let blind = false;
  let complete = true;
  let payment = false;
  let stake = false;

  // Inputs: ours (spent from the wallet) vs other people's.
  const myIn = emptyValue();
  /** Addresses that fund this transaction besides us: outputs back to them are their change, not payments. */
  const otherFunders = new Set<string>();
  let unknownInputs = 0;
  for (const i of b.inputs) {
    const r = resolved.get(refOf(i));
    if (!r) {
      unknownInputs++;
      complete = false;
      continue;
    }
    const c = addressCred(r.address);
    if (isMine(me, c?.payment, "payment")) {
      payment = true;
      addValue(myIn, r.value);
    } else {
      if (c?.payment?.kind === "key") foreign.add(hex(c.payment.hash));
      otherFunders.add(hex(r.address));
    }
  }
  // Collateral: only taken if a script fails.
  const myCollateral = emptyValue();
  for (const i of b.collateral) {
    const r = resolved.get(refOf(i));
    if (!r) continue;
    const c = addressCred(r.address);
    if (isMine(me, c?.payment, "payment")) {
      payment = true;
      addValue(myCollateral, r.value);
    } else if (c?.payment?.kind === "key") foreign.add(hex(c.payment.hash));
  }

  const myOut = emptyValue();
  const toOthers: TxOutput[] = [];
  for (const o of b.outputs) {
    const c = addressCred(o.address);
    if (c && c.networkId !== me.networkId) {
      warnings.push({ level: "danger", code: "network-matters", message: "This sends to an address on a different Cardano network. Cardano will reject it." });
    }
    if (isMyAddress(me, o.address)) addValue(myOut, o.value);
    else if (!otherFunders.has(hex(o.address))) toOthers.push(o);
  }

  for (const s of b.requiredSigners) {
    if (equal(s, me.paymentKeyHash)) payment = true;
    else if (me.stake && equal(s, me.stake.hash)) stake = true;
    else foreign.add(hex(s));
  }

  // Certificates.
  let title = "";
  let depositPaid = 0n;
  let depositBack = 0n;
  for (const c of b.certs) {
    const mine = isMine(me, c.cred, "stake");
    const whose = mine ? "your" : "another account's";
    if (c.cred && !mine && c.cred.kind === "key" && c.type !== 0) foreign.add(hex(c.cred.hash));
    if (mine && c.type !== 0) stake = true;
    const poolName = c.pool ? (p.pools?.get(hex(c.pool)) ?? `pool ${poolIdToBech32(c.pool).slice(0, 14)}…`) : "";
    switch (c.type) {
      case 0:
      case 7:
        lines.push({ label: "Staking", value: `Turn on staking for ${whose} ADA` });
        if (mine) depositPaid += c.deposit ?? p.keyDeposit ?? 0n;
        break;
      case 1:
      case 8:
        lines.push({ label: "Staking", value: `Stop staking ${whose} ADA` });
        if (mine) {
          depositBack += c.deposit ?? p.keyDeposit ?? 0n;
          title ||= "Stop staking";
        }
        break;
      case 2:
      case 11:
        lines.push({ label: "Stake with", value: poolName });
        if (mine) title ||= say("bg.staking.stakeAdaWith", { name: poolName });
        if (c.type === 11 && mine) depositPaid += c.deposit ?? 0n;
        break;
      case 9:
      case 12:
        lines.push({ label: "Voting power", value: `Delegate ${whose} vote to ${drepText(c.drep!)}` });
        if (mine) title ||= "Delegate your vote";
        if (c.type === 12 && mine) depositPaid += c.deposit ?? 0n;
        break;
      case 10:
      case 13:
        lines.push({ label: "Stake with", value: poolName }, { label: "Voting power", value: drepText(c.drep!) });
        if (mine) title ||= say("bg.staking.stakeAdaWith", { name: poolName });
        if (c.type === 13 && mine) depositPaid += c.deposit ?? 0n;
        break;
      default:
        lines.push({ label: "Certificate", value: `Type ${c.type} (pool, committee or DRep registration)` });
        blind = true;
    }
  }
  if (depositPaid > 0n) lines.push({ label: "Deposit", value: `${ada(depositPaid)} (you get it back when you stop staking)` });
  if (depositBack > 0n) lines.push({ label: "Deposit back", value: ada(depositBack) });

  // Withdrawals.
  let myRewards = 0n;
  for (const w of b.withdrawals) {
    const c = addressCred(w.rewardAddress);
    if (isMine(me, c?.stake, "stake")) {
      stake = true;
      myRewards += w.amount;
    } else {
      if (c?.stake?.kind === "key") foreign.add(hex(c.stake.hash));
      lines.push({ label: "Withdraw from", value: shortAddress(w.rewardAddress) });
    }
  }
  if (myRewards > 0n) {
    lines.push({ label: "Claim rewards", value: ada(myRewards) });
    title ||= `Claim ${ada(myRewards)} staking rewards`;
  }

  // Mint / burn.
  const minted: string[] = [];
  const burned: string[] = [];
  for (const [u, q] of b.mint) (q > 0n ? minted : burned).push(assetAmount(u, q > 0n ? q : -q, metas));
  if (minted.length) lines.push({ label: "Creates", value: joinWords(minted) });
  if (burned.length) lines.push({ label: "Destroys", value: joinWords(burned) });

  // Payments to others.
  const sentTo = new Map<string, Value>();
  for (const o of toOthers) {
    const k = addressToBech32(o.address);
    addValue(sentTo.get(k) ?? (sentTo.set(k, emptyValue()), sentTo.get(k)!), o.value);
  }
  for (const [addr, v] of sentTo) lines.push({ label: "To", value: `${shortAddress(addr)}: ${valueText(v, metas)}` });

  // Net balance changes for this wallet (fee excluded: shown separately).
  const delta = emptyValue();
  addValue(delta, myOut);
  addValue(delta, myIn, -1n);
  if (payment && myIn.coin > 0n) delta.coin += b.fee;
  const balanceChanges: BalanceChange[] = [];
  if (delta.coin !== 0n) balanceChanges.push({ asset: adaAsset(p.networkId), delta: delta.coin.toString() });
  for (const [u, q] of delta.assets) {
    const m = metas.get(u);
    const asset: AssetRef = m ? assetRefFor(p.networkId, m) : assetRefFor(p.networkId, { unit: u, name: displayAssetName(nameOf(u)), decimals: 0 });
    balanceChanges.push({ asset, delta: q.toString() });
  }

  // Scripts, collateral, metadata, governance.
  const scripts = usesScripts(tx) || b.inputs.some((i) => addressCred(resolved.get(refOf(i))?.address ?? new Uint8Array())?.payment?.kind === "script");
  if (scripts) lines.push({ label: "Smart contract", value: `Runs ${p.host}'s contract` });
  if (myCollateral.coin > 0n) {
    const atRisk = b.totalCollateral ?? myCollateral.coin - (b.collateralReturn && isMyAddress(me, b.collateralReturn.address) ? b.collateralReturn.value.coin : 0n);
    lines.push({ label: "Collateral", value: `${ada(atRisk)} (kept only if the contract fails)` });
  }
  if (b.votingProcedures) lines.push({ label: "Governance", value: "Casts governance votes" });
  for (const pr of b.proposals) lines.push({ label: "Governance", value: `Submits a proposal (deposit ${ada(pr.deposit)})` });
  if (b.donation) lines.push({ label: "Treasury donation", value: ada(b.donation) });
  if (tx.auxRaw) lines.push(...auxLines(tx.aux));
  if (b.ttl !== undefined) lines.push({ label: "Valid until slot", value: b.ttl.toString() });
  if (b.networkId !== undefined && b.networkId !== me.networkId) {
    warnings.push({ level: "danger", code: "network-matters", message: "This transaction is for a different Cardano network." });
  }
  if (b.unknownKeys.length) {
    blind = true;
    lines.push({ label: "Unknown fields", value: b.unknownKeys.join(", ") });
  }
  if (unknownInputs) {
    lines.push({ label: "Unknown inputs", value: `${unknownInputs} input${unknownInputs > 1 ? "s" : ""} couldn't be looked up` });
    if (payment) {
      // Audit ADA-01: your payment key signs the whole body, so any input that couldn't be looked up may be one of
      // your coins; what leaves your wallet can't be shown. That is blind signing, not a caution.
      blind = true;
      warnings.push({ level: "danger", code: "blind-signing", message: "Some coins this spends couldn't be looked up and may be yours, so Clip Wallet can't show what leaves your wallet." });
    } else {
      warnings.push({ level: "caution", code: "simulation-failed", message: "Some coins this transaction spends couldn't be looked up, so the amounts may be incomplete." });
    }
  }

  if (!title) {
    const sends = [...sentTo];
    if (scripts) title = say("bg.req.approveTxFor", { host: p.host });
    else if (sends.length === 1 && payment) title = say("bg.req.sendTo", { amount: valueText(sends[0]![1], metas), to: shortAddress(sends[0]![0]) });
    else if (sends.length > 1 && payment) title = say("bg.req.sendToCount", { count: sends.length });
    else if (minted.length) title = `Create ${joinWords(minted)}`;
    else if (burned.length) title = `Destroy ${joinWords(burned)}`;
    else if (!payment && !stake) title = say("bg.req.coSignTxFor", { host: p.host });
    else title = say("bg.req.approveTxFor", { host: p.host });
  }

  const units = [...new Set([...b.mint.keys(), ...b.outputs.flatMap((o) => [...o.value.assets.keys()]), ...myIn.assets.keys()])];
  return { title, lines, balanceChanges, warnings, blind, complete, fee: b.fee, needs: { payment, stake }, foreign: [...foreign], units };
}
