import { type AssetRef, type BalanceChange, type Msg, type Warning, msg } from "@clip-wallet/core";
import type { CosmosChainSpec } from "./networks.js";
import { assetOf } from "./networks.js";
import type { CosmosMsg } from "./msgs.js";
import type { Coin } from "./proto.js";
import { formatUnits, short } from "./util.js";

/**
 * Plain words for understood Cosmos messages. Titles come from the shared catalog where one fits
 * ("bg.req.sendTo", "bg.req.stakeWith", "bg.req.unstakeFrom", "bg.req.useFnOnContract") and from the
 * chains-cosmos section ("bg.cosmos.*") otherwise.
 */

export interface Line {
  label: string;
  value: string;
  labelMsg?: Msg;
  valueMsg?: Msg;
}

export interface Described {
  title: string;
  titleMsg?: Msg;
  lines: Line[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
}

export function amountText(spec: CosmosChainSpec, coins: readonly Coin[]): string {
  if (!coins.length) return `0 ${spec.native.symbol}`;
  return coins.map((c) => coinText(spec, c)).join(" + ");
}

export function coinText(spec: CosmosChainSpec, c: Coin): string {
  const a = assetOf(spec, c.denom);
  return `${formatUnits(BigInt(c.amount), a.decimals)} ${a.symbol}`;
}

const line = (label: string, value: string, labelMsg?: Msg, valueMsg?: Msg): Line => ({ label, value, ...(labelMsg ? { labelMsg } : {}), ...(valueMsg ? { valueMsg } : {}) });

const titled = (m: Msg): { title: string; titleMsg: Msg } => ({ title: m.fallback, titleMsg: m });

/** Adds `delta` (signed) of each coin to the running totals. */
function add(totals: Map<string, bigint>, coins: readonly Coin[], sign: 1n | -1n): void {
  for (const c of coins) totals.set(c.denom, (totals.get(c.denom) ?? 0n) + sign * BigInt(c.amount));
}

/** Messages that move or lock the user's funds, or hand over control, explained one by one. */
export function describeMsgs(spec: CosmosChainSpec, msgs: CosmosMsg[], me: string, host: string): Described {
  const totals = new Map<string, bigint>();
  const lines: Line[] = [];
  const warnings: Warning[] = [];
  let blind = false;
  const parts: { title: string; titleMsg?: Msg }[] = [];

  for (const m of msgs) {
    switch (m.kind) {
      case "send": {
        const amount = amountText(spec, m.amount);
        if (m.from === me) add(totals, m.amount, -1n);
        if (m.to === me) add(totals, m.amount, 1n);
        if (m.from === me) parts.push(titled(msg("bg.req.sendTo", { amount, to: short(m.to) })));
        else if (m.to === me) parts.push(titled(msg("bg.req.receiveFrom", { amount, from: short(m.from) })));
        else parts.push(titled(msg("bg.req.othersSend", { from: short(m.from), amount, to: short(m.to) })));
        lines.push(line("To", m.to));
        break;
      }
      case "ibc-transfer": {
        const amount = coinText(spec, m.token);
        if (m.sender === me) add(totals, [m.token], -1n);
        parts.push(titled(msg("bg.req.sendTo", { amount, to: short(m.receiver) })));
        lines.push(line("To", m.receiver));
        const through = msg("bg.cosmos.ibcChannel", { channel: m.channel });
        lines.push(line("Through", through.fallback, undefined, through));
        if (m.memo) lines.push(line("Memo", m.memo));
        const w = msg("bg.cosmos.ibcLeaves", { channel: m.channel });
        warnings.push({ level: "caution", code: "network-matters", message: w.fallback, msg: w });
        break;
      }
      case "delegate": {
        const amount = amountText(spec, m.amount);
        if (m.delegator === me) add(totals, m.amount, -1n);
        parts.push(titled(msg("bg.req.stakeWith", { amount, validator: short(m.validator) })));
        lines.push(line("Validator", m.validator));
        break;
      }
      case "undelegate": {
        const amount = amountText(spec, m.amount);
        parts.push(titled(msg("bg.req.unstakeFrom", { amount, validator: short(m.validator) })));
        lines.push(line("Validator", m.validator));
        const w = msg("bg.cosmos.unbonding", { symbol: spec.native.symbol });
        lines.push(line("What happens", w.fallback, undefined, w));
        break;
      }
      case "redelegate": {
        const amount = amountText(spec, m.amount);
        parts.push(titled(msg("bg.cosmos.moveStake", { amount, from: short(m.from), to: short(m.to) })));
        lines.push(line("Validator", m.to));
        break;
      }
      case "withdraw-rewards":
        parts.push(titled(msg("bg.cosmos.claimRewardsFrom", { validator: short(m.validator) })));
        lines.push(line("Validator", m.validator));
        break;
      case "execute": {
        const fn = m.msg && typeof m.msg === "object" && !Array.isArray(m.msg) && Object.keys(m.msg).length === 1 ? Object.keys(m.msg)[0]! : "";
        if (m.sender === me) add(totals, m.funds, -1n);
        parts.push(fn ? titled(msg("bg.req.useFnOnContract", { fn, contract: short(m.contract) })) : titled(msg("bg.req.contractActionFor", { host })));
        lines.push(line("Contract", m.contract));
        lines.push(line("Message", pretty(m.msg, m.msgText)));
        if (m.funds.length) lines.push(line("Also sends", amountText(spec, m.funds)));
        warnings.push({ level: "caution", code: "unknown-call", message: "We can't read what this message tells the contract to do. Only continue if you fully trust this app." });
        break;
      }
      case "authz-grant": {
        const all = isSendLike(m.authorization);
        parts.push(titled(msg("bg.cosmos.grantAuthz", { grantee: short(m.grantee) })));
        lines.push(line("Allowed", m.grantee));
        lines.push(line("Permission", m.authorization));
        if (m.expiration !== undefined) lines.push(line("Expires", new Date(Number(m.expiration) * 1000).toISOString().slice(0, 10)));
        const w = all ? msg("bg.cosmos.authzTakeAll", { grantee: short(m.grantee) }) : msg("bg.cosmos.authzActs", { grantee: short(m.grantee) });
        warnings.push({ level: "danger", code: "account-takeover", message: w.fallback, msg: w });
        break;
      }
      case "authz-revoke":
        parts.push(titled(msg("bg.cosmos.revokeAuthz", { grantee: short(m.grantee) })));
        lines.push(line("Permission", m.msgTypeUrl));
        break;
      case "feegrant": {
        parts.push(titled(msg("bg.cosmos.grantFees", { grantee: short(m.grantee), symbol: spec.native.symbol })));
        lines.push(line("Allowed", m.grantee));
        if (m.spendLimit.length) lines.push(line("Limit", amountText(spec, m.spendLimit)));
        const w = m.spendLimit.length
          ? msg("bg.cosmos.feegrantUpTo", { grantee: short(m.grantee), amount: amountText(spec, m.spendLimit) })
          : msg("bg.cosmos.feegrantAll", { grantee: short(m.grantee), symbol: spec.native.symbol });
        warnings.push({ level: "danger", code: "account-takeover", message: w.fallback, msg: w });
        break;
      }
      case "feegrant-revoke":
        parts.push(titled(msg("bg.cosmos.revokeFees", { grantee: short(m.grantee) })));
        break;
      case "unknown":
        blind = true;
        lines.push(line("Action", m.type));
        break;
    }
  }

  if (blind) {
    warnings.unshift({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." });
  }
  const balanceChanges: BalanceChange[] = [...totals.entries()]
    .filter(([, d]) => d !== 0n)
    .map(([denom, d]) => ({ asset: assetOf(spec, denom), delta: d.toString() }));

  let head: { title: string; titleMsg?: Msg };
  if (blind) head = titled(msg("bg.req.approveTxFor", { host }));
  else if (parts.length === 1) head = parts[0]!;
  else if (parts.length > 1) {
    head = parts[0]!;
    for (const p of parts.slice(1)) lines.push(line("Also", p.title, undefined, p.titleMsg));
  } else head = titled(msg("bg.req.approveTxFor", { host }));
  return { ...head, lines, balanceChanges, warnings, blind };
}

function isSendLike(authorization: string): boolean {
  return /MsgSend$|SendAuthorization$|MsgExec$|MsgTransfer$|MsgExecuteContract$|MsgGrant$/.test(authorization);
}

function pretty(v: unknown, text: string): string {
  const s = v === null ? text : JSON.stringify(v, null, 2);
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

export function feeLine(spec: CosmosChainSpec, fee: readonly Coin[]): Line {
  return line("Network fee", fee.length ? amountText(spec, fee) : `0 ${spec.native.symbol}`);
}

/** Fee for DecodedRequest.fee: the first coin (Cosmos fees are almost always one coin). */
export function feeOf(spec: CosmosChainSpec, fee: readonly Coin[]): { asset: AssetRef; amount: string } {
  const c = fee[0];
  return c ? { asset: assetOf(spec, c.denom), amount: c.amount } : { asset: assetOf(spec, spec.native.denom), amount: "0" };
}
