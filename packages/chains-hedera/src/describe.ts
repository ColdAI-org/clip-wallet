import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import {
  AccountAllowanceApproveTransaction,
  AccountAllowanceDeleteTransaction,
  AccountDeleteTransaction,
  type AccountId,
  AccountUpdateTransaction,
  ContractExecuteTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  TopicMessageSubmitTransaction,
  type Transaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { longZeroToAccountId } from "./address.js";
import type { Mirror, MirrorToken } from "./mirror.js";
import { hbarAsset, tokenAssetKey } from "./networks.js";
import { abiAddress, abiUint, lookupSelector } from "./selectors.js";
import { bodyKind, scheduledInner, transactionFromSchedulableBody } from "./tx.js";
import { abs, formatUnits, hex, joinWords } from "./util.js";

export interface Line {
  label: string;
  value: string;
}

export interface Described {
  title: string;
  lines: Line[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
}

export interface DescribeContext {
  networkId: NetworkId;
  /** The user's 0.0.x, or null while the alias hasn't been auto-created yet. */
  me: string | null;
  /** The user's EVM alias, lower-case 0x… */
  myAlias: string;
  mirror: Mirror;
}

/** 2^63-1: HTS amounts are int64, so this is the largest allowance an app can ask for. */
const INT64_MAX = 9223372036854775807n;
/** All HBAR that will ever exist (50B × 10^8 tinybars). */
const HBAR_TOTAL_SUPPLY_TINYBARS = 5_000_000_000_000_000_000n;

type TokenAsset = AssetRef & { known: boolean; info: MirrorToken | null };

async function tokenAsset(dc: DescribeContext, tokenId: string, fallbackDecimals?: number | null): Promise<TokenAsset> {
  const info = await dc.mirror.token(tokenId).catch(() => null);
  const decimals = info ? Number(info.decimals) : (fallbackDecimals ?? 0);
  return {
    key: tokenAssetKey(dc.networkId, tokenId),
    symbol: info?.symbol || tokenId,
    name: info?.name || `Token ${tokenId}`,
    decimals,
    networkId: dc.networkId,
    address: tokenId,
    known: !!info || fallbackDecimals != null,
    info,
  };
}

function amountText(asset: AssetRef & { known?: boolean }, base: bigint): string {
  if (asset.known === false) return `${abs(base)} units of token ${asset.address}`;
  return `${formatUnits(abs(base), asset.decimals)} ${asset.symbol}`;
}

export function accountLabel(a: AccountId | null | undefined): string {
  if (!a) return "an unknown account";
  if (a.evmAddress) return `0x${hex(a.evmAddress.toBytes())}`;
  return a.toString();
}

function isMe(dc: DescribeContext, a: AccountId | null | undefined): boolean {
  if (!a) return false;
  if (a.evmAddress) return `0x${hex(a.evmAddress.toBytes())}`.toLowerCase() === dc.myAlias;
  return dc.me != null && a.toString() === dc.me;
}

function evmLabel(evm: string | null): string {
  if (!evm) return "an unknown address";
  return longZeroToAccountId(evm) ?? evm;
}

function blindResult(title: string, why: string, lines: Line[] = []): Described {
  return {
    title,
    lines,
    balanceChanges: [],
    warnings: [{ level: "danger", code: "blind-signing", message: why }],
    blind: true,
  };
}

/* ------------------------------------------------------------------ transfers */

interface Ledger {
  /** per asset key: asset + my net delta */
  mine: Map<string, { asset: AssetRef & { known?: boolean }; delta: bigint }>;
  /** other accounts → what they get (+) or give (−) */
  others: Map<string, { label: string; parts: Map<string, { asset: AssetRef & { known?: boolean }; delta: bigint }> }>;
  nftsOut: string[];
  nftsIn: string[];
  allowanceOwners: Set<string>;
  hooks: boolean;
}

function addOther(l: Ledger, label: string, asset: AssetRef & { known?: boolean }, delta: bigint) {
  const o = l.others.get(label) ?? { label, parts: new Map() };
  const k = `${asset.key}|${asset.address ?? ""}|${asset.symbol}`;
  const p = o.parts.get(k) ?? { asset, delta: 0n };
  p.delta += delta;
  o.parts.set(k, p);
  l.others.set(label, o);
}

function addMine(l: Ledger, asset: AssetRef & { known?: boolean }, delta: bigint) {
  const k = `${asset.key}|${asset.address ?? ""}`;
  const m = l.mine.get(k) ?? { asset, delta: 0n };
  m.delta += delta;
  l.mine.set(k, m);
}

async function describeTransfer(tx: TransferTransaction, dc: DescribeContext): Promise<Described> {
  const l: Ledger = { mine: new Map(), others: new Map(), nftsOut: [], nftsIn: [], allowanceOwners: new Set(), hooks: false };
  const warnings: Warning[] = [];
  const lines: Line[] = [];
  const hbar = hbarAsset(dc.networkId);
  const nftChanges = new Map<string, { asset: AssetRef; delta: bigint }>();

  for (const t of tx.hbarTransfersList) {
    const amt = BigInt(t.amount.toTinybars().toString());
    if (t.isApproved && amt < 0n) l.allowanceOwners.add(accountLabel(t.accountId));
    if ((t as unknown as { hookCall?: unknown }).hookCall) l.hooks = true;
    if (isMe(dc, t.accountId)) addMine(l, hbar, amt);
    else addOther(l, accountLabel(t.accountId), hbar, amt);
  }

  const tokenTransfers = (tx as unknown as { _tokenTransfers: { tokenId: { toString(): string }; accountId: AccountId; amount: { toString(): string }; isApproved: boolean; expectedDecimals: number | null; hookCall?: unknown }[] })._tokenTransfers ?? [];
  const credited: { account: AccountId; tokenId: string; asset: TokenAsset }[] = [];
  for (const t of tokenTransfers) {
    const tokenId = t.tokenId.toString();
    const asset = await tokenAsset(dc, tokenId, t.expectedDecimals);
    const amt = BigInt(t.amount.toString());
    if (t.isApproved && amt < 0n) l.allowanceOwners.add(accountLabel(t.accountId));
    if (t.hookCall) l.hooks = true;
    if (isMe(dc, t.accountId)) addMine(l, asset, amt);
    else {
      addOther(l, accountLabel(t.accountId), asset, amt);
      if (amt > 0n) credited.push({ account: t.accountId, tokenId, asset });
    }
  }

  const nftTransfers = (tx as unknown as { _nftTransfers: { tokenId: { toString(): string }; senderAccountId: AccountId; receiverAccountId: AccountId; serialNumber: { toString(): string }; isApproved: boolean; senderHookCall?: unknown; receiverHookCall?: unknown }[] })._nftTransfers ?? [];
  for (const n of nftTransfers) {
    const tokenId = n.tokenId.toString();
    const asset = await tokenAsset(dc, tokenId, 0);
    const label = `${asset.info?.name || asset.symbol} #${n.serialNumber.toString()}`;
    const nftAsset: AssetRef = { ...stripExtra(asset), decimals: 0 };
    if (n.isApproved) l.allowanceOwners.add(accountLabel(n.senderAccountId));
    if (n.senderHookCall || n.receiverHookCall) l.hooks = true;
    const fromMe = isMe(dc, n.senderAccountId);
    const toMe = isMe(dc, n.receiverAccountId);
    if (fromMe && !toMe) {
      l.nftsOut.push(label);
      bump(nftChanges, nftAsset, -1n);
      addOther(l, accountLabel(n.receiverAccountId), { ...nftAsset, symbol: label, known: true }, 1n);
    } else if (toMe && !fromMe) {
      l.nftsIn.push(label);
      bump(nftChanges, nftAsset, 1n);
      addOther(l, accountLabel(n.senderAccountId), { ...nftAsset, symbol: label, known: true }, -1n);
    } else if (!fromMe && !toMe) {
      lines.push({ label: "NFT", value: `${label}: ${accountLabel(n.senderAccountId)} → ${accountLabel(n.receiverAccountId)}` });
    }
    if (!toMe) credited.push({ account: n.receiverAccountId, tokenId, asset });
  }

  const out: string[] = [];
  const inn: string[] = [];
  const balanceChanges: BalanceChange[] = [];
  for (const { asset, delta } of l.mine.values()) {
    if (delta === 0n) continue;
    (delta < 0n ? out : inn).push(amountText(asset, delta));
    balanceChanges.push({ asset: stripExtra(asset), delta: delta.toString() });
  }
  out.push(...l.nftsOut);
  inn.push(...l.nftsIn);
  for (const { asset, delta } of nftChanges.values()) balanceChanges.push({ asset, delta: delta.toString() });

  const receivers = [...l.others.values()].filter((o) => [...o.parts.values()].some((p) => p.delta > 0n));
  const senders = [...l.others.values()].filter((o) => [...o.parts.values()].some((p) => p.delta < 0n));
  const who = (list: typeof receivers) => (list.length === 1 ? list[0]!.label : `${list.length} accounts`);

  let title: string;
  if (out.length && !inn.length) title = `Send ${joinWords(out)} to ${who(receivers)}`;
  else if (inn.length && !out.length) title = `Receive ${joinWords(inn)} from ${who(senders)}`;
  else if (out.length && inn.length) {
    const party = [...l.others.values()];
    title = `Trade ${joinWords(out)} for ${joinWords(inn)}${party.length === 1 ? ` with ${party[0]!.label}` : ""}`;
  } else title = "Move funds between other accounts";

  for (const o of l.others.values()) {
    const gets = [...o.parts.values()].filter((p) => p.delta > 0n).map((p) => amountText(p.asset, p.delta));
    const gives = [...o.parts.values()].filter((p) => p.delta < 0n).map((p) => amountText(p.asset, p.delta));
    if (gets.length) lines.push({ label: "To", value: `${o.label} gets ${joinWords(gets)}` });
    if (gives.length) lines.push({ label: "From", value: `${o.label} gives ${joinWords(gives)}` });
  }
  if (l.allowanceOwners.size) {
    lines.push({ label: "Paid from an allowance", value: [...l.allowanceOwners].join(", ") });
  }
  if (l.hooks) {
    warnings.push({ level: "caution", code: "blind-signing", message: "This transfer runs custom account code (a hook) that Clip Wallet can't preview." });
  }

  // Will the recipient accept the token? (association / free auto-association slots)
  const checked = new Set<string>();
  for (const c of credited) {
    const key = `${accountLabel(c.account)}|${c.tokenId}`;
    if (checked.has(key) || isMe(dc, c.account)) continue;
    checked.add(key);
    const state = await associationState(dc, accountLabel(c.account), c.tokenId).catch(() => "unknown" as const);
    if (state === "missing") {
      warnings.push({
        level: "caution",
        code: "new-recipient",
        message: `${accountLabel(c.account)} hasn't added the ${c.asset.symbol} token yet, so this transfer will fail and the fee is still charged. Ask them to add ${c.asset.symbol} first.`,
      });
    } else if (state === "new") {
      warnings.push({
        level: "info",
        code: "new-recipient",
        message: `${accountLabel(c.account)} is a new address. Its Hedera account opens with this transfer.`,
      });
    }
  }

  return { title, lines, balanceChanges, warnings, blind: false };
}

function bump(m: Map<string, { asset: AssetRef; delta: bigint }>, asset: AssetRef, d: bigint) {
  const k = asset.address ?? asset.key;
  const e = m.get(k) ?? { asset, delta: 0n };
  e.delta += d;
  m.set(k, e);
}

function stripExtra(a: AssetRef & { known?: boolean; info?: unknown }): AssetRef {
  const { known: _k, info: _i, ...rest } = a as AssetRef & { known?: boolean; info?: unknown };
  return rest;
}

export type AssociationState = "associated" | "free-slot" | "missing" | "new" | "unknown";

/** Whether `account` can receive `tokenId` right now. */
export async function associationState(dc: { mirror: Mirror }, account: string, tokenId: string): Promise<AssociationState> {
  if (await dc.mirror.tokenRelationship(account, tokenId)) return "associated";
  const acct = await dc.mirror.account(account);
  if (!acct) return "new"; // HIP-583 lazy create; new accounts get unlimited auto-association (HIP-904)
  const max = acct.max_automatic_token_associations;
  if (max === -1) return "free-slot";
  if (max === 0) return "missing";
  const rels = await dc.mirror.tokenRelationships(acct.account);
  const used = rels.filter((r) => r.automatic_association).length;
  return used < max ? "free-slot" : "missing";
}

/* ------------------------------------------------------------------ associations */

async function describeAssociate(tx: TokenAssociateTransaction | TokenDissociateTransaction, dc: DescribeContext, add: boolean): Promise<Described> {
  const ids = (tx.tokenIds ?? []).map(String);
  const assets = await Promise.all(ids.map((id) => tokenAsset(dc, id)));
  const names = assets.map((a) => (a.info ? `the ${a.symbol} token` : `token ${a.address}`));
  const yours = tx.accountId == null || isMe(dc, tx.accountId);
  const where = yours ? "your account" : `account ${accountLabel(tx.accountId)}`;
  const title = add ? `Add ${joinWords(names)} to ${where}` : `Remove ${joinWords(names)} from ${where}`;
  const lines: Line[] = assets.map((a) => ({ label: "Token", value: a.info ? `${a.name} (${a.symbol}, ${a.address})` : `${a.address}` }));
  if (add) lines.push({ label: "Why", value: "Hedera accounts must add a token before they can hold it." });
  return { title, lines, balanceChanges: [], warnings: [], blind: false };
}

/* ------------------------------------------------------------------ allowances */

async function describeAllowance(tx: AccountAllowanceApproveTransaction, dc: DescribeContext): Promise<Described> {
  const parts: { title: string; warning?: Warning }[] = [];
  const lines: Line[] = [];

  for (const a of tx.hbarApprovals) {
    const amt = a.amount ? BigInt(a.amount.toTinybars().toString()) : 0n;
    const spender = accountLabel(a.spenderAccountId);
    if (amt === 0n) {
      parts.push({ title: `Remove ${spender}'s permission to spend your HBAR` });
    } else if (amt >= HBAR_TOTAL_SUPPLY_TINYBARS) {
      parts.push({
        title: `Allow ${spender} to spend all your HBAR`,
        warning: { level: "danger", code: "unlimited-approval", message: `${spender} could take all your HBAR at any time, without asking again.` },
      });
    } else {
      parts.push({
        title: `Allow ${spender} to spend up to ${formatUnits(amt, 8)} HBAR`,
        warning: { level: "caution", code: "unlimited-approval", message: `${spender} can spend up to ${formatUnits(amt, 8)} HBAR from your account without asking again.` },
      });
    }
  }

  for (const a of tx.tokenApprovals) {
    const asset = await tokenAsset(dc, a.tokenId.toString());
    const amt = a.amount ? BigInt(a.amount.toString()) : 0n;
    const spender = accountLabel(a.spenderAccountId);
    const supply = asset.info?.total_supply ? BigInt(asset.info.total_supply) : null;
    const huge = amt >= INT64_MAX / 2n || (supply != null && supply > 0n && amt >= supply);
    if (amt === 0n) {
      parts.push({ title: `Remove ${spender}'s permission to spend your ${asset.symbol}` });
    } else if (huge) {
      parts.push({
        title: `Allow ${spender} to spend unlimited ${asset.symbol}`,
        warning: { level: "danger", code: "unlimited-approval", message: `${spender} could take all your ${asset.symbol} at any time, without asking again.` },
      });
    } else {
      parts.push({
        title: `Allow ${spender} to spend up to ${amountText(asset, amt)}`,
        warning: { level: "caution", code: "unlimited-approval", message: `${spender} can spend up to ${amountText(asset, amt)} without asking again.` },
      });
    }
  }

  for (const a of tx.tokenNftApprovals) {
    const asset = await tokenAsset(dc, a.tokenId.toString(), 0);
    const coll = asset.info?.name || asset.symbol;
    const spender = accountLabel(a.spenderAccountId);
    if (a.allSerials) {
      parts.push({
        title: `Allow ${spender} to move all your ${coll} NFTs`,
        warning: { level: "danger", code: "approval-for-all", message: `${spender} could move every ${coll} NFT you own, now and in the future, without asking again.` },
      });
    } else {
      const serials = (a.serialNumbers ?? []).map((s) => `#${s.toString()}`);
      parts.push({
        title: `Allow ${spender} to move ${coll} ${joinWords(serials)}`,
        warning: { level: "caution", code: "approval-for-all", message: `${spender} can move ${coll} ${joinWords(serials)} without asking again.` },
      });
    }
  }

  if (!parts.length) return blindResult("Change spending permissions", "This permission request is empty or unreadable.");
  for (const p of parts) lines.push({ label: "Permission", value: p.title });
  return {
    title: parts.length === 1 ? parts[0]!.title : "Give apps permission to spend from your account",
    lines,
    balanceChanges: [],
    warnings: parts.flatMap((p) => (p.warning ? [p.warning] : [])),
    blind: false,
  };
}

/* ------------------------------------------------------------------ contracts */

async function describeContract(tx: ContractExecuteTransaction, dc: DescribeContext): Promise<Described> {
  const contract = tx.contractId?.toString() ?? "an unknown contract";
  const data = tx.functionParameters ?? new Uint8Array();
  const payable = tx.payableAmount ? BigInt(tx.payableAmount.toTinybars().toString()) : 0n;
  const hbar = hbarAsset(dc.networkId);
  const balanceChanges: BalanceChange[] = payable > 0n ? [{ asset: hbar, delta: (-payable).toString() }] : [];
  const lines: Line[] = [{ label: "Contract", value: contract }];
  if (payable > 0n) lines.push({ label: "Also sends", value: `${formatUnits(payable, 8)} HBAR` });
  if (tx.gas) lines.push({ label: "Gas limit", value: tx.gas.toString() });

  if (data.length === 0) {
    if (payable > 0n) return { title: `Send ${formatUnits(payable, 8)} HBAR to contract ${contract}`, lines, balanceChanges, warnings: [], blind: false };
    return blindResult(`Use contract ${contract}`, "This contract call has no readable function.", lines);
  }
  const entry = lookupSelector(data);
  if (!entry) {
    lines.push({ label: "Function", value: `0x${hex(data.subarray(0, 4))} (unknown)` });
    return { ...blindResult(`Use contract ${contract}`, "Clip Wallet can't read what this contract call does.", lines), balanceChanges };
  }
  lines.push({ label: "Function", value: entry.signature });

  // HTS tokens are also ERC-20/721 contracts at their own id (HIP-218 / HIP-376).
  const token = tx.contractId ? await dc.mirror.token(contract).catch(() => null) : null;
  const asset = token ? await tokenAsset(dc, contract) : null;
  const warnings: Warning[] = [];
  let title = `${entry.plain} with contract ${contract}`;

  switch (entry.name) {
    case "transfer": {
      const to = evmLabel(abiAddress(data, 0));
      const amt = abiUint(data, 1) ?? 0n;
      if (asset) {
        title = `Send ${amountText(asset, amt)} to ${to}`;
        balanceChanges.push({ asset: stripExtra(asset), delta: (-amt).toString() });
      } else title = `Send tokens from contract ${contract} to ${to}`;
      break;
    }
    case "approve":
    case "increaseAllowance": {
      const spender = evmLabel(abiAddress(data, 0));
      const amt = abiUint(data, 1) ?? 0n;
      const sym = asset?.symbol ?? `tokens of contract ${contract}`;
      const supply = asset?.info?.total_supply ? BigInt(asset.info.total_supply) : null;
      if (entry.name === "approve" && amt === 0n) {
        title = `Remove ${spender}'s permission to spend your ${sym}`;
      } else if (amt >= 2n ** 128n || amt >= INT64_MAX / 2n || (supply != null && supply > 0n && amt >= supply)) {
        title = `Allow ${spender} to spend unlimited ${sym}`;
        warnings.push({ level: "danger", code: "unlimited-approval", message: `${spender} could take all your ${sym} at any time, without asking again.` });
      } else {
        const shown = asset ? amountText(asset, amt) : `${amt} units`;
        title = `Allow ${spender} to spend up to ${shown}${asset ? "" : ` of ${sym}`}`;
        warnings.push({ level: "caution", code: "unlimited-approval", message: `${spender} can spend up to ${shown} without asking again.` });
      }
      break;
    }
    case "setApprovalForAll": {
      const op = evmLabel(abiAddress(data, 0));
      const on = (abiUint(data, 1) ?? 0n) !== 0n;
      const coll = asset?.info?.name ?? `contract ${contract}`;
      if (on) {
        title = `Allow ${op} to move all your ${coll} NFTs`;
        warnings.push({ level: "danger", code: "approval-for-all", message: `${op} could move every ${coll} NFT you own without asking again.` });
      } else title = `Remove ${op}'s access to your ${coll} NFTs`;
      break;
    }
    case "transferFrom":
    case "safeTransferFrom": {
      const from = evmLabel(abiAddress(data, 0));
      const to = evmLabel(abiAddress(data, 1));
      const v = abiUint(data, 2) ?? 0n;
      if (asset && asset.info?.type === "FUNGIBLE_COMMON") title = `Move ${amountText(asset, v)} from ${from} to ${to}`;
      else title = `Move ${asset?.info?.name ?? "NFT"} #${v} from ${from} to ${to}`;
      break;
    }
    case "associate":
      title = asset ? `Add the ${asset.symbol} token to your account` : `Add token ${contract} to your account`;
      break;
    case "dissociate":
      title = asset ? `Remove the ${asset.symbol} token from your account` : `Remove token ${contract} from your account`;
      break;
    default:
      if (payable > 0n) title += ` and send ${formatUnits(payable, 8)} HBAR`;
  }
  return { title, lines, balanceChanges, warnings, blind: false };
}

/* ------------------------------------------------------------------ account settings & staking */

function describeAccountUpdate(tx: AccountUpdateTransaction, dc: DescribeContext): Described {
  const target = tx.accountId;
  const lines: Line[] = [];
  if (target && !isMe(dc, target)) lines.push({ label: "Account", value: `${accountLabel(target)} (not this wallet's account)` });

  if (tx.key != null) {
    return blindResult("Hand your account to a different key", "This would give control of the account to another key. You could lose everything in it.", lines);
  }
  const hooks = (tx as unknown as { hooksToCreate?: unknown[] }).hooksToCreate ?? [];
  if (hooks.length) {
    return blindResult("Add custom code to your account", "This attaches code (a hook) that could move funds out of your account later.", lines);
  }

  let title: string | null = null;
  const nodeId = tx.stakedNodeId;
  const stakedAccount = tx.stakedAccountId?.toString();
  if (nodeId != null) {
    title = nodeId.toString() === "-1" ? "Stop staking HBAR" : `Stake HBAR with node ${nodeId.toString()}`;
  } else if (stakedAccount != null) {
    title = stakedAccount === "0.0.0" ? "Stop staking HBAR" : `Stake HBAR through account ${stakedAccount}`;
  }
  if (title?.startsWith("Stake")) {
    lines.push({ label: "Your HBAR", value: "Stays in your account and can be spent any time" });
  }
  if (tx.declineStakingRewards != null) {
    lines.push({ label: "Staking rewards", value: tx.declineStakingRewards ? "Off" : "On" });
    title ??= tx.declineStakingRewards ? "Turn staking rewards off" : "Turn staking rewards on";
  }
  const slots = tx.maxAutomaticTokenAssociations;
  if (slots != null) {
    const v = slots.toString() === "-1" ? "Unlimited" : slots.toString();
    lines.push({ label: "Free token slots", value: v });
    title ??= `Change free token slots to ${v.toLowerCase()}`;
  }
  if (tx.accountMemo != null) {
    lines.push({ label: "Account note", value: tx.accountMemo || "(cleared)" });
    title ??= "Change your account note";
  }
  if (tx.receiverSignatureRequired != null) {
    lines.push({ label: "Approve incoming transfers", value: tx.receiverSignatureRequired ? "Required" : "Not required" });
  }
  if (tx.autoRenewPeriod != null) lines.push({ label: "Renewal period", value: `${tx.autoRenewPeriod.seconds.toString()} seconds` });
  if (tx.expirationTime != null) lines.push({ label: "Expires", value: tx.expirationTime.toDate().toISOString() });
  return { title: title ?? "Update your account settings", lines, balanceChanges: [], warnings: [], blind: false };
}

/* ------------------------------------------------------------------ schedules */

async function describeScheduleCreate(tx: ScheduleCreateTransaction, dc: DescribeContext, depth: number): Promise<Described> {
  const inner = scheduledInner(tx);
  if (!inner) return blindResult("Schedule a transaction", "The scheduled transaction can't be read.");
  const d = await describeTransaction(inner, dc, depth + 1);
  // The SDK's `expirationTime` getter throws on frozen transactions, so read the field directly.
  const expires = (tx as unknown as { _expirationTime?: { toDate(): Date } | null })._expirationTime ?? null;
  const lines: Line[] = [
    { label: "When", value: expires ? `Once everyone needed approves, before ${expires.toDate().toISOString()}` : "Once everyone needed approves" },
    ...d.lines,
  ];
  if (tx.payerAccountId && !isMe(dc, tx.payerAccountId)) lines.push({ label: "Fee paid by", value: accountLabel(tx.payerAccountId) });
  return { ...d, title: `Schedule: ${lowerFirst(d.title)}`, lines };
}

async function describeScheduleSign(tx: ScheduleSignTransaction, dc: DescribeContext, depth: number): Promise<Described> {
  const id = tx.scheduleId?.toString();
  if (!id) return blindResult("Approve a scheduled transaction", "No schedule id.");
  const s = await dc.mirror.schedule(id).catch(() => null);
  if (!s) return blindResult("Approve a scheduled transaction", `Schedule ${id} couldn't be found, so Clip Wallet can't show what it does.`, [{ label: "Schedule", value: id }]);
  let inner: Transaction;
  try {
    inner = transactionFromSchedulableBody(s.transaction_body);
  } catch {
    return blindResult("Approve a scheduled transaction", `Schedule ${id} can't be read.`, [{ label: "Schedule", value: id }]);
  }
  const d = await describeTransaction(inner, dc, depth + 1);
  const lines: Line[] = [{ label: "Schedule", value: `${id}, created by ${s.creator_account_id}` }, ...d.lines];
  const warnings = [...d.warnings];
  if (s.executed_timestamp) warnings.push({ level: "info", code: "simulation-failed", message: "This scheduled transaction already ran. Approving does nothing but costs a fee." });
  if (s.deleted) warnings.push({ level: "info", code: "simulation-failed", message: "This scheduled transaction was cancelled. Approving does nothing but costs a fee." });
  return { ...d, title: `Approve scheduled: ${lowerFirst(d.title)}`, lines, warnings };
}

function lowerFirst(s: string): string {
  return s ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/* ------------------------------------------------------------------ entry */

export async function describeTransaction(tx: Transaction, dc: DescribeContext, depth = 0): Promise<Described> {
  if (depth > 2) return blindResult("Approve a nested transaction", "Too many nested schedules to read.");
  if (tx instanceof TransferTransaction) return describeTransfer(tx, dc);
  if (tx instanceof TokenAssociateTransaction) return describeAssociate(tx, dc, true);
  if (tx instanceof TokenDissociateTransaction) return describeAssociate(tx, dc, false);
  if (tx instanceof AccountAllowanceApproveTransaction) return describeAllowance(tx, dc);
  if (tx instanceof AccountAllowanceDeleteTransaction) {
    const ids = tx.tokenNftAllowanceDeletions.map((a) => a.tokenId.toString());
    return { title: "Remove permissions to move your NFTs", lines: ids.map((id) => ({ label: "Collection", value: id })), balanceChanges: [], warnings: [], blind: false };
  }
  if (tx instanceof ContractExecuteTransaction) return describeContract(tx, dc);
  if (tx instanceof AccountUpdateTransaction) return describeAccountUpdate(tx, dc);
  if (tx instanceof ScheduleCreateTransaction) return describeScheduleCreate(tx, dc, depth);
  if (tx instanceof ScheduleSignTransaction) return describeScheduleSign(tx, dc, depth);
  if (tx instanceof TopicMessageSubmitTransaction) {
    const msg = tx.message ? new TextDecoder().decode(tx.message) : "";
    const preview = msg.length > 280 ? `${msg.slice(0, 280)}…` : msg;
    return {
      title: `Post a message to topic ${tx.topicId?.toString() ?? "?"}`,
      lines: [{ label: "Message", value: preview || "(empty)" }],
      balanceChanges: [],
      warnings: [],
      blind: false,
    };
  }
  if (tx instanceof AccountDeleteTransaction) {
    return blindResult(
      `Close account ${accountLabel(tx.accountId)} and send what's left to ${accountLabel(tx.transferAccountId)}`,
      "This permanently closes the account.",
    );
  }
  const kind = bodyKind(tx);
  return blindResult("Approve an unrecognized request", "Clip Wallet can't read this kind of Hedera transaction yet.", [{ label: "Type", value: kind }]);
}
