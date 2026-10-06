import { type AssetRef, type BalanceChange, ClipError, type Msg, type NetworkId, type Warning, msg, titled } from "@clip-wallet/core";
import { decodeString, decodeTrc20, decodeUint, isUnlimited } from "./abi.js";
import { encodeAddress, sameAddress } from "./address.js";
import { trxAsset, usdtAsset } from "./networks.js";
import type { TronRpc } from "./rpc.js";
import {
  type ContractEntry,
  type PermissionParams,
  parseDelegate,
  parsePermissionUpdate,
  parseResource,
  parseTransfer,
  parseTransferAsset,
  parseTrigger,
  parseVote,
  showAddress,
} from "./tx.js";
import { formatUnits, fromHex, hex, short } from "./util.js";

type Line = { label: string; value: string; labelMsg?: Msg; valueMsg?: Msg };

export interface Described {
  title: string;
  titleMsg?: Msg;
  lines: Line[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
  /** TransferContract / TransferAssetContract: the recipient, for the activation fee. */
  recipient?: Uint8Array;
  /** TriggerSmartContract: what to run for the energy estimate and simulation. */
  call?: { contract: Uint8Array; data: Uint8Array; callValue: bigint };
}

export interface TokenInfo {
  symbol: string;
  decimals: number;
  name: string;
  known: boolean;
}

export interface DescribeEnv {
  networkId: NetworkId;
  me: Uint8Array;
  rpc: TronRpc;
  token(contract: Uint8Array): Promise<TokenInfo | null>;
  /** Chain parameter getUnfreezeDelayDays (14 on mainnet). */
  unstakeDays(): Promise<bigint | null>;
}

const trx = (sun: bigint) => `${formatUnits(sun, 6)} TRX`;
const resourceMsg = (code: bigint): Msg => (code === 1n ? msg("bg.tron.energy") : code === 2n ? msg("bg.tron.tronPower") : msg("bg.tron.bandwidth"));
const blindWarning = (): Warning => ({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." });
const neg = (asset: AssetRef, amount: bigint): BalanceChange => ({ asset, delta: (-amount).toString() });
const pos = (asset: AssetRef, amount: bigint): BalanceChange => ({ asset, delta: amount.toString() });

/** A TRC-20 token as an AssetRef: Tether USDT keeps its key; anything else is "trc20:<address>". */
export function trc20Asset(networkId: NetworkId, contract: Uint8Array, info: TokenInfo | null): AssetRef {
  const address = encodeAddress(contract);
  const usdt = usdtAsset(networkId);
  if (usdt && usdt.address === address) return usdt;
  const symbol = info?.symbol ?? "tokens";
  const lookalike = /^(USDT|USDC|USDD|TUSD|TRX|WTRX)$/i.test(symbol);
  return { key: `trc20:${address}`, symbol, name: info?.name ?? symbol, decimals: info?.decimals ?? 0, networkId, address, ...(lookalike ? { spam: true } : {}) };
}

/** Token metadata by constant calls (symbol(), decimals(), name()). */
export async function readTokenInfo(rpc: TronRpc, owner: string, contract: Uint8Array, networkId: NetworkId): Promise<TokenInfo | null> {
  const usdt = usdtAsset(networkId);
  const address = encodeAddress(contract);
  if (usdt && usdt.address === address) return { symbol: usdt.symbol, decimals: usdt.decimals, name: usdt.name, known: true };
  const call = async (selector: string) => (await rpc.triggerConstant(owner, address, fromHex(selector)).catch(() => null))?.constant_result?.[0];
  const [sym, dec, name] = await Promise.all([call("95d89b41"), call("313ce567"), call("06fdde03")]);
  const symbol = decodeString(sym);
  const decimals = decodeUint(dec);
  if (!symbol || decimals === null || decimals > 36n) return null;
  return { symbol: symbol.slice(0, 16), decimals: Number(decimals), name: (decodeString(name) ?? symbol).slice(0, 48), known: false };
}

function permissionLine(p: PermissionParams): string {
  const keys = p.keys.map((k) => `${showAddress(k.address)} ×${k.weight}`).join(", ");
  return msg("bg.tron.keysThreshold", { keys, threshold: p.threshold.toString() }).fallback;
}

export async function describeContract(c: ContractEntry, env: DescribeEnv): Promise<Described> {
  const TRX = trxAsset(env.networkId);
  switch (c.name) {
    case "TransferContract": {
      const p = parseTransfer(c.value);
      if (sameAddress(p.to, env.me)) throw new ClipError("That's your own address.", "tron/self-transfer");
      const to = showAddress(p.to);
      return {
        ...titled(msg("bg.req.sendTo", { amount: trx(p.amount), to: short(to) })),
        lines: [{ label: "To", value: to }],
        balanceChanges: [neg(TRX, p.amount)],
        warnings: [],
        blind: false,
        recipient: p.to,
      };
    }
    case "TransferAssetContract": {
      const p = parseTransferAsset(c.value);
      if (sameAddress(p.to, env.me)) throw new ClipError("That's your own address.", "tron/self-transfer");
      const to = showAddress(p.to);
      const info = await env.rpc
        .post<{ abbr?: string; name?: string; precision?: number }>("/wallet/getassetissuebyid", { value: p.assetName })
        .catch(() => ({}) as { abbr?: string; name?: string; precision?: number });
      const text = (h?: string) => {
        try {
          return h ? new TextDecoder("utf-8", { fatal: true }).decode(fromHex(h)) : undefined;
        } catch {
          return undefined;
        }
      };
      const abbr = (text(info.abbr) ?? text(info.name) ?? "tokens").slice(0, 16);
      const decimals = typeof info.precision === "number" && info.precision >= 0 && info.precision <= 18 ? info.precision : 0;
      const lookalike = /^(USDT|USDC|USDD|TUSD|TRX|WTRX)$/i.test(abbr);
      const asset: AssetRef = { key: `trc10:${p.assetName}`, symbol: abbr, name: text(info.name)?.slice(0, 48) ?? abbr, decimals, networkId: env.networkId, address: p.assetName, ...(lookalike ? { spam: true } : {}) };
      const warnings: Warning[] = lookalike ? [{ level: "caution", code: "known-scam", message: msg("bg.warn.spamToken", { symbol: abbr }).fallback, msg: msg("bg.warn.spamToken", { symbol: abbr }) }] : [];
      return {
        ...titled(msg("bg.req.sendTo", { amount: `${formatUnits(p.amount, decimals)} ${abbr}`, to: short(to) })),
        lines: [
          { label: "To", value: to },
          { label: "Token", value: `${abbr} (TRC-10 ${p.assetName})` },
        ],
        balanceChanges: [neg(asset, p.amount)],
        warnings,
        blind: false,
        recipient: p.to,
      };
    }
    case "TriggerSmartContract":
      return describeTrigger(c, env);
    case "FreezeBalanceV2Contract": {
      const p = parseResource(c.value);
      const days = await env.unstakeDays();
      return {
        ...titled(msg("bg.tron.stakeFor", { amount: trx(p.amount), resource: resourceMsg(p.resource) })),
        lines: days !== null ? [{ label: "Unstaking takes", value: msg("bg.tron.days", { count: days.toString() }).fallback, valueMsg: msg("bg.tron.days", { count: days.toString() }) }] : [],
        balanceChanges: [neg(TRX, p.amount)],
        warnings: [],
        blind: false,
      };
    }
    case "UnfreezeBalanceV2Contract": {
      const p = parseResource(c.value);
      const days = await env.unstakeDays();
      return {
        ...titled(msg("bg.req.unstake", { amount: trx(p.amount) })),
        lines: [
          { label: "Unstake", value: resourceMsg(p.resource).fallback, valueMsg: resourceMsg(p.resource) },
          ...(days !== null ? [{ label: "Unstaking takes", value: msg("bg.tron.days", { count: days.toString() }).fallback, valueMsg: msg("bg.tron.days", { count: days.toString() }) }] : []),
        ],
        balanceChanges: [],
        warnings: [],
        blind: false,
      };
    }
    case "WithdrawExpireUnfreezeContract":
      return { ...titled(msg("bg.req.withdrawUnstaked", { symbol: "TRX" })), lines: [], balanceChanges: [], warnings: [], blind: false };
    case "CancelAllUnfreezeV2Contract":
      return { ...titled(msg("bg.tron.cancelUnstaking")), lines: [], balanceChanges: [], warnings: [], blind: false };
    case "DelegateResourceContract": {
      const p = parseDelegate(c.value);
      const to = showAddress(p.receiver);
      const lines: Line[] = [{ label: "To", value: to }];
      if (p.lock) {
        const hours = ((p.lockPeriod > 0n ? p.lockPeriod : 86_400n) * 3n) / 3600n; // lock_period in 3-second blocks; 0 = the default 3 days
        lines.push({ label: "Locked", value: msg("bg.tron.lockedHours", { hours: hours.toString() }).fallback, valueMsg: msg("bg.tron.lockedHours", { hours: hours.toString() }) });
      }
      return { ...titled(msg("bg.tron.lend", { resource: resourceMsg(p.resource), amount: trx(p.balance), to: short(to) })), lines, balanceChanges: [], warnings: [], blind: false };
    }
    case "UnDelegateResourceContract": {
      const p = parseDelegate(c.value);
      const to = showAddress(p.receiver);
      return {
        ...titled(msg("bg.tron.stopLending", { resource: resourceMsg(p.resource), amount: trx(p.balance), to: short(to) })),
        lines: [{ label: "To", value: to }],
        balanceChanges: [],
        warnings: [],
        blind: false,
      };
    }
    case "VoteWitnessContract": {
      const p = parseVote(c.value);
      return {
        ...titled(msg("bg.tron.vote", { count: p.votes.length })),
        lines: p.votes.map((v) => ({ label: "Validator", value: `${showAddress(v.address)}: ${v.count}` })),
        balanceChanges: [],
        warnings: [{ level: "info", code: "network-matters", message: msg("bg.tron.votesReplace").fallback, msg: msg("bg.tron.votesReplace") }],
        blind: false,
      };
    }
    case "WithdrawBalanceContract":
      return { ...titled(msg("bg.tron.claimVoteRewards")), lines: [], balanceChanges: [], warnings: [], blind: false };
    case "AccountPermissionUpdateContract": {
      const p = parsePermissionUpdate(c.value);
      const lines: Line[] = [];
      if (p.ownerPermission) lines.push({ label: "Owner", value: permissionLine(p.ownerPermission) });
      if (p.witness) lines.push({ label: "Validator", value: permissionLine(p.witness) });
      p.actives.forEach((a) => lines.push({ label: "Permission", value: `${a.name || `#${a.id}`}: ${permissionLine(a)}` }));
      return {
        ...titled(msg("bg.tron.changePermissions")),
        lines,
        balanceChanges: [],
        warnings: [{ level: "danger", code: "account-takeover", message: "This hands control of your account to someone else. They could take everything in it." }],
        blind: false,
      };
    }
    default:
      return {
        ...titled(msg("bg.req.approveTx")),
        lines: [{ label: "Type", value: c.name ?? `#${c.type}` }],
        balanceChanges: [],
        warnings: [blindWarning()],
        blind: true,
      };
  }
}

async function describeTrigger(c: ContractEntry, env: DescribeEnv): Promise<Described> {
  const TRX = trxAsset(env.networkId);
  const p = parseTrigger(c.value);
  const contract = showAddress(p.contract);
  const call = { contract: p.contract, data: p.data, callValue: p.callValue };
  const alsoTrx: Line[] = p.callValue > 0n ? [{ label: "Also sends", value: trx(p.callValue) }] : [];
  const trxOut: BalanceChange[] = p.callValue > 0n ? [neg(TRX, p.callValue)] : [];
  const t = p.callTokenValue === 0n ? decodeTrc20(p.data) : null;
  if (!t) {
    const selector = p.data.length >= 4 ? `0x${hex(p.data.subarray(0, 4))}` : "(none)";
    return {
      ...titled(msg("bg.req.useFnOnContract", { fn: selector, contract: short(contract) })),
      lines: [
        { label: "Contract", value: contract },
        { label: "Function", value: selector },
        ...alsoTrx,
        ...(p.callTokenValue > 0n ? [{ label: "Also sends", value: `${p.callTokenValue} (TRC-10 ${p.tokenId})` }] : []),
      ],
      balanceChanges: trxOut,
      warnings: [blindWarning()],
      blind: true,
      call,
    };
  }
  const info = await env.token(p.contract);
  const asset = trc20Asset(env.networkId, p.contract, info);
  const amountOf = (v: bigint) => (info ? `${formatUnits(v, info.decimals)} ${info.symbol}` : `${v} ${asset.symbol}`);
  const warnings: Warning[] = [];
  if (!info) warnings.push({ level: "caution", code: "unknown-call", message: "Clip Wallet can name this call but can't fully read it, so some of its effects may not be shown." });
  if (asset.spam) warnings.push({ level: "caution", code: "known-scam", message: msg("bg.warn.spamToken", { symbol: asset.symbol }).fallback, msg: msg("bg.warn.spamToken", { symbol: asset.symbol }) });
  const tokenLine: Line = { label: "Token", value: `${asset.symbol} (${contract})` };

  if (t.kind === "transfer") {
    if (sameAddress(t.to, env.me)) throw new ClipError("That's your own address.", "tron/self-transfer");
    const to = showAddress(t.to);
    return {
      ...titled(msg("bg.req.sendTo", { amount: amountOf(t.amount), to: short(to) })),
      lines: [{ label: "To", value: to }, tokenLine, ...alsoTrx],
      balanceChanges: [neg(asset, t.amount), ...trxOut],
      warnings,
      blind: false,
      call,
    };
  }
  if (t.kind === "transferFrom") {
    const from = showAddress(t.from);
    const to = showAddress(t.to);
    const changes: BalanceChange[] = [];
    if (sameAddress(t.from, env.me) && !sameAddress(t.to, env.me)) changes.push(neg(asset, t.amount));
    if (sameAddress(t.to, env.me) && !sameAddress(t.from, env.me)) changes.push(pos(asset, t.amount));
    return {
      ...titled(msg("bg.req.moveFromTo", { amount: amountOf(t.amount), from: short(from), to: short(to) })),
      lines: [{ label: "From", value: from }, { label: "To", value: to }, tokenLine, ...alsoTrx],
      balanceChanges: [...changes, ...trxOut],
      warnings,
      blind: false,
      call,
    };
  }
  const spender = showAddress(t.spender);
  const lines: Line[] = [{ label: "Spender", value: spender }, tokenLine, ...alsoTrx];
  if (t.amount === 0n) {
    return { ...titled(msg("bg.req.stopSpending", { spender: short(spender), symbol: asset.symbol })), lines, balanceChanges: trxOut, warnings, blind: false, call };
  }
  if (isUnlimited(t.amount)) {
    const m = msg("bg.warn.letsTakeAll", { spender: short(spender), symbol: asset.symbol });
    return {
      ...titled(msg("bg.req.allowSpendUnlimited", { spender: short(spender), symbol: asset.symbol })),
      lines,
      balanceChanges: trxOut,
      warnings: [{ level: "danger", code: "unlimited-approval", message: m.fallback, msg: m }, ...warnings],
      blind: false,
      call,
    };
  }
  return { ...titled(msg("bg.req.allowSpend", { spender: short(spender), amount: amountOf(t.amount) })), lines, balanceChanges: trxOut, warnings, blind: false, call };
}

/** Memo (raw.data) as a line. */
export function memoLine(data: Uint8Array): Line | null {
  if (!data.length) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(data);
    if (!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) return { label: "Memo", value: s };
  } catch {
    /* not text */
  }
  return { label: "Data (not text)", value: `0x${hex(data)}` };
}
