import { type AssetRef, type BalanceChange, type Msg, type Warning, msg } from "@clip-wallet/core";
import { type CV, cvText, principalOf } from "./clarity.js";
import { stxAsset } from "./networks.js";
import { type PcPrincipal, type PostCondition, type StacksTx, AUTH_SPONSORED, PC_MODE, memoText } from "./tx.js";
import { formatUnits, short } from "./util.js";

/**
 * Plain-language description of a Stacks transaction for the approval screen. Post-conditions are the network's
 * own guarantee of what may leave an account, so they are shown and turned into balance changes; "allow" mode
 * (anything may move) is a danger warning.
 */

export interface DescribeContext {
  networkId: string;
  /** This account's address on the request's network (SP… or ST…). */
  me: string;
  host: string;
  /** Token AssetRef for "SP….contract::asset" (curated, from metadata, or a bare fallback). */
  token(assetId: string): Promise<AssetRef>;
  /** Token AssetRef for a contract when only the contract is known (SIP-010 `transfer` without a post-condition). */
  tokenByContract(contract: string): Promise<AssetRef | null>;
}

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
  fee: bigint;
  sponsored: boolean;
}

const STX_DECIMALS = 6;
export const fmtStx = (v: bigint) => `${formatUnits(v, STX_DECIMALS)} STX`;
export const fmtAsset = (v: bigint, a: AssetRef) => `${formatUnits(v, a.decimals)} ${a.symbol}`;

const label = (m: Msg, value: string, valueMsg?: Msg): Line => ({ label: m.fallback, labelMsg: m, value, ...(valueMsg ? { valueMsg } : {}) });
const valueLine = (labelText: string, m: Msg): Line => ({ label: labelText, value: m.fallback, valueMsg: m });

function isMe(p: PcPrincipal, me: string): boolean {
  return p.kind === "origin" || (p.kind === "standard" && p.address === me);
}

function whoOf(p: PcPrincipal): string {
  return p.kind === "standard" ? short(p.address) : p.kind === "contract" ? p.contract.split(".")[1] ?? p.contract : "you";
}

const FT_YOU: Record<number, Parameters<typeof msg>[0]> = {
  0x01: "bg.stacks.pcYouSendExactly",
  0x02: "bg.stacks.pcYouSendMoreThan",
  0x03: "bg.stacks.pcYouSendAtLeast",
  0x04: "bg.stacks.pcYouSendLessThan",
  0x05: "bg.stacks.pcYouSendAtMost",
};
const FT_OTHER: Record<number, Parameters<typeof msg>[0]> = {
  0x01: "bg.stacks.pcSendsExactly",
  0x02: "bg.stacks.pcSendsMoreThan",
  0x03: "bg.stacks.pcSendsAtLeast",
  0x04: "bg.stacks.pcSendsLessThan",
  0x05: "bg.stacks.pcSendsAtMost",
};
const NFT_YOU: Record<number, Parameters<typeof msg>[0]> = { 0x10: "bg.stacks.pcYouSendNft", 0x11: "bg.stacks.pcYouKeepNft", 0x12: "bg.stacks.pcYouMaySendNft" };
const NFT_OTHER: Record<number, Parameters<typeof msg>[0]> = { 0x10: "bg.stacks.pcSendsNft", 0x11: "bg.stacks.pcKeepsNft", 0x12: "bg.stacks.pcMaySendNft" };

/** One post-condition as a line, plus the balance change it guarantees for this account (exact or upper bound). */
async function describePc(pc: PostCondition, ctx: DescribeContext): Promise<{ line: Line; change?: BalanceChange }> {
  const pcLabel = msg("bg.stacks.postCondition");
  const mine = isMe(pc.principal, ctx.me);
  if (pc.type === "stx" || pc.type === "ft") {
    const asset = pc.type === "stx" ? stxAsset(ctx.networkId) : await ctx.token(`${pc.asset.contract}::${pc.asset.assetName}`);
    const amount = fmtAsset(pc.amount, asset);
    const m = mine ? msg(FT_YOU[pc.code]!, { amount }) : msg(FT_OTHER[pc.code]!, { who: whoOf(pc.principal), amount });
    // Exact (eq) or "at most" (lte / lt) limits on what leaves this account are what it can lose.
    const bound = pc.code === 0x01 || pc.code === 0x05 ? pc.amount : pc.code === 0x04 && pc.amount > 0n ? pc.amount - 1n : null;
    const change = mine && bound !== null && bound > 0n ? { asset, delta: (-bound).toString() } : undefined;
    return { line: { ...label(pcLabel, m.fallback, m) }, ...(change ? { change } : {}) };
  }
  if (pc.type === "nft") {
    const item = `${pc.asset.assetName} ${cvText(pc.assetId, 40)}`;
    const m = mine ? msg(NFT_YOU[pc.code]!, { item }) : msg(NFT_OTHER[pc.code]!, { item, who: whoOf(pc.principal) });
    return { line: label(pcLabel, m.fallback, m) };
  }
  const m = msg("bg.stacks.pcStakingRule", { who: mine ? ctx.me : whoOf(pc.principal) });
  return { line: label(pcLabel, m.fallback, m) };
}

function mergeChanges(changes: BalanceChange[]): BalanceChange[] {
  const by = new Map<string, BalanceChange>();
  for (const c of changes) {
    const k = c.asset.address ?? c.asset.key;
    const prev = by.get(k);
    by.set(k, prev ? { asset: prev.asset, delta: (BigInt(prev.delta) + BigInt(c.delta)).toString() } : c);
  }
  return [...by.values()].filter((c) => c.delta !== "0");
}

/** SIP-010 `transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))`. */
export function sip10Transfer(tx: StacksTx): { amount: bigint; sender: string; recipient: string; memo?: CV } | null {
  const p = tx.payload;
  if (p.type !== "contract-call" || p.functionName !== "transfer" || (p.args.length !== 3 && p.args.length !== 4)) return null;
  const [amount, sender, recipient, memo] = p.args;
  if (amount?.type !== "uint") return null;
  const s = principalOf(sender);
  const r = principalOf(recipient);
  if (!s || !r) return null;
  if (memo && memo.type !== "none" && memo.type !== "some") return null;
  return { amount: amount.value, sender: s, recipient: r, ...(memo ? { memo } : {}) };
}

export async function describeTx(tx: StacksTx, ctx: DescribeContext): Promise<Described> {
  const lines: Line[] = [];
  const warnings: Warning[] = [];
  const changes: BalanceChange[] = [];
  const sponsored = tx.auth.type === AUTH_SPONSORED;
  const fee = sponsored ? 0n : tx.auth.origin.fee;
  const stx = stxAsset(ctx.networkId);
  let title: Msg;
  let blind = false;
  const p = tx.payload;

  const pcs = await Promise.all(tx.postConditions.map((pc) => describePc(pc, ctx)));

  if (p.type === "token-transfer") {
    const to = principalOf(p.recipient)!;
    const amount = fmtStx(p.amount);
    title = msg("bg.req.sendTo", { amount, to: short(to) });
    lines.push({ label: "To", value: to }, { label: "Amount", value: amount });
    const memo = memoText(p.memo);
    if (memo) lines.push({ label: "Memo", value: memo });
    if (to !== ctx.me) changes.push({ asset: stx, delta: (-p.amount).toString() });
  } else if (p.type === "smart-contract") {
    title = msg("bg.stacks.deployNamed", { name: p.name });
    lines.push({ label: "Contract", value: `${ctx.me}.${p.name}` });
    if (p.clarityVersion !== undefined) lines.push({ label: "Type", value: `Clarity ${p.clarityVersion}` });
    lines.push({ label: "Code", value: p.code.length > 400 ? `${p.code.slice(0, 399)}…` : p.code });
    warnings.push({ level: "caution", code: "unknown-call", message: "This creates a new smart contract. Clip Wallet can't check what its code does." });
  } else {
    const contractName = p.contract.split(".")[1] ?? p.contract;
    const t = sip10Transfer(tx);
    if (t && t.sender === ctx.me) {
      const pcAsset = tx.postConditions.find((pc) => pc.type === "ft" && pc.asset.contract === p.contract);
      const asset = pcAsset && pcAsset.type === "ft" ? await ctx.token(`${pcAsset.asset.contract}::${pcAsset.asset.assetName}`) : await ctx.tokenByContract(p.contract);
      if (asset) {
        const amount = fmtAsset(t.amount, asset);
        title = msg("bg.req.sendTo", { amount, to: short(t.recipient) });
        lines.push({ label: "To", value: t.recipient }, { label: "Amount", value: amount }, { label: "Contract", value: p.contract });
        if (t.memo?.type === "some") lines.push({ label: "Memo", value: cvText(t.memo.value) });
        if (t.recipient !== ctx.me && !tx.postConditions.some((pc) => pc.type === "ft" && isMe(pc.principal, ctx.me))) {
          changes.push({ asset, delta: (-t.amount).toString() });
        }
      } else {
        title = msg("bg.req.useFnOnContract", { fn: p.functionName, contract: contractName });
      }
    } else {
      title = msg("bg.req.useFnOnContract", { fn: p.functionName, contract: contractName });
    }
    if (!lines.length) {
      lines.push({ label: "Contract", value: p.contract }, { label: "Function", value: p.functionName });
      p.args.forEach((a, i) => lines.push(label(msg("bg.label.argumentN", { n: i + 1 }), cvText(a))));
      if (!t || t.sender !== ctx.me) {
        warnings.push({ level: "caution", code: "unknown-call", message: "Clip Wallet can name this call but can't fully read it, so some of its effects may not be shown." });
      }
    }
  }

  for (const d of pcs) {
    lines.push(d.line);
    if (d.change) changes.push(d.change);
  }

  if (p.type !== "token-transfer") {
    if (tx.postConditionMode === PC_MODE.allow) {
      warnings.unshift({ level: "danger", code: "unlimited-approval", ...msgWarn(msg("bg.stacks.allowMode", { host: ctx.host })) });
    } else if (tx.postConditionMode === PC_MODE.originator) {
      warnings.push({ level: "info", code: "unlimited-approval", ...msgWarn(msg("bg.stacks.originatorMode")) });
    } else if (!tx.postConditions.some((pc) => isMe(pc.principal, ctx.me))) {
      lines.push(valueLine("What happens", msg("bg.stacks.nothingLeaves")));
    }
  }

  if (sponsored) {
    warnings.push({ level: "info", code: "network-matters", message: "Another account pays the network fee for this transaction." });
    lines.push(valueLine("Fee paid by", msg("bg.stacks.sponsorPays", { host: ctx.host })));
  } else {
    lines.push({ label: "Network fee", value: fmtStx(fee) });
    if (fee > 10_000_000n) warnings.push({ level: "caution", code: "high-fee", ...msgWarn(msg("bg.stacks.highFee", { fee: fmtStx(fee) })) });
  }
  lines.push({ label: "Nonce", value: tx.auth.origin.nonce.toString() });

  return { title: title.fallback, titleMsg: title, lines, balanceChanges: mergeChanges(changes), warnings, blind, fee, sponsored };
}

function msgWarn(m: Msg): { message: string; msg: Msg } {
  return { message: m.fallback, msg: m };
}
