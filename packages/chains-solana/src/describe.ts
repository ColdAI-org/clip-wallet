import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import type { Instruction } from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, ComputeBudgetInstruction, identifyComputeBudgetInstruction } from "@solana-program/compute-budget";
import { SYSTEM_PROGRAM_ADDRESS, SystemInstruction, identifySystemInstruction } from "@solana-program/system";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  AssociatedTokenInstruction,
  TokenInstruction,
  identifyAssociatedTokenInstruction,
  identifyTokenInstruction,
} from "@solana-program/token";
import { solAsset } from "./networks.js";
import { RpcError, type SolanaRpc } from "./rpc.js";
import { type MintInfo, type TokenAccountInfo, TOKEN_PROGRAMS, assetFor, mintInfos, tokenAccounts } from "./tokens.js";
import type { ParsedTransaction } from "./tx.js";
import { abs, b64encode, formatUnits, joinWords, short } from "./util.js";

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
  simulated: boolean;
  /** Lamports. */
  fee: bigint;
}

export interface DescribeContext {
  networkId: NetworkId;
  me: string;
  rpc: SolanaRpc | null;
  cacheKey: string;
  /** Skip the RPC simulation (tests, or offline). */
  simulate: boolean;
}

export const MEMO_PROGRAMS = ["MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"];
const U64_MAX = 18446744073709551615n;
/** Rent for a 165-byte token account, the usual cost of opening one. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2039280n;
const LAMPORTS_PER_SIGNATURE = 5000n;

const u64 = (d: ReadonlyUint8ArrayLike, at: number) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[at + i] ?? 0);
  return v;
};
const u32 = (d: ReadonlyUint8ArrayLike, at: number) => (d[at] ?? 0) | ((d[at + 1] ?? 0) << 8) | ((d[at + 2] ?? 0) << 16) | (((d[at + 3] ?? 0) << 24) >>> 0);
type ReadonlyUint8ArrayLike = { readonly [i: number]: number; readonly length: number };

function acct(ix: Instruction, i: number): string {
  return String(ix.accounts?.[i]?.address ?? "");
}

function dataOf(ix: Instruction): ReadonlyUint8ArrayLike {
  return (ix.data ?? new Uint8Array()) as ReadonlyUint8ArrayLike;
}

interface Movement {
  asset: AssetRef;
  amount: bigint; // + to me, - from me
  counterparty: string;
}

function sol(networkId: NetworkId): AssetRef {
  return solAsset(networkId);
}

function amountText(asset: AssetRef, v: bigint): string {
  return `${formatUnits(abs(v), asset.decimals)} ${asset.symbol}`;
}

export async function describeTransaction(p: ParsedTransaction, dc: DescribeContext): Promise<Described> {
  const warnings: Warning[] = [];
  const lines: Line[] = [];
  const baseFee = LAMPORTS_PER_SIGNATURE * BigInt(p.numSignatures);

  if (p.durableNonce) {
    warnings.push({
      level: "danger",
      code: "durable-nonce",
      message: "This transaction never expires. Whoever holds it can send it at any time, even weeks from now.",
    });
  }

  if (!p.instructions) {
    const sim = await simulate(p, dc);
    warnings.push({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction." });
    if (sim?.warning) warnings.push(sim.warning);
    return {
      title: "Approve an app transaction",
      lines: [{ label: "Details", value: "Unreadable (lookup tables couldn't be loaded)" }],
      balanceChanges: sim?.changes ?? [],
      warnings,
      blind: true,
      simulated: !!sim?.ok,
      fee: sim?.fee ?? baseFee,
    };
  }
  const ixs = p.instructions;

  // Prefetch token accounts and mints referenced by token / ATA instructions.
  const tokenAddrs = new Set<string>();
  for (const ix of ixs) {
    const prog = String(ix.programAddress);
    if (TOKEN_PROGRAMS.includes(prog) || prog === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) for (const a of ix.accounts ?? []) tokenAddrs.add(String(a.address));
  }
  let accounts = new Map<string, TokenAccountInfo>();
  let mints = new Map<string, MintInfo>();
  if (dc.rpc && tokenAddrs.size) {
    accounts = await tokenAccounts(dc.rpc, [...tokenAddrs]).catch(() => new Map());
    const candidateMints = new Set<string>([...accounts.values()].map((a) => a.mint));
    for (const a of tokenAddrs) if (!accounts.has(a)) candidateMints.add(a);
    mints = await mintInfos(dc.rpc, [...candidateMints], dc.networkId, dc.cacheKey).catch(() => new Map());
  }
  /** ATA → wallet that owns it, for ATAs created inside this transaction. */
  const ataOwner = new Map<string, { owner: string; mint: string }>();

  const moves: Movement[] = [];
  const undescribed: string[] = [];
  let cuLimit: number | null = null;
  let cuPrice = 0n;
  let nonCbIxs = 0;
  let opened = 0n;

  const ownerOfTokenAccount = (a: string) => accounts.get(a)?.owner ?? ataOwner.get(a)?.owner ?? null;
  const mintOfTokenAccount = (a: string) => accounts.get(a)?.mint ?? ataOwner.get(a)?.mint ?? null;
  const tokenAsset = (mint: string | null) => (mint ? assetFor(dc.networkId, mint, mints.get(mint)) : null);

  for (const ix of ixs) {
    const prog = String(ix.programAddress);
    const data = dataOf(ix);
    if (prog === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      try {
        const kind = identifyComputeBudgetInstruction(ix.data ?? new Uint8Array());
        if (kind === ComputeBudgetInstruction.SetComputeUnitLimit) cuLimit = u32(data, 1);
        else if (kind === ComputeBudgetInstruction.SetComputeUnitPrice) cuPrice = u64(data, 1);
      } catch {
        undescribed.push(prog);
      }
      continue;
    }
    nonCbIxs++;

    if (prog === SYSTEM_PROGRAM_ADDRESS) {
      let kind: SystemInstruction | null = null;
      try {
        kind = identifySystemInstruction(ix.data ?? new Uint8Array());
      } catch {
        kind = null;
      }
      if (kind === SystemInstruction.TransferSol) {
        const from = acct(ix, 0);
        const to = acct(ix, 1);
        const lamports = u64(data, 4);
        if (from === dc.me && to !== dc.me) moves.push({ asset: sol(dc.networkId), amount: -lamports, counterparty: to });
        else if (to === dc.me && from !== dc.me) moves.push({ asset: sol(dc.networkId), amount: lamports, counterparty: from });
        else if (from !== dc.me) lines.push({ label: "Transfer", value: `${amountText(sol(dc.networkId), lamports)}: ${short(from)} → ${short(to)}` });
      } else if (kind === SystemInstruction.AdvanceNonceAccount) {
        // covered by the durable-nonce warning
      } else if (kind === SystemInstruction.CreateAccount) {
        const payer = acct(ix, 0);
        const lamports = u64(data, 4);
        lines.push({ label: "Opens an account", value: `${short(acct(ix, 1))} (${formatUnits(lamports, 9)} SOL deposit)` });
        if (payer === dc.me) opened += lamports;
      } else {
        const touchesMe = (ix.accounts ?? []).some((a) => String(a.address) === dc.me);
        undescribed.push(touchesMe ? `${prog} (changes your account: ${kind != null ? SystemInstruction[kind] : "unknown"})` : prog);
      }
      continue;
    }

    if (TOKEN_PROGRAMS.includes(prog)) {
      let kind: TokenInstruction | null = null;
      try {
        kind = identifyTokenInstruction(ix.data ?? new Uint8Array());
      } catch {
        kind = null;
      }
      switch (kind) {
        case TokenInstruction.Transfer:
        case TokenInstruction.TransferChecked: {
          const checked = kind === TokenInstruction.TransferChecked;
          const src = acct(ix, 0);
          const dst = acct(ix, checked ? 2 : 1);
          const authority = acct(ix, checked ? 3 : 2);
          const mint = checked ? acct(ix, 1) : mintOfTokenAccount(src);
          const amount = u64(data, 1);
          let asset = tokenAsset(mint);
          if (asset && checked && !mints.has(mint!)) asset = { ...asset, decimals: data[9] ?? 0 };
          if (!asset) {
            undescribed.push(prog);
            break;
          }
          const srcOwner = ownerOfTokenAccount(src) ?? authority;
          const dstOwner = ownerOfTokenAccount(dst) ?? dst;
          if (srcOwner === dc.me && dstOwner !== dc.me) moves.push({ asset, amount: -amount, counterparty: dstOwner });
          else if (dstOwner === dc.me && srcOwner !== dc.me) moves.push({ asset, amount, counterparty: srcOwner });
          else if (authority === dc.me && srcOwner !== dc.me) {
            lines.push({ label: "Uses a spending permission", value: `${amountText(asset, amount)} from ${short(srcOwner)} to ${short(dstOwner)}` });
          } else if (srcOwner !== dc.me) lines.push({ label: "Transfer", value: `${amountText(asset, amount)}: ${short(srcOwner)} → ${short(dstOwner)}` });
          break;
        }
        case TokenInstruction.Approve:
        case TokenInstruction.ApproveChecked: {
          const checked = kind === TokenInstruction.ApproveChecked;
          const src = acct(ix, 0);
          const delegate = acct(ix, checked ? 2 : 1);
          const mint = checked ? acct(ix, 1) : mintOfTokenAccount(src);
          const amount = u64(data, 1);
          const asset = tokenAsset(mint);
          const sym = asset?.symbol ?? "tokens";
          const supply = mint ? BigInt(mints.get(mint)?.supply ?? "0") : 0n;
          if (amount === U64_MAX || (supply > 0n && amount >= supply)) {
            lines.push({ label: "Permission", value: `${short(delegate)} can spend unlimited ${sym}` });
            warnings.push({ level: "danger", code: "unlimited-approval", message: `${short(delegate)} could take all your ${sym} at any time, without asking again.` });
          } else {
            const shown = asset ? amountText(asset, amount) : `${amount} units`;
            lines.push({ label: "Permission", value: `${short(delegate)} can spend up to ${shown}` });
            warnings.push({ level: "caution", code: "unlimited-approval", message: `${short(delegate)} can spend up to ${shown} from your account without asking again.` });
          }
          break;
        }
        case TokenInstruction.Revoke:
          lines.push({ label: "Permission", value: `Removes spending permission on ${tokenAsset(mintOfTokenAccount(acct(ix, 0)))?.symbol ?? "a token account"}` });
          break;
        case TokenInstruction.CloseAccount: {
          const sym = tokenAsset(mintOfTokenAccount(acct(ix, 0)))?.symbol ?? "token";
          const dest = acct(ix, 1);
          lines.push({ label: "Closes", value: `Your ${sym} account (its ≈0.002 SOL deposit goes to ${dest === dc.me ? "you" : short(dest)})` });
          break;
        }
        case TokenInstruction.Burn:
        case TokenInstruction.BurnChecked: {
          const asset = tokenAsset(kind === TokenInstruction.BurnChecked ? acct(ix, 1) : mintOfTokenAccount(acct(ix, 0)));
          const amount = u64(data, 1);
          if (asset && ownerOfTokenAccount(acct(ix, 0)) === dc.me) moves.push({ asset, amount: -amount, counterparty: "burn" });
          lines.push({ label: "Destroys", value: asset ? amountText(asset, amount) : `${amount} token units` });
          break;
        }
        case TokenInstruction.SyncNative:
          lines.push({ label: "Wraps", value: "SOL into wrapped SOL" });
          break;
        case TokenInstruction.InitializeAccount:
        case TokenInstruction.InitializeAccount2:
        case TokenInstruction.InitializeAccount3:
          lines.push({ label: "Sets up", value: "A token account" });
          break;
        case TokenInstruction.SetAuthority:
          undescribed.push(`${prog} (hands control of a token account or mint to someone else)`);
          break;
        default:
          undescribed.push(prog);
      }
      continue;
    }

    if (prog === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      let kind: AssociatedTokenInstruction | null = null;
      try {
        kind = ix.data && ix.data.length ? identifyAssociatedTokenInstruction(ix.data) : AssociatedTokenInstruction.CreateAssociatedToken;
      } catch {
        kind = null;
      }
      if (kind === AssociatedTokenInstruction.CreateAssociatedToken || kind === AssociatedTokenInstruction.CreateAssociatedTokenIdempotent) {
        const payer = acct(ix, 0);
        const ata = acct(ix, 1);
        const owner = acct(ix, 2);
        const mint = acct(ix, 3);
        ataOwner.set(ata, { owner, mint });
        const sym = tokenAsset(mint)?.symbol ?? "token";
        const exists = accounts.has(ata);
        if (!exists) {
          if (owner === dc.me) lines.push({ label: "Also", value: `Opens a ${sym} account for you (≈0.002 SOL)` });
          else lines.push({ label: "Also", value: `Also opens a ${sym} account for the recipient (≈0.002 SOL)` });
          if (payer === dc.me) opened += TOKEN_ACCOUNT_RENT_LAMPORTS;
        }
      } else undescribed.push(prog);
      continue;
    }

    if (MEMO_PROGRAMS.includes(prog)) {
      lines.push({ label: "Memo", value: new TextDecoder().decode(ix.data ?? new Uint8Array()).slice(0, 280) });
      continue;
    }
    undescribed.push(prog);
  }

  // Fee: 5000 lamports per signature + compute-unit price × limit.
  const limit = BigInt(cuLimit ?? Math.min(1_400_000, 200_000 * Math.max(1, nonCbIxs)));
  const priority = (cuPrice * limit + 999_999n) / 1_000_000n;
  let fee = baseFee + priority;

  // Static balance changes for me.
  const byAsset = new Map<string, { asset: AssetRef; delta: bigint }>();
  for (const m of moves) {
    const k = m.asset.address ?? m.asset.key;
    const e = byAsset.get(k) ?? { asset: m.asset, delta: 0n };
    e.delta += m.amount;
    byAsset.set(k, e);
  }
  if (opened) {
    const e = byAsset.get("sol") ?? { asset: sol(dc.networkId), delta: 0n };
    e.delta -= opened;
    byAsset.set("sol", e);
  }
  let balanceChanges: BalanceChange[] = [...byAsset.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));

  const sim = await simulate(p, dc);
  if (sim) {
    if (sim.ok) {
      balanceChanges = sim.changes;
      if (sim.fee != null) fee = sim.fee;
    }
    if (sim.warning) warnings.push(sim.warning);
  }

  // Title
  const outs = moves.filter((m) => m.amount < 0n && m.counterparty !== "burn");
  const ins = moves.filter((m) => m.amount > 0n);
  const names = (list: Movement[]) => joinWords(mergeText(list));
  const parties = (list: Movement[]) => [...new Set(list.map((m) => m.counterparty))];
  for (const m of outs) lines.unshift({ label: "To", value: `${m.counterparty} gets ${amountText(m.asset, m.amount)}` });
  for (const m of ins) lines.unshift({ label: "From", value: `${m.counterparty} sends ${amountText(m.asset, m.amount)}` });

  let title: string;
  const blind = undescribed.length > 0;
  const approvals = lines.filter((l) => l.label === "Permission");
  if (blind) {
    title = "Approve an app transaction";
    for (const u of [...new Set(undescribed)]) lines.push({ label: "Program", value: u });
    warnings.push({ level: "danger", code: "blind-signing", message: "Part of this transaction uses programs Clip Wallet can't read. Check the balance changes." });
  } else if (outs.length && !ins.length) {
    const ps = parties(outs);
    title = `Send ${names(outs)} to ${ps.length === 1 ? short(ps[0]!) : `${ps.length} addresses`}`;
  } else if (ins.length && !outs.length) {
    const ps = parties(ins);
    title = `Receive ${names(ins)} from ${ps.length === 1 ? short(ps[0]!) : `${ps.length} addresses`}`;
  } else if (ins.length && outs.length) {
    title = `Trade ${names(outs)} for ${names(ins)}`;
  } else if (approvals.length === 1) {
    title = `Allow ${approvals[0]!.value.replace(" can ", " to ")}`;
  } else if (lines.some((l) => l.label === "Also")) {
    title = lines.find((l) => l.label === "Also")!.value.replace(/^Also opens/, "Open").replace(/^Opens/, "Open");
  } else {
    title = "Approve a transaction";
  }

  return { title, lines, balanceChanges, warnings, blind, simulated: !!sim?.ok, fee };
}

function mergeText(list: Movement[]): string[] {
  const m = new Map<string, { asset: AssetRef; v: bigint }>();
  for (const x of list) {
    const k = x.asset.address ?? x.asset.key;
    const e = m.get(k) ?? { asset: x.asset, v: 0n };
    e.v += x.amount;
    m.set(k, e);
  }
  return [...m.values()].map((e) => amountText(e.asset, e.v));
}

/* ------------------------------------------------------------------ simulation */

interface SimResult {
  ok: boolean;
  changes: BalanceChange[];
  fee: bigint | null;
  warning?: Warning;
}

interface SimValue {
  err: unknown;
  logs?: string[] | null;
  fee?: number | null;
  preBalances?: number[] | null;
  postBalances?: number[] | null;
  preTokenBalances?: TokenBal[] | null;
  postTokenBalances?: TokenBal[] | null;
  loadedAddresses?: { writable: string[]; readonly: string[] } | null;
  accounts?: ({ lamports: number } | null)[] | null;
}
interface TokenBal {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

const PLAIN_ERRORS: [RegExp, string][] = [
  [/InsufficientFundsForFee|insufficient funds for fee/i, "You don't have enough SOL to pay the network fee."],
  [/InsufficientFundsForRent/i, "You'd be left with too little SOL to keep the account open."],
  [/insufficient (funds|lamports)|custom program error: 0x1\b|"Custom":1\b/i, "You don't have enough funds for this."],
  [/BlockhashNotFound/i, "This request has expired. Ask the app to try again."],
  [/AccountNotFound/i, "Your account has no SOL yet, so it can't pay the fee."],
];

export function plainSolanaError(raw: string): string {
  for (const [re, msg] of PLAIN_ERRORS) if (re.test(raw)) return msg;
  return "This transaction fails in a test run, so it would probably fail for real.";
}

/** simulateTransaction (sigVerify off, fresh blockhash unless durable-nonce) → my SOL and token changes. */
export async function simulate(p: ParsedTransaction, dc: DescribeContext): Promise<SimResult | null> {
  if (!dc.simulate || !dc.rpc) return null;
  let value: SimValue;
  try {
    const r = await dc.rpc.call<{ value: SimValue }>("simulateTransaction", [
      b64encode(p.wire),
      {
        encoding: "base64",
        sigVerify: false,
        replaceRecentBlockhash: !p.durableNonce,
        commitment: "confirmed",
        accounts: { encoding: "base64", addresses: [dc.me] },
      },
    ]);
    value = r.value;
  } catch (e) {
    const msg = e instanceof RpcError ? e.message : "";
    return { ok: false, changes: [], fee: null, warning: { level: "caution", code: "simulation-failed", message: msg ? plainSolanaError(msg) : "Couldn't test-run this transaction." } };
  }
  if (value.err) {
    const raw = JSON.stringify(value.err) + (value.logs ?? []).join("\n");
    return { ok: false, changes: [], fee: null, warning: { level: "caution", code: "simulation-failed", message: plainSolanaError(raw) } };
  }
  const fee = value.fee != null ? BigInt(value.fee) : null;
  const changes: BalanceChange[] = [];
  const keys = [
    ...p.compiled.staticAccounts.map(String),
    ...(value.loadedAddresses?.writable ?? []),
    ...(value.loadedAddresses?.readonly ?? []),
  ];
  const meIdx = keys.indexOf(dc.me);
  let solDelta: bigint | null = null;
  if (value.preBalances && value.postBalances && meIdx >= 0) {
    solDelta = BigInt(value.postBalances[meIdx] ?? 0) - BigInt(value.preBalances[meIdx] ?? 0);
  } else if (value.accounts?.[0] && dc.rpc) {
    const pre = await dc.rpc.call<{ value: number }>("getBalance", [dc.me, { commitment: "confirmed" }]).catch(() => null);
    if (pre) solDelta = BigInt(value.accounts[0].lamports) - BigInt(pre.value);
  }
  if (solDelta != null) {
    if (p.feePayer === dc.me) solDelta += fee ?? 0n; // the fee is shown separately
    if (solDelta !== 0n) changes.push({ asset: solAsset(dc.networkId), delta: solDelta.toString() });
  }
  const perMint = new Map<string, bigint>();
  for (const t of value.preTokenBalances ?? []) if (t.owner === dc.me) perMint.set(t.mint, (perMint.get(t.mint) ?? 0n) - BigInt(t.uiTokenAmount.amount));
  for (const t of value.postTokenBalances ?? []) if (t.owner === dc.me) perMint.set(t.mint, (perMint.get(t.mint) ?? 0n) + BigInt(t.uiTokenAmount.amount));
  const mintList = [...perMint.entries()].filter(([, d]) => d !== 0n);
  if (mintList.length) {
    const infos = await mintInfos(dc.rpc, mintList.map(([m]) => m), dc.networkId, dc.cacheKey).catch(() => new Map<string, MintInfo>());
    const decimalsOf = new Map<string, number>();
    for (const t of [...(value.preTokenBalances ?? []), ...(value.postTokenBalances ?? [])]) decimalsOf.set(t.mint, t.uiTokenAmount.decimals);
    for (const [mint, d] of mintList) {
      const asset = assetFor(dc.networkId, mint, infos.get(mint));
      if (!infos.get(mint)) asset.decimals = decimalsOf.get(mint) ?? 0;
      changes.push({ asset, delta: d.toString() });
    }
  }
  return { ok: true, changes, fee };
}
