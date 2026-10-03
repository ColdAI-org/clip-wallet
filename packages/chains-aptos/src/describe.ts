import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import {
  type AnyRawTransaction,
  type EntryFunction,
  Ed25519PublicKey,
  TransactionExecutableEntryFunction,
  TransactionExecutableScript,
  TransactionInnerPayloadV1,
  TransactionPayloadEncryptedPayload,
  TransactionPayloadEntryFunction,
  TransactionPayloadMultiSig,
  TransactionPayloadScript,
  generateSignedTransactionForSimulation,
} from "@aptos-labs/ts-sdk";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { APT_METADATA, aptAsset, assetKey, isApt, longAddress } from "./networks.js";
import { AptosApiError, type AptosRest, plainAptosError } from "./rest.js";
import { formatUnits, fromHex, short } from "./util.js";

export type Role = "sender" | "secondary" | "feePayer";

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  /** Octas: gas used × unit price when simulated, else max gas × unit price. */
  fee: bigint;
  /** Someone else pays the fee. */
  sponsored: boolean;
  simulated: boolean;
  blind: boolean;
  warnings: Warning[];
}

export interface SimTx {
  success: boolean;
  vm_status: string;
  gas_used: string;
  gas_unit_price: string;
  max_gas_amount?: string;
  events: { type: string; data: Record<string, unknown> }[];
  changes: { type: string; address?: string; data?: { type: string; data: Record<string, unknown> } }[];
}

/* ------------------------------------------------------------------ asset metadata */

interface AssetInfo {
  decimals: number;
  symbol: string;
  name: string;
  iconUri?: string;
}

const infoCache = new Map<string, Promise<AssetInfo | null>>();
export function clearAssetCache(): void {
  infoCache.clear();
}

/** Fungible-asset Metadata or legacy CoinInfo, cached per endpoint. */
export function assetInfo(rest: AptosRest, assetType: string): Promise<AssetInfo | null> {
  const key = `${rest.base}|${assetType}`;
  let p = infoCache.get(key);
  if (!p) {
    p = (async () => {
      if (assetType.includes("::")) {
        const addr = assetType.split("::")[0]!;
        const r = await rest.get<{ data: { decimals: number; symbol: string; name: string } }>(
          `/accounts/${addr}/resource/${encodeURIComponent(`0x1::coin::CoinInfo<${assetType}>`)}`,
        );
        return { decimals: Number(r.data.decimals), symbol: r.data.symbol, name: r.data.name };
      }
      const r = await rest.get<{ data: { decimals: number; symbol: string; name: string; icon_uri?: string } }>(
        `/accounts/${longAddress(assetType)}/resource/0x1::fungible_asset::Metadata`,
      );
      const info: AssetInfo = { decimals: Number(r.data.decimals), symbol: r.data.symbol, name: r.data.name };
      if (r.data.icon_uri) info.iconUri = r.data.icon_uri;
      return info;
    })().catch(() => {
      infoCache.delete(key);
      return null;
    });
    infoCache.set(key, p);
  }
  return p;
}

export function assetFor(networkId: NetworkId, assetType: string, info: AssetInfo | null): AssetRef {
  if (isApt(assetType)) return aptAsset(networkId);
  const address = assetType.includes("::") ? assetType : longAddress(assetType);
  const tail = assetType.includes("::") ? assetType.split("::").pop()! : short(address);
  const a: AssetRef = { key: assetKey(networkId, assetType), symbol: info?.symbol || tail, name: info?.name || info?.symbol || tail, decimals: info?.decimals ?? 0, networkId, address };
  if (info?.iconUri && /^https:\/\//.test(info.iconUri)) a.logoUrl = info.iconUri;
  return a;
}

/* ------------------------------------------------------------------ helpers */

/** Primary fungible store of `owner` for `metadata`: sha3-256(owner || metadata || 0xFC) (object::create_user_derived_object_address). */
export function primaryStoreAddress(owner: string, metadata: string): string {
  const buf = new Uint8Array(65);
  buf.set(fromHex(longAddress(owner)), 0);
  buf.set(fromHex(longAddress(metadata)), 32);
  buf[64] = 0xfc;
  return `0x${Array.from(sha3_256(buf), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function entryFunctionOf(tx: AnyRawTransaction): EntryFunction | null {
  const p = tx.rawTransaction.payload;
  if (p instanceof TransactionPayloadEntryFunction) return p.entryFunction;
  if (p instanceof TransactionInnerPayloadV1 && p.executable instanceof TransactionExecutableEntryFunction) return p.executable.entryFunction;
  return null;
}

export function functionId(ef: EntryFunction): string {
  const addr = ef.module_name.address.toString();
  return `${addr}::${ef.module_name.name.identifier}::${ef.function_name.identifier}`;
}

function argBytes(ef: EntryFunction, i: number): Uint8Array | null {
  const a = ef.args[i] as unknown as { value?: { value?: Uint8Array }; bcsToBytes?: () => Uint8Array } | undefined;
  if (a?.value?.value instanceof Uint8Array) return a.value.value; // deserialized: EntryFunctionBytes
  // Built in this module from a payload (typed U64 / AccountAddress …): their BCS is the same argument bytes.
  return typeof a?.bcsToBytes === "function" ? a.bcsToBytes() : null;
}

function argAddress(ef: EntryFunction, i: number): string | null {
  const b = argBytes(ef, i);
  return b && b.length === 32 ? `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` : null;
}

function argU64(ef: EntryFunction, i: number): bigint | null {
  const b = argBytes(ef, i);
  if (!b || b.length !== 8) return null;
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[k]!);
  return v;
}

function typeArg(ef: EntryFunction, i: number): string | null {
  const t = ef.type_args[i];
  return t ? t.toString() : null;
}

/** What a known transfer moves: asset type, recipient, amount. */
export function transferOf(ef: EntryFunction): { assetType: string; to: string; amount: bigint } | null {
  const id = functionId(ef);
  switch (id) {
    case "0x1::aptos_account::transfer": {
      const to = argAddress(ef, 0);
      const amount = argU64(ef, 1);
      return to && amount != null ? { assetType: APT_METADATA, to, amount } : null;
    }
    case "0x1::aptos_account::transfer_coins":
    case "0x1::coin::transfer": {
      const t = typeArg(ef, 0);
      const to = argAddress(ef, 0);
      const amount = argU64(ef, 1);
      return t && to && amount != null ? { assetType: t, to, amount } : null;
    }
    case "0x1::primary_fungible_store::transfer":
    case "0x1::aptos_account::transfer_fungible_assets": {
      const metadata = argAddress(ef, 0);
      const to = argAddress(ef, 1);
      const amount = argU64(ef, 2);
      return metadata && to && amount != null ? { assetType: metadata, to, amount } : null;
    }
    default:
      return null;
  }
}

function words(fn: string): string {
  const w = fn.replace(/_/g, " ").trim();
  return w ? `${w[0]!.toUpperCase()}${w.slice(1)}` : "Use";
}

/* ------------------------------------------------------------------ simulation */

export async function simulate(rest: AptosRest, tx: AnyRawTransaction, myPublicKey: string, role: Role, estimate = false): Promise<SimTx> {
  const pk = new Ed25519PublicKey(myPublicKey);
  const signed = await generateSignedTransactionForSimulation({
    transaction: tx,
    ...(role === "sender" ? { signerPublicKey: pk } : {}),
    ...(role === "feePayer" ? { feePayerPublicKey: pk } : {}),
  });
  const q = estimate ? "?estimate_gas_unit_price=true&estimate_max_gas_amount=true" : "";
  const r = await rest.postBcs<SimTx[]>(`/transactions/simulate${q}`, signed);
  const t = r[0];
  if (!t) throw new Error("no simulation result");
  return t;
}

/** My balance changes (and what others receive) from a simulation's events and write set. */
export function balanceEffects(sim: SimTx, me: string): { mine: Map<string, bigint>; received: Map<string, Map<string, bigint>> } {
  const myAddr = longAddress(me);
  const stores = new Map<string, { owner?: string; metadata?: string }>();
  for (const c of sim.changes) {
    if (c.type !== "write_resource" || !c.address || !c.data) continue;
    const addr = longAddress(c.address);
    const s = stores.get(addr) ?? {};
    if (c.data.type === "0x1::fungible_asset::FungibleStore") {
      const inner = (c.data.data.metadata as { inner?: string } | undefined)?.inner;
      if (inner) s.metadata = longAddress(inner);
    } else if (c.data.type === "0x1::object::ObjectCore") {
      const owner = c.data.data.owner;
      if (typeof owner === "string") s.owner = longAddress(owner);
    }
    stores.set(addr, s);
  }
  const mine = new Map<string, bigint>();
  const received = new Map<string, Map<string, bigint>>();
  const add = (owner: string, assetType: string, delta: bigint) => {
    const key = isApt(assetType) ? APT_METADATA : assetType;
    if (owner === myAddr) mine.set(key, (mine.get(key) ?? 0n) + delta);
    else if (delta > 0n) {
      const m = received.get(owner) ?? new Map<string, bigint>();
      m.set(key, (m.get(key) ?? 0n) + delta);
      received.set(owner, m);
    }
  };
  for (const e of sim.events) {
    const amount = typeof e.data.amount === "string" || typeof e.data.amount === "number" ? BigInt(e.data.amount) : null;
    if (amount == null) continue;
    if (e.type === "0x1::fungible_asset::Withdraw" || e.type === "0x1::fungible_asset::Deposit") {
      const store = typeof e.data.store === "string" ? longAddress(e.data.store) : null;
      if (!store) continue;
      const s = stores.get(store);
      if (!s?.metadata) continue;
      const owner = s.owner ?? (primaryStoreAddress(myAddr, s.metadata) === store ? myAddr : null);
      if (!owner) continue;
      add(owner, s.metadata, e.type.endsWith("Withdraw") ? -amount : amount);
    } else if (e.type === "0x1::coin::CoinWithdraw" || e.type === "0x1::coin::CoinDeposit") {
      const account = typeof e.data.account === "string" ? longAddress(e.data.account) : null;
      const coinType = typeof e.data.coin_type === "string" ? e.data.coin_type : null;
      if (!account || !coinType) continue;
      add(account, coinType, e.type.endsWith("Withdraw") ? -amount : amount);
    }
  }
  return { mine, received };
}

/* ------------------------------------------------------------------ describe */

export interface DescribeOptions {
  networkId: NetworkId;
  me: string;
  publicKey: string;
  rest: AptosRest;
  host: string;
  role: Role;
  simulate: boolean;
}

export async function describeTransaction(tx: AnyRawTransaction, o: DescribeOptions): Promise<Described> {
  const me = longAddress(o.me);
  const raw = tx.rawTransaction;
  const sender = longAddress(raw.sender.toString());
  const feePayer = tx.feePayerAddress ? longAddress(tx.feePayerAddress.toString()) : sender;
  const iPay = o.role === "feePayer" || (!tx.feePayerAddress && o.role === "sender");
  const lines: { label: string; value: string }[] = [];
  const warnings: Warning[] = [];
  let blind = false;
  let title = `Approve a transaction for ${o.host}`;
  let transfer: ReturnType<typeof transferOf> = null;

  const p = raw.payload;
  const ef = entryFunctionOf(tx);
  if (ef) {
    const id = functionId(ef);
    transfer = transferOf(ef);
    if (!transfer) {
      const fn = ef.function_name.identifier;
      if (id === "0x1::delegation_pool::add_stake") {
        const amount = argU64(ef, 1);
        title = amount != null ? `Stake ${formatUnits(amount, 8)} APT` : "Stake APT";
        const pool = argAddress(ef, 0);
        if (pool) lines.push({ label: "Stake with", value: pool });
      } else if (id === "0x1::delegation_pool::unlock") {
        const amount = argU64(ef, 1);
        title = amount != null ? `Unstake ${formatUnits(amount, 8)} APT` : "Unstake APT";
      } else if (id === "0x1::delegation_pool::withdraw") {
        title = "Withdraw unstaked APT";
      } else {
        title = `${words(fn)} on ${o.host}`;
        lines.push({ label: "App action", value: `${short(ef.module_name.address.toString())}::${ef.module_name.name.identifier}::${fn}` });
        if (ef.type_args.length) lines.push({ label: "Types", value: ef.type_args.map((t) => t.toString()).join(", ") });
      }
    } else {
      lines.push({ label: "Sends to", value: longAddress(transfer.to) === me ? "Your own account" : longAddress(transfer.to) });
    }
  } else if (p instanceof TransactionPayloadScript || (p instanceof TransactionInnerPayloadV1 && p.executable instanceof TransactionExecutableScript)) {
    blind = true;
    lines.push({ label: "Action", value: "Runs a custom script" });
    warnings.push({ level: "danger", code: "blind-signing", message: "This runs custom code Clip Wallet can't read. Only sign it if you trust the app." });
  } else if (p instanceof TransactionPayloadMultiSig) {
    title = "Approve a shared-account transaction";
    lines.push({ label: "Shared account", value: p.multiSig.multisig_address.toString() });
    const inner = p.multiSig.transaction_payload?.transaction_payload;
    if (inner && "function_name" in inner) lines.push({ label: "App action", value: functionId(inner as EntryFunction) });
  } else if (p instanceof TransactionPayloadEncryptedPayload) {
    blind = true;
    lines.push({ label: "Action", value: "Encrypted transaction" });
    warnings.push({ level: "danger", code: "blind-signing", message: "This transaction is encrypted, so Clip Wallet can't show what it does." });
  } else {
    blind = true;
    warnings.push({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." });
  }

  if (o.role === "secondary") lines.push({ label: "Started by", value: sender });
  if (o.role === "feePayer") lines.push({ label: "You pay the fee for", value: sender });

  let fee = raw.max_gas_amount * raw.gas_unit_price;
  let simulated = false;
  const balanceChanges: BalanceChange[] = [];
  let received = new Map<string, Map<string, bigint>>();
  if (o.simulate && !(p instanceof TransactionPayloadEncryptedPayload)) {
    try {
      const sim = await simulate(o.rest, tx, o.publicKey, o.role);
      simulated = true;
      fee = BigInt(sim.gas_used) * BigInt(sim.gas_unit_price);
      if (!sim.success) {
        warnings.push({ level: "danger", code: "simulation-failed", message: `This transaction would fail: ${plainAptosError(sim.vm_status)}` });
      }
      const eff = balanceEffects(sim, me);
      received = eff.received;
      for (const [type, delta] of eff.mine) {
        if (delta === 0n) continue;
        balanceChanges.push({ asset: assetFor(o.networkId, type, isApt(type) ? null : await assetInfo(o.rest, type)), delta: delta.toString() });
      }
    } catch (err) {
      const msg = err instanceof AptosApiError ? plainAptosError(`${err.errorCode ?? ""} ${err.message}`) : "Clip Wallet couldn't preview this transaction.";
      warnings.push({ level: "caution", code: "simulation-failed", message: `${msg} Check the details carefully.` });
    }
  }

  if (transfer) {
    const to = longAddress(transfer.to);
    const got = received.get(to);
    const amount = got && got.size === 1 ? [...got.values()][0]! : transfer.amount;
    const a = assetFor(o.networkId, transfer.assetType, isApt(transfer.assetType) ? null : await assetInfo(o.rest, transfer.assetType));
    title = `Send ${formatUnits(amount, a.decimals)} ${a.symbol} to ${short(to)}`;
  }

  if (o.role === "feePayer") title = `Pay the network fee: ${title[0]!.toLowerCase()}${title.slice(1)}`;

  if (!iPay) {
    lines.push({ label: "Network fee", value: feePayer === longAddress("0x0") ? "Paid by the app's sponsor" : `Paid by ${short(feePayer)}` });
  }
  return { title, lines, balanceChanges, fee, sponsored: !iPay, simulated, blind, warnings };
}
