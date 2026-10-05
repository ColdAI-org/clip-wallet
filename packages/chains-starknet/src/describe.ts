import { type AssetRef, type BalanceChange, ClipError, type NetworkId, type Warning, msg, titled, say } from "@clip-wallet/core";
import { hash, typedData as td } from "starknet";
import { chainOf, STARKNET_CHAINS } from "./networks.js";
import type { StarknetRpc } from "./rpc.js";
import { tokenAsset } from "./tokens.js";
import { formatUnits, padAddress, short, toHexFelt } from "./util.js";

/** Starknet field prime. Calldata felts must be below it. */
export const FIELD_PRIME = 2n ** 251n + 17n * 2n ** 192n + 1n;
const U128 = 2n ** 128n;
export const U256_MAX = 2n ** 256n - 1n;

export interface StarkCall {
  contractAddress: string;
  entrypoint: string;
  calldata: string[];
}

function felt(v: unknown, what: string): string {
  let n: bigint;
  try {
    if (typeof v === "bigint") n = v;
    else if (typeof v === "number" && Number.isSafeInteger(v)) n = BigInt(v);
    else if (typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) n = BigInt(v.trim());
    else throw new Error();
  } catch {
    throw new ClipError(`This request has an unreadable ${what}.`, "starknet/bad-params");
  }
  if (n < 0n || n >= FIELD_PRIME) throw new ClipError(`This request has an out-of-range ${what}.`, "starknet/bad-params");
  return toHexFelt(n);
}

/**
 * Calls from the wallet API (`{ calls: [{ contract_address, entry_point, calldata }] }`), WalletConnect
 * (`{ executionRequest: { calls: [{ contractAddress, entrypoint, calldata }] } }`) or a bare array of either.
 */
export function normalizeCalls(params: unknown): StarkCall[] {
  const p = params as { calls?: unknown; executionRequest?: { calls?: unknown } } | unknown[] | null;
  const raw = Array.isArray(p) ? p : (p?.calls ?? p?.executionRequest?.calls);
  if (!Array.isArray(raw) || raw.length === 0) throw new ClipError("This request has no calls in it.", "starknet/bad-params");
  if (raw.length > 64) throw new ClipError("This request has too many calls.", "starknet/bad-params");
  return raw.map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const to = o.contract_address ?? o.contractAddress;
    const entry = o.entry_point ?? o.entrypoint;
    if (typeof entry !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(entry)) {
      throw new ClipError("This request has a call without a readable function name.", "starknet/bad-params");
    }
    const cd = o.calldata ?? [];
    if (!Array.isArray(cd)) throw new ClipError("This request has unreadable call data.", "starknet/bad-params");
    return { contractAddress: padAddress(felt(to, "contract address")), entrypoint: entry, calldata: cd.map((x) => felt(x, "call argument")) };
  });
}

export const humanize = (name: string) => {
  const s = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Entry points that change who controls the account itself. */
const ACCOUNT_CONTROL = new Set(["upgrade", "set_public_key", "setPublicKey", "add_owner", "remove_owner", "change_owner", "change_guardian", "add_plugin", "set_signer"]);

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  warnings: Warning[];
  blind: boolean;
  /** What the calls themselves say moves (used when simulation is unavailable). */
  declared: BalanceChange[];
}

const u256 = (low: string, high: string) => BigInt(low) + BigInt(high) * U128;

export async function describeCalls(calls: StarkCall[], o: { me: string; host: string; networkId: NetworkId; rpc: StarknetRpc }): Promise<Described> {
  const me = BigInt(o.me);
  const titles: string[] = [];
  const lines: Described["lines"] = [];
  const warnings: Warning[] = [];
  const declared: BalanceChange[] = [];
  let blind = false;

  for (const call of calls) {
    const to = BigInt(call.contractAddress);
    const cd = call.calldata;
    const ep = call.entrypoint;

    if (to === me) {
      blind = true;
      titles.push(`Change your account (${humanize(ep)})`);
      lines.push({ label: "Account change", value: humanize(ep) });
      warnings.push({
        level: "danger",
        code: "blind-signing",
        message: ACCOUNT_CONTROL.has(ep)
          ? "This changes who controls your account. Anyone who asks for this can take everything in it."
          : "This calls your own account directly. Only continue if you know exactly why.",
      });
      continue;
    }

    if ((ep === "transfer" && cd.length === 3) || ((ep === "transfer_from" || ep === "transferFrom") && cd.length === 4 && BigInt(cd[0]!) === me)) {
      const [recipient, low, high] = ep === "transfer" ? (cd as [string, string, string]) : (cd.slice(1) as [string, string, string]);
      const asset = await tokenAsset(o.rpc, o.networkId, call.contractAddress);
      if (asset && asset.decimals > 0) {
        const amount = u256(low, high);
        titles.push(say("bg.req.sendSymbolTo", { amount: formatUnits(amount, asset.decimals), symbol: asset.symbol, to: short(padAddress(recipient)) }));
        lines.push({ label: "To", value: padAddress(recipient) }, { label: "Amount", value: `${formatUnits(amount, asset.decimals)} ${asset.symbol}` });
        if (asset.spam) warnings.push({ level: "caution", code: "known-scam", message: say("bg.starknet.notReal", { symbol: asset.symbol }) });
        declared.push({ asset, delta: (-amount).toString() });
        continue;
      }
      if (ep !== "transfer") {
        const id = u256(low, high);
        titles.push(say("bg.starknet.sendNft", { id, to: short(padAddress(recipient)) }));
        lines.push({ label: "To", value: padAddress(recipient) }, { label: "Collection", value: call.contractAddress });
        continue;
      }
    }

    if ((ep === "approve" || ep === "increase_allowance" || ep === "increaseAllowance") && cd.length === 3) {
      const [spender, low, high] = cd as [string, string, string];
      const asset = await tokenAsset(o.rpc, o.networkId, call.contractAddress);
      if (asset) {
        const amount = u256(low, high);
        const unlimited = amount >= U128 * U128 - 1n || amount >= 2n ** 255n;
        const what = unlimited ? `all your ${asset.symbol}` : `${formatUnits(amount, asset.decimals)} ${asset.symbol}`;
        titles.push(`Allow ${o.host} to spend ${what}`);
        lines.push({ label: "Allowed app", value: padAddress(spender) }, { label: "Spending limit", value: unlimited ? "Unlimited" : `${formatUnits(amount, asset.decimals)} ${asset.symbol}` });
        warnings.push(
          unlimited
            ? { level: "danger", code: "unlimited-approval", message: say("bg.starknet.letsTakeAll", { spender: short(padAddress(spender)), symbol: asset.symbol }) }
            : { level: "caution", code: "unlimited-approval", message: `This lets ${short(padAddress(spender))} move up to ${what} without asking again.` },
        );
        continue;
      }
    }

    if ((ep === "set_approval_for_all" || ep === "setApprovalForAll") && cd.length === 2) {
      const on = BigInt(cd[1]!) !== 0n;
      titles.push(on ? `Let ${o.host} move all your NFTs in a collection` : `Stop ${short(padAddress(cd[0]!))} from moving your NFTs`);
      lines.push({ label: "Allowed app", value: padAddress(cd[0]!) }, { label: "Collection", value: call.contractAddress });
      if (on) warnings.push({ level: "danger", code: "approval-for-all", message: "This lets that app take every NFT you hold in this collection, including ones you get later." });
      continue;
    }

    titles.push(say("bg.req.actionOnApp", { action: humanize(ep), app: o.host }));
    lines.push({ label: humanize(ep), value: `${short(call.contractAddress)}${cd.length ? ` (${cd.length} values)` : ""}` });
  }

  const title = titles.length === 1 ? titles[0]! : `Approve ${titles.length} actions for ${o.host}`;
  if (titles.length > 1) lines.unshift(...titles.map((t, i) => ({ label: say("bg.label.actionN", { n: i + 1 }), value: t })));
  return { title, lines, warnings, blind, declared };
}

/* ------------------------------------------------------------------ simulation */

interface Invocation {
  contract_address: string;
  events?: { keys: string[]; data: string[] }[];
  calls?: Invocation[];
}
export interface SimResult {
  transaction_trace: {
    type: string;
    execute_invocation?: Invocation | { revert_reason: string };
  };
  fee_estimation: FeeEstimate;
}
export interface FeeEstimate {
  l1_gas_consumed: string | number;
  l1_gas_price: string | number;
  l2_gas_consumed: string | number;
  l2_gas_price: string | number;
  l1_data_gas_consumed: string | number;
  l1_data_gas_price: string | number;
  overall_fee: string | number;
  unit?: string;
}

const TRANSFER = BigInt(hash.getSelectorFromName("Transfer"));

/** Sums ERC-20 Transfer events touching `me` (Cairo 1: keys [sel, from, to], data [low, high]; Cairo 0: data [from, to, low, high]). */
export function transfersFrom(inv: Invocation, me: bigint, out = new Map<string, bigint>()): Map<string, bigint> {
  for (const ev of inv.events ?? []) {
    if (!ev.keys.length || BigInt(ev.keys[0]!) !== TRANSFER) continue;
    let from: bigint, to: bigint, amount: bigint;
    if (ev.keys.length === 3 && ev.data.length === 2) {
      from = BigInt(ev.keys[1]!);
      to = BigInt(ev.keys[2]!);
      amount = u256(ev.data[0]!, ev.data[1]!);
    } else if (ev.keys.length === 1 && ev.data.length === 4) {
      from = BigInt(ev.data[0]!);
      to = BigInt(ev.data[1]!);
      amount = u256(ev.data[2]!, ev.data[3]!);
    } else continue; // ERC-721 (token id in keys) or unknown layout
    const token = padAddress(inv.contract_address);
    let d = out.get(token) ?? 0n;
    if (from === me) d -= amount;
    if (to === me) d += amount;
    out.set(token, d);
  }
  for (const c of inv.calls ?? []) transfersFrom(c, me, out);
  return out;
}

export async function balanceChangesFromSim(
  sims: SimResult[],
  o: { me: string; networkId: NetworkId; rpc: StarknetRpc },
): Promise<{ changes: BalanceChange[]; revert?: string }> {
  const me = BigInt(o.me);
  const sums = new Map<string, bigint>();
  for (const s of sims) {
    const ex = s.transaction_trace.execute_invocation;
    if (!ex) continue;
    if ("revert_reason" in ex) return { changes: [], revert: ex.revert_reason };
    transfersFrom(ex, me, sums);
  }
  const changes: BalanceChange[] = [];
  for (const [token, delta] of sums) {
    if (delta === 0n) continue;
    const asset: AssetRef = (await tokenAsset(o.rpc, o.networkId, token)) ?? {
      key: `starknet:${token}`,
      symbol: "?",
      name: `Token ${short(token)}`,
      decimals: 0,
      networkId: o.networkId,
      address: token,
    };
    changes.push({ asset, delta: delta.toString() });
  }
  return { changes };
}

export function plainRevert(reason: string): string {
  if (/u256_sub Overflow|exceeds balance|insufficient/i.test(reason)) return "This would fail: you don't have enough of a token it needs.";
  if (/allowance/i.test(reason)) return "This would fail: the app isn't allowed to move that token yet.";
  return "This would fail if you sent it now. Nothing will be charged if you cancel.";
}

/* ------------------------------------------------------------------ SNIP-12 typed data */

export interface TypedDataLike {
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

export function normalizeTypedData(params: unknown): TypedDataLike {
  const p = params as { typedData?: unknown } | null;
  const t = (p && typeof p === "object" && "typedData" in p ? p.typedData : params) as Partial<TypedDataLike> | null;
  if (!t || typeof t !== "object" || !t.types || typeof t.primaryType !== "string" || !t.domain || !t.message) {
    throw new ClipError("This signature request can't be read.", "starknet/bad-typed-data");
  }
  const { api_version: _v, ...rest } = t as TypedDataLike & { api_version?: unknown };
  return rest as TypedDataLike;
}

export function typedDataHash(t: TypedDataLike, me: string): bigint {
  try {
    return BigInt(td.getMessageHash(t as never, me));
  } catch (cause) {
    throw new ClipError("This signature request can't be read.", "starknet/bad-typed-data", cause);
  }
}

/** SNIP-12 domains bind a chain id; a different network's signature could be replayed there. */
export function checkTypedDataChain(t: TypedDataLike, networkId: NetworkId): void {
  const raw = t.domain.chainId;
  if (raw === undefined || raw === null || raw === "") return;
  const c = chainOf(String(raw));
  const mine = chainOf(networkId);
  if (!c || !mine || c !== mine) {
    const name = c ? (c === "SN_MAIN" ? "Starknet" : "Starknet Sepolia") : `chain ${String(raw)}`;
    throw new ClipError(`This app is asking you to sign for ${name}, a different network than the one it's connected to.`, "starknet/network-mismatch");
  }
}

export function describeTypedData(t: TypedDataLike, host: string): Omit<Described, "declared"> {
  const lines: Described["lines"] = [];
  const warnings: Warning[] = [];
  const name = typeof t.domain.name === "string" ? t.domain.name : undefined;
  if (name) lines.push({ label: "App", value: name });

  // SNIP-9 outside execution: a signature that lets someone else run calls from this account.
  if (/^OutsideExecution$/i.test(t.primaryType)) {
    const m = t.message as Record<string, unknown>;
    const calls = (m.Calls ?? m.calls) as unknown[] | undefined;
    lines.push({ label: "Lets run", value: `${Array.isArray(calls) ? calls.length : "some"} action(s) from your account` });
    const caller = m.Caller ?? m.caller;
    if (caller !== undefined) lines.push({ label: "Who can run it", value: BigInt(String(caller)) === 0x414e595f43414c4c4552n ? "Anyone" : padAddress(String(caller)) });
    const before = m["Execute Before"] ?? m.execute_before;
    if (before !== undefined) lines.push({ label: "Valid until", value: new Date(Number(BigInt(String(before))) * 1000).toISOString() });
    warnings.push({
      level: "danger",
      code: "blind-signing",
      message: "This signature lets someone else send transactions from your account later. Only sign it for an app you trust completely.",
    });
    return { ...titled(msg("bg.req.actForAccount", { host })), lines, warnings, blind: true };
  }

  lines.push({ label: "Type", value: humanize(t.primaryType) });
  for (const [k, v] of Object.entries(t.message).slice(0, 8)) {
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    lines.push({ label: humanize(k), value: s.length > 120 ? `${s.slice(0, 120)}…` : s });
  }
  lines.push({ label: "Requested by", value: host });
  return { ...titled(msg("bg.req.signMessage", { host })), lines, warnings, blind: false };
}

export function networkLabel(networkId: NetworkId): string {
  const c = chainOf(networkId);
  return c ? (c === "SN_MAIN" ? "Starknet" : "Starknet Sepolia") : networkId;
}

export { STARKNET_CHAINS };
