/**
 * Calls decoded through metadata (`Pallet.call(args)`) → plain language. Covers balances, Asset Hub assets,
 * staking, nomination pools, utility batches, remarks and proxies; anything else is shown as `pallet.call(args)`
 * with a caution, never silently.
 */
import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { getSs58AddressInfo } from "@polkadot-api/substrate-bindings";
import { locationAsset } from "./defi.js";
import { assetKey } from "./networks.js";
import { equal, formatUnits, hex, joinWords, short, textOf } from "./util.js";
import { msg, titled, say, recallMsg, knownMsg } from "@clip-wallet/core";

export interface DecodedCall {
  type: string;
  value: { type: string; value: unknown };
}

export interface AssetInfo {
  symbol: string;
  name: string;
  decimals: number;
}

export interface DescribeCtx {
  networkId: NetworkId;
  native: AssetRef;
  me: Uint8Array;
  host: string;
  /** Asset Hub asset metadata by id (curated list or Assets.Metadata). */
  asset(id: number): Promise<AssetInfo | null>;
}

export interface Described {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
}

/** Display form of any decoded value: bigint as decimal, bytes as text or 0x…, enums as Variant(value). */
export function show(v: unknown, depth = 0): string {
  if (depth > 6) return "…";
  if (typeof v === "bigint" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "none";
  if (v instanceof Uint8Array) return textOf(v) ?? `0x${hex(v)}`;
  if (Array.isArray(v)) return `[${v.map((x) => show(x, depth + 1)).join(", ")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.type === "string" && Object.keys(o).every((k) => k === "type" || k === "value")) {
      return o.value === undefined ? o.type : `${o.type}(${show(o.value, depth + 1)})`;
    }
    return `{ ${Object.entries(o).map(([k, x]) => `${k}: ${show(x, depth + 1)}`).join(", ")} }`;
  }
  return String(v);
}

/** MultiAddress / AccountId → SS58 (or a readable fallback). */
export function addressOf(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as { type?: string; value?: unknown };
    if (o.type === "Id" && typeof o.value === "string") return o.value;
    if (o.value instanceof Uint8Array) return `0x${hex(o.value)}`;
  }
  return show(v);
}

function isMe(addr: string, me: Uint8Array): boolean {
  try {
    const i = getSs58AddressInfo(addr);
    return i.isValid && equal(i.publicKey, me);
  } catch {
    return false;
  }
}

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : 0n);
const U128_HALF = 2n ** 127n;

export async function describeCall(call: DecodedCall, c: DescribeCtx, depth = 0): Promise<Described> {
  const pallet = call.type;
  const name = call.value.type;
  const a = (call.value.value ?? {}) as Record<string, unknown>;
  const sym = c.native.symbol;
  const amt = (v: unknown) => `${formatUnits(big(v), c.native.decimals)} ${sym}`;
  const out: Described = { title: "", lines: [], balanceChanges: [], warnings: [], blind: false };
  const nativeDelta = (v: bigint) => out.balanceChanges.push({ asset: c.native, delta: v.toString() });

  switch (`${pallet}.${name}`) {
    case "Balances.transfer_keep_alive":
    case "Balances.transfer_allow_death":
    case "Balances.transfer":
    case "Balances.force_transfer": {
      const to = addressOf(a.dest);
      Object.assign(out, titled(msg("bg.req.sendTo", { amount: amt(a.value), to: short(to) })));
      out.lines.push({ label: "To", value: to }, { label: "Amount", value: amt(a.value) });
      if (name === "transfer_allow_death") out.lines.push({ label: "Note", value: "May close your account if the rest falls below the minimum" });
      if (name === "force_transfer") {
        out.lines.push({ label: "From", value: addressOf(a.source) });
        out.blind = true;
      } else if (!isMe(to, c.me)) nativeDelta(-big(a.value));
      return out;
    }
    case "Balances.transfer_all": {
      const to = addressOf(a.dest);
      Object.assign(out, titled(msg("bg.req.sendAllTo", { symbol: sym, to: short(to) })));
      out.lines.push({ label: "To", value: to }, { label: "Amount", value: a.keep_alive ? `Everything except the minimum balance` : "Everything" });
      out.warnings.push({ level: "caution", code: "new-recipient", message: say("bg.substrate.emptiesBalance", { symbol: sym }) });
      return out;
    }
    case "Assets.transfer":
    case "Assets.transfer_keep_alive":
    case "Assets.transfer_approved":
    case "Assets.approve_transfer": {
      const id = Number(big(a.id));
      const info = Number.isSafeInteger(id) ? await c.asset(id) : null;
      const asset: AssetRef = {
        key: assetKey(c.networkId, id),
        symbol: info?.symbol ?? `Asset #${id}`,
        name: info?.name ?? `Asset #${id}`,
        decimals: info?.decimals ?? 0,
        networkId: c.networkId,
        address: String(id),
      };
      const amount = big(a.amount);
      const text = `${formatUnits(amount, asset.decimals)} ${asset.symbol}`;
      if (name === "approve_transfer") {
        const spender = addressOf(a.delegate);
        out.title = `Let ${short(spender)} spend ${amount >= U128_HALF ? `all your ${asset.symbol}` : text}`;
        out.lines.push({ label: "Spender", value: spender }, { label: "Limit", value: text });
        out.warnings.push({
          level: amount >= U128_HALF ? "danger" : "caution",
          code: "unlimited-approval",
          message: `${short(spender)} can move ${amount >= U128_HALF ? "all of your" : "up to " + text + " of your"} ${asset.symbol} without asking again.`,
        });
        return out;
      }
      const to = addressOf(a.target ?? a.dest);
      out.title = `Send ${text} to ${short(to)}`;
      out.lines.push({ label: "To", value: to }, { label: "Amount", value: text });
      if (!info) out.warnings.push({ level: "caution", code: "known-scam", message: say("bg.substrate.unknownAsset", { id }) });
      if (!isMe(to, c.me) && name !== "transfer_approved") out.balanceChanges.push({ asset, delta: (-amount).toString() });
      return out;
    }
    case "Staking.bond":
      Object.assign(out, titled(msg("bg.req.stake", { amount: amt(a.value) })));
      out.lines.push({ label: "Stake", value: amt(a.value) }, { label: "Rewards go to", value: show(a.payee) });
      return out;
    case "Staking.bond_extra":
      Object.assign(out, titled(msg("bg.req.stakeMore", { amount: amt(a.max_additional) })));
      return out;
    case "Staking.unbond":
      Object.assign(out, titled(msg("bg.req.unstake", { amount: amt(a.value) })));
      out.lines.push({ label: "Note", value: "Available to withdraw after the unbonding period" });
      return out;
    case "Staking.rebond":
      Object.assign(out, titled(msg("bg.req.restake", { amount: amt(a.value) })));
      return out;
    case "Staking.withdraw_unbonded":
      Object.assign(out, titled(msg("bg.req.withdrawUnstaked", { symbol: sym })));
      return out;
    case "Staking.nominate": {
      const targets = Array.isArray(a.targets) ? a.targets.map(addressOf) : [];
      out.title = say("bg.req.nominate", { count: targets.length }, `Nominate ${targets.length} validator${targets.length === 1 ? "" : "s"}`);
      out.lines.push(...targets.map((t, i) => ({ label: say("bg.staking.validator", { name: i + 1 }), value: t })));
      return out;
    }
    case "Staking.chill":
      out.title = "Stop nominating validators";
      return out;
    case "Staking.set_payee":
      out.title = "Change where staking rewards go";
      out.lines.push({ label: "Rewards go to", value: show(a.payee) });
      return out;
    case "Staking.payout_stakers":
    case "Staking.payout_stakers_by_page":
      Object.assign(out, titled(msg("bg.req.payOutRewards", { era: show(a.era) })));
      out.lines.push({ label: "Validator", value: addressOf(a.validator_stash) });
      return out;
    case "NominationPools.join":
      Object.assign(out, titled(msg("bg.req.stakeInPool", { amount: amt(a.amount), pool: show(a.pool_id) })));
      out.lines.push({ label: "Pool", value: `#${show(a.pool_id)}` }, { label: "Amount", value: amt(a.amount) });
      return out;
    case "NominationPools.bond_extra":
    case "NominationPools.bond_extra_other": {
      const e = a.extra as { type?: string; value?: unknown } | undefined;
      out.title = e?.type === "FreeBalance" ? `Stake ${amt(e.value)} more in your pool` : "Restake your pool rewards";
      if (name === "bond_extra_other") out.lines.push({ label: "For", value: addressOf(a.member) });
      return out;
    }
    case "NominationPools.unbond": {
      const member = addressOf(a.member_account);
      Object.assign(out, titled(msg("bg.req.unstakeFromPool", { amount: amt(a.unbonding_points) })));
      out.lines.push({ label: "Note", value: "Pool points; the amount can differ slightly. Withdraw after the unbonding period." });
      if (!isMe(member, c.me)) out.lines.push({ label: "Member", value: member });
      return out;
    }
    case "NominationPools.withdraw_unbonded":
      Object.assign(out, titled(msg("bg.req.withdrawUnstakedFromPool", { symbol: sym })));
      return out;
    case "NominationPools.claim_payout":
      out.title = "Claim your pool rewards";
      return out;
    case "NominationPools.claim_payout_other":
      Object.assign(out, titled(msg("bg.req.claimPoolRewardsFor", { who: short(addressOf(a.other)) })));
      return out;
    case "NominationPools.set_claim_permission":
      out.title = "Change who can claim your pool rewards";
      out.lines.push({ label: "Permission", value: show(a.permission) });
      return out;
    case "AssetConversion.swap_exact_tokens_for_tokens":
    case "AssetConversion.swap_tokens_for_exact_tokens": {
      const path = Array.isArray(a.path) ? a.path : [];
      const ends = [path[0], path[path.length - 1]].map(locationAsset);
      const refs: (AssetRef | null)[] = await Promise.all(
        ends.map(async (x) => {
          if (x === "native") return c.native;
          if (x === null) return null;
          const info = await c.asset(x);
          return info ? { key: assetKey(c.networkId, x), symbol: info.symbol, name: info.name, decimals: info.decimals, networkId: c.networkId, address: String(x) } : null;
        }),
      );
      const [from, to] = refs;
      if (path.length < 2 || !from || !to) break; // unknown or foreign asset: shown raw, with a caution
      const exactIn = name === "swap_exact_tokens_for_tokens";
      const sell = big(exactIn ? a.amount_in : a.amount_in_max);
      const buy = big(exactIn ? a.amount_out_min : a.amount_out);
      const fmt = (v: bigint, r: AssetRef) => `${formatUnits(v, r.decimals)} ${r.symbol}`;
      out.title = exactIn ? say("bg.near.swapAtLeast", { pay: fmt(sell, from), get: fmt(buy, to) }) : `Swap at most ${fmt(sell, from)} for ${fmt(buy, to)}`;
      out.lines.push(
        { label: exactIn ? "You pay" : "You pay at most", value: fmt(sell, from) },
        { label: exactIn ? "You get at least" : "You get", value: fmt(buy, to) },
        { label: "Route", value: path.length > 2 ? `Asset Hub pools (via ${sym})` : "Asset Hub pool" },
      );
      const to_ = addressOf(a.send_to);
      if (!isMe(to_, c.me)) {
        out.lines.push({ label: "Sent to", value: to_ });
        out.warnings.push({ level: "caution", code: "new-recipient", message: say("bg.substrate.buyGoesTo", { to: short(to_) }) });
      } else out.balanceChanges.push({ asset: to, delta: buy.toString() });
      out.balanceChanges.push({ asset: from, delta: (-sell).toString() });
      if (from.key === c.native.key && a.keep_alive === false) out.lines.push({ label: "Note", value: "May close your account if the rest falls below the minimum" });
      return out;
    }
    case "System.remark":
    case "System.remark_with_event": {
      const bytes = a.remark instanceof Uint8Array ? a.remark : new Uint8Array();
      out.title = "Post a note on-chain";
      out.lines.push({ label: "Note", value: textOf(bytes) ?? `0x${hex(bytes)}` });
      return out;
    }
    case "Utility.batch":
    case "Utility.batch_all":
    case "Utility.force_batch": {
      const calls = (Array.isArray(a.calls) ? a.calls : []) as DecodedCall[];
      if (depth > 3) {
        out.blind = true;
        out.title = say("bg.substrate.nestedActions", { count: calls.length });
        return out;
      }
      const parts = await Promise.all(calls.map((x) => describeCall(x, c, depth + 1)));
      out.title = parts.length === 1 ? parts[0]!.title : parts.length === 0 ? "Do nothing" : `${parts[0]!.title} and ${parts.length - 1} more`;
      parts.forEach((p, i) => {
        out.lines.push({ label: say("bg.label.actionN", { n: i + 1 }), value: p.title }, ...p.lines);
        out.balanceChanges.push(...p.balanceChanges);
        out.warnings.push(...p.warnings);
        out.blind ||= p.blind;
      });
      out.lines.push({ label: "Runs", value: name === "batch_all" ? "All or nothing" : name === "force_batch" ? "Each action even if one fails" : "In order, stopping at the first failure" });
      return out;
    }
    case "Proxy.add_proxy": {
      const who = addressOf(a.delegate);
      Object.assign(out, titled(msg("bg.req.giveControl", { who: short(who) })));
      out.lines.push({ label: "Delegate", value: who }, { label: "Allowed", value: show(a.proxy_type) });
      out.warnings.push({ level: "danger", code: "approval-for-all", message: `${short(who)} could act for your account (${show(a.proxy_type)}). Only approve this for an account you control.` });
      return out;
    }
    case "Proxy.remove_proxies":
      out.title = "Remove every account that can act for you";
      return out;
    case "Proxy.proxy": {
      const inner = await describeCall(a.call as DecodedCall, c, depth + 1);
      const innerMsg = recallMsg(inner.title) ?? knownMsg(inner.title);
      const title = innerMsg ? say("bg.req.onBehalfOf", { who: short(addressOf(a.real)), inner: innerMsg }) : `On behalf of ${short(addressOf(a.real))}: ${inner.title}`;
      return { ...inner, title, balanceChanges: [] };
    }
  }

  // Not described: show the decoded call. Root-level powers stay blind.
  out.title = `${pallet}.${name} for ${c.host}`;
  out.lines.push({ label: "Action", value: `${pallet}.${name}(${show(a)})` });
  if (pallet === "Sudo" || (pallet === "System" && /set_code|set_storage|kill/.test(name)) || (pallet === "Utility" && name === "dispatch_as")) {
    out.blind = true;
    out.warnings.push({ level: "danger", code: "blind-signing", message: "This asks for powers over the whole network or your account. Don't sign it unless you know exactly why." });
  } else {
    out.warnings.push({ level: "caution", code: "blind-signing", message: "Clip Wallet can't explain this action in plain words yet. Check the details before you sign." });
  }
  return out;
}

export function mergeChanges(changes: BalanceChange[]): BalanceChange[] {
  const m = new Map<string, BalanceChange>();
  for (const ch of changes) {
    const k = ch.asset.address ?? ch.asset.key;
    const e = m.get(k);
    m.set(k, e ? { asset: e.asset, delta: (BigInt(e.delta) + BigInt(ch.delta)).toString() } : ch);
  }
  return [...m.values()].filter((x) => x.delta !== "0");
}

export { joinWords };
