import type { AssetRef, BalanceChange, NetworkId, Warning } from "@clip-wallet/core";
import { OnApplicationComplete, encodeAddress, encodeUnsignedSimulateTransaction, msgpackRawDecode, msgpackRawEncode } from "algosdk";
import { type Algod, AlgodError, plainAlgorandError } from "./algod.js";
import { type AsaInfo, asaAsset, asaInfo } from "./assets.js";
import { algoAsset } from "./networks.js";
import type { Item, Normalized } from "./txn.js";
import { abs, big, formatUnits, hex, short, textOf } from "./util.js";
import { say } from "@clip-wallet/core";

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
  /** microALGO paid by this account. */
  fee: bigint;
}

export interface DescribeContext {
  networkId: NetworkId;
  me: string;
  algod: Algod | null;
  /** Latest round, for the "signed for the future" check. */
  lastRound: bigint | null;
  /** This account's ALGO balance (microALGO), when known. */
  balance: bigint | null;
  simulate: boolean;
}

/** Well-known ARC-4 selectors, each checked with algosdk ABIMethod.fromSignature(sig).getSelector(). */
export const KNOWN_SELECTORS: Record<string, string> = {
  da7025b9: "arc200_transfer(address,uint256)bool",
  "4a968f8f": "arc200_transferFrom(address,address,uint256)bool",
  b5422125: "arc200_approve(address,uint256)bool",
};

const UINT256_MAX = (1n << 256n) - 1n;
/** ARC-1: warn when a transaction only becomes valid this many rounds after now. */
export const FUTURE_ROUNDS = 500n;
/** Network fee above which a caution is shown (0.1 ALGO). */
export const HIGH_FEE = 100_000n;
/** Asset / app opt-in min-balance increase: 0.1 ALGO (protocol parameters). */
export const OPT_IN_LOCK = 100_000n;

export const OPT_IN_LINE = "Algorand accounts must add a token before they can receive it. This locks 0.1 ALGO while it's added.";

interface Move {
  asset: AssetRef;
  delta: bigint;
}

interface One {
  title: string;
  lines: Line[];
  warnings: Warning[];
  blind: boolean;
  moves: Move[];
  fee: bigint;
  /** Needs a test run to know what it does (app calls). */
  opaque: boolean;
  /** ALGO leaving with a close-to, estimated from the current balance. */
  closeEstimate?: Move;
}

const addr = (a: { toString(): string } | undefined) => (a ? a.toString() : "");
const amountText = (asset: AssetRef, v: bigint) => `${formatUnits(abs(v), asset.decimals)} ${asset.symbol}`;

function u256(b: Uint8Array | undefined): bigint {
  let v = 0n;
  for (const x of b ?? []) v = (v << 8n) | BigInt(x);
  return v;
}

function who(a: string, me: string): string {
  return a === me ? "you" : short(a);
}

/** Collects asset ids referenced by the transactions so they can be fetched once. */
function assetIdsOf(items: Item[]): bigint[] {
  const ids = new Set<bigint>();
  for (const { txn } of items) {
    if (txn.assetTransfer) ids.add(txn.assetTransfer.assetIndex);
    if (txn.assetConfig && txn.assetConfig.assetIndex) ids.add(txn.assetConfig.assetIndex);
    if (txn.assetFreeze) ids.add(txn.assetFreeze.assetIndex);
  }
  return [...ids];
}

export async function loadAssets(algod: Algod | null, ids: Iterable<bigint | string>): Promise<Map<string, AsaInfo | null>> {
  const out = new Map<string, AsaInfo | null>();
  if (!algod) return out;
  for (const id of ids) out.set(String(id), await asaInfo(algod, id).catch(() => null));
  return out;
}

function describeOne(item: Item, dc: DescribeContext, assets: Map<string, AsaInfo | null>): One {
  const { txn } = item;
  const me = dc.me;
  const sender = item.sender;
  const algo = algoAsset(dc.networkId);
  const lines: Line[] = [];
  const warnings: Warning[] = [];
  const moves: Move[] = [];
  let blind = false;
  let opaque = false;
  let closeEstimate: Move | undefined;
  let title: string;
  const asset = (id: bigint) => asaAsset(dc.networkId, id, assets.get(String(id)));
  const move = (a: AssetRef, from: string, to: string, amount: bigint) => {
    if (amount === 0n || from === to) return;
    if (from === me) moves.push({ asset: a, delta: -amount });
    if (to === me) moves.push({ asset: a, delta: amount });
  };
  const signed = item.sign;
  const danger = (code: Warning["code"], message: string) => {
    if (signed) warnings.push({ level: "danger", code, message });
    else lines.push({ label: "Note", value: message });
  };

  switch (txn.type) {
    case "pay": {
      const p = txn.payment!;
      const to = addr(p.receiver);
      title = sender === me || to !== me ? `Send ${amountText(algo, p.amount)} to ${who(to, me)}` : say("bg.req.receiveFrom", { amount: amountText(algo, p.amount), from: short(sender) });
      if (sender !== me && to !== me) title = say("bg.req.othersSend", { from: short(sender), amount: amountText(algo, p.amount), to: short(to) });
      move(algo, sender, to, p.amount);
      if (p.closeRemainderTo) {
        const close = addr(p.closeRemainderTo);
        title = `Close ${sender === me ? "your account" : short(sender)} and send everything to ${who(close, me)}`;
        lines.push({ label: "Closes account", value: `All remaining ALGO goes to ${close}` });
        danger(
          "account-closure",
          `This closes ${sender === me ? "your account" : `account ${short(sender)}`} and sends everything left in it to ${close}.`,
        );
        if (sender === me && close !== me && dc.balance != null) {
          // Everything left after this payment and its fee (replaced by the exact amount when simulation runs).
          const rest = dc.balance - p.amount - txn.fee;
          if (rest > 0n) closeEstimate = { asset: algo, delta: -rest };
        }
      }
      break;
    }
    case "axfer": {
      const x = txn.assetTransfer!;
      const a = asset(x.assetIndex);
      const to = addr(x.receiver);
      const from = x.assetSender ? addr(x.assetSender) : sender;
      if (x.assetSender) {
        title = `Move ${amountText(a, x.amount)} from ${who(from, me)} to ${who(to, me)}`;
        lines.push({ label: "Clawback", value: `Uses ${short(sender)}'s power to take ${a.symbol} back from any account` });
        move(a, from, to, x.amount);
      } else if (x.closeRemainderTo) {
        const close = addr(x.closeRemainderTo);
        const info = assets.get(String(x.assetIndex));
        const toIssuer = !!info && close === info.creator;
        title = toIssuer && x.amount === 0n ? `Remove ${a.symbol} from ${sender === me ? "your account" : short(sender)}` : `Remove ${a.symbol} and send all of it to ${who(close, me)}`;
        if (x.amount > 0n) lines.push({ label: "First sends", value: `${amountText(a, x.amount)} to ${to}` });
        lines.push({ label: "Then", value: `Any ${a.symbol} left goes to ${close}${toIssuer ? " (the token's issuer)" : ""}, and ${sender === me ? "your" : "the"} 0.1 ALGO deposit is unlocked` });
        move(a, sender, to, x.amount);
        if (toIssuer || close === sender) {
          if (signed) warnings.push({ level: "caution", code: "account-closure", message: say("bg.algorand.removesAsset", { symbol: a.symbol }) });
        } else {
          danger("account-closure", `Removes ${a.symbol} and sends every ${a.symbol} left to ${close}.`);
        }
      } else if (x.amount === 0n && to === sender) {
        title = sender === me ? say("bg.req.addToYourAccount", { symbol: a.symbol }) : say("bg.req.addToAccount", { symbol: a.symbol, who: short(sender) });
        lines.push({ label: "Why", value: OPT_IN_LINE });
      } else {
        title = sender === me || to !== me ? `Send ${amountText(a, x.amount)} to ${who(to, me)}` : say("bg.req.receiveFrom", { amount: amountText(a, x.amount), from: short(sender) });
        if (sender !== me && to !== me) title = say("bg.req.othersSend", { from: short(sender), amount: amountText(a, x.amount), to: short(to) });
        move(a, sender, to, x.amount);
      }
      lines.push({ label: "Token", value: `${a.name} (asset ${x.assetIndex})` });
      break;
    }
    case "acfg": {
      const c = txn.assetConfig!;
      if (c.assetIndex === 0n) {
        title = `Create token ${c.assetName || c.unitName || "(no name)"}${c.unitName ? ` (${c.unitName})` : ""}`;
        lines.push({ label: "Supply", value: formatUnits(c.total, c.decimals) });
        lines.push({ label: "Decimals", value: String(c.decimals) });
        if (c.assetURL) lines.push({ label: "Link", value: c.assetURL });
        lines.push({ label: "Locks", value: "0.1 ALGO while the token exists" });
      } else {
        const a = asset(c.assetIndex);
        const destroy = !c.total && !c.decimals && !c.manager && !c.reserve && !c.freeze && !c.clawback && !c.unitName && !c.assetName && !c.assetURL && !c.assetMetadataHash;
        if (destroy) {
          title = say("bg.req.deleteToken", { symbol: a.symbol });
          lines.push({ label: "Token", value: `${a.name} (asset ${c.assetIndex})` });
        } else {
          title = say("bg.req.changeTokenSettings", { symbol: a.symbol });
          lines.push({ label: "Token", value: `${a.name} (asset ${c.assetIndex})` });
        }
      }
      if (c.manager || c.reserve || c.freeze || c.clawback) {
        for (const [label, v] of [["Manager", c.manager], ["Reserve", c.reserve], ["Freeze", c.freeze], ["Clawback", c.clawback]] as const) {
          if (v) lines.push({ label, value: addr(v) });
        }
      }
      break;
    }
    case "afrz": {
      const f = txn.assetFreeze!;
      const a = asset(f.assetIndex);
      title = `${f.frozen ? "Freeze" : "Unfreeze"} ${a.symbol} for ${who(addr(f.freezeAccount), me)}`;
      break;
    }
    case "appl": {
      const c = txn.applicationCall!;
      const app = c.appIndex;
      const sel = c.appArgs[0]?.length === 4 ? hex(c.appArgs[0]) : null;
      const method = sel ? KNOWN_SELECTORS[sel] : undefined;
      opaque = true;
      switch (c.onComplete) {
        case OnApplicationComplete.OptInOC:
          title = say("bg.algorand.joinApp", { app });
          lines.push({ label: "Locks", value: "0.1 ALGO or more while you're in the app" });
          break;
        case OnApplicationComplete.CloseOutOC:
          title = say("bg.algorand.leaveApp", { app });
          break;
        case OnApplicationComplete.ClearStateOC:
          title = say("bg.algorand.leaveAppErase", { app });
          break;
        case OnApplicationComplete.UpdateApplicationOC:
          title = say("bg.algorand.replaceAppCode", { app });
          danger("blind-signing", `This replaces app ${app}'s code. Only approve if you run this app.`);
          break;
        case OnApplicationComplete.DeleteApplicationOC:
          title = say("bg.algorand.deleteApp", { app });
          danger("blind-signing", `This deletes app ${app}. Only approve if you run this app.`);
          break;
        default:
          title = app === 0n ? "Create an app" : `Call app ${app}`;
      }
      if (app === 0n) {
        title = "Create an app";
        lines.push({ label: "Locks", value: "Some ALGO while the app exists" });
      }
      if (method === "arc200_transfer(address,uint256)bool" && c.appArgs[1]?.length === 32) {
        const to = encodeAddress(c.appArgs[1]);
        title = `Send ${u256(c.appArgs[2])} units of app ${app}'s token to ${who(to, me)}`;
        lines.push({ label: "Token", value: `ARC-200 token (app ${app}); amount in its smallest units` });
      } else if (method === "arc200_transferFrom(address,address,uint256)bool" && c.appArgs[1]?.length === 32 && c.appArgs[2]?.length === 32) {
        title = `Move ${u256(c.appArgs[3])} units of app ${app}'s token from ${who(encodeAddress(c.appArgs[1]), me)} to ${who(encodeAddress(c.appArgs[2]), me)}`;
      } else if (method === "arc200_approve(address,uint256)bool" && c.appArgs[1]?.length === 32) {
        const spender = encodeAddress(c.appArgs[1]);
        const v = u256(c.appArgs[2]);
        title = `Let ${short(spender)} spend ${v === UINT256_MAX ? "all" : `${v} units`} of app ${app}'s token`;
        if (signed && v === UINT256_MAX) {
          warnings.push({ level: "danger", code: "unlimited-approval", message: `${spender} could take all of this token from you, at any time.` });
        }
      } else if (sel && c.onComplete === OnApplicationComplete.NoOpOC && app !== 0n) {
        title = say("bg.algorand.callApp", { app, method: sel });
      }
      if (method) lines.push({ label: "Method", value: method });
      else if (sel) lines.push({ label: "Method", value: `0x${sel}` });
      if (c.appArgs.length) lines.push({ label: "Arguments", value: String(c.appArgs.length) });
      if (c.accounts.length) lines.push({ label: "Accounts", value: c.accounts.map((a) => short(addr(a))).join(", ") });
      if (c.foreignApps.length) lines.push({ label: "Other apps", value: c.foreignApps.join(", ") });
      if (c.foreignAssets.length) lines.push({ label: "Tokens", value: c.foreignAssets.join(", ") });
      if (c.boxes.length) lines.push({ label: "Storage boxes", value: String(c.boxes.length) });
      if (c.access.length) lines.push({ label: "Resources", value: String(c.access.length) });
      break;
    }
    case "keyreg": {
      title = "Register for consensus";
      blind = true;
      warnings.push({
        level: "danger",
        code: "blind-signing",
        message: "Registers this account for consensus participation — Clip Wallet doesn't support this yet.",
      });
      break;
    }
    default:
      title = "Approve an Algorand transaction";
      blind = true;
      warnings.push({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction." });
  }

  if (txn.rekeyTo) {
    const target = addr(txn.rekeyTo);
    if (target === sender) {
      lines.push({ label: "Control", value: "Returns control of the account to its own key" });
    } else {
      const whose = sender === me ? "your account" : `account ${short(sender)}`;
      lines.push({ label: "Gives control to", value: target });
      danger("account-takeover", `Gives control of ${whose} to ${target}. You'd lose the ability to use this wallet for it.`);
    }
  }
  if (item.sgnr) {
    lines.push({ label: "Signs for", value: `${sender} (an account that handed control to this one)` });
  }
  if (txn.note.length) {
    const t = textOf(txn.note);
    lines.push({ label: "Note", value: t ?? `0x${hex(txn.note.slice(0, 64))}${txn.note.length > 64 ? "…" : ""}` });
  }
  if (txn.lease && txn.lease.some((b) => b !== 0)) lines.push({ label: "Lease", value: `0x${hex(txn.lease)}` });
  if (item.message) lines.push({ label: "App says (unverified)", value: item.message });
  if (signed && dc.lastRound != null && txn.firstValid > dc.lastRound + FUTURE_ROUNDS) {
    warnings.push({
      level: "danger",
      code: "durable-nonce",
      message: say("bg.algorand.validLater", { round: txn.firstValid }),
    });
  }
  const one: One = { title, lines, warnings, blind, moves, fee: sender === me ? txn.fee : 0n, opaque };
  if (closeEstimate) one.closeEstimate = closeEstimate;
  return one;
}

/* ------------------------------------------------------------------ simulation */

interface SimTxnJson {
  type?: string;
  snd?: string;
  rcv?: string;
  amt?: unknown;
  close?: string;
  xaid?: unknown;
  aamt?: unknown;
  arcv?: string;
  asnd?: string;
  aclose?: string;
}

interface SimTxnResult {
  txn?: { txn?: SimTxnJson };
  "closing-amount"?: unknown;
  "asset-closing-amount"?: unknown;
  "inner-txns"?: SimTxnResult[];
}

interface SimResponse {
  "txn-groups"?: {
    "failure-message"?: string;
    "failed-at"?: number[];
    "txn-results"?: { "txn-result"?: SimTxnResult }[];
  }[];
}

interface SimOutcome {
  ok: boolean;
  warning?: Warning;
  /** Inner-transaction moves for this account (apps paying you / taking from you). */
  inner: { assetId: string | null; delta: bigint }[];
  /** Exact close-out amounts by item index. */
  closing: Map<number, { algo: bigint; asset: bigint }>;
}

function innerMoves(r: SimTxnResult, me: string, out: { assetId: string | null; delta: bigint }[]) {
  for (const inner of r["inner-txns"] ?? []) {
    const t = inner.txn?.txn ?? {};
    if (t.type === "pay") {
      const amt = big(t.amt);
      if (t.snd === me) out.push({ assetId: null, delta: -amt });
      if (t.rcv === me) out.push({ assetId: null, delta: amt });
      const closed = big(inner["closing-amount"]);
      if (t.close === me && closed) out.push({ assetId: null, delta: closed });
    } else if (t.type === "axfer") {
      const id = String(big(t.xaid));
      const amt = big(t.aamt);
      const from = t.asnd ?? t.snd;
      if (from === me) out.push({ assetId: id, delta: -amt });
      if (t.arcv === me) out.push({ assetId: id, delta: amt });
      const closed = big(inner["asset-closing-amount"]);
      if (t.aclose === me && closed) out.push({ assetId: id, delta: closed });
    }
    innerMoves(inner, me, out);
  }
}

export function simulateBody(n: Normalized): Uint8Array {
  const txnGroups = n.groups.map((g) => ({
    txns: g.map((i) => {
      const it = n.items[i]!;
      return msgpackRawDecode(it.stxn ?? encodeUnsignedSimulateTransaction(it.txn));
    }),
  }));
  return msgpackRawEncode({ "txn-groups": txnGroups, "allow-empty-signatures": true, "fix-signers": true });
}

/** POST /v2/transactions/simulate (msgpack body, JSON response). */
async function simulate(n: Normalized, dc: DescribeContext, tokenName: (id: string) => string | undefined): Promise<SimOutcome | null> {
  if (!dc.simulate || !dc.algod) return null;
  let r: SimResponse;
  try {
    r = await dc.algod.post<SimResponse>("/v2/transactions/simulate?format=json", simulateBody(n), "application/msgpack");
  } catch (e) {
    const raw = e instanceof AlgodError ? e.message : "";
    return {
      ok: false,
      inner: [],
      closing: new Map(),
      warning: { level: "caution", code: "simulation-failed", message: raw ? plainAlgorandError(raw, { me: dc.me, tokenName }) : "Couldn't test-run this transaction." },
    };
  }
  const out: SimOutcome = { ok: true, inner: [], closing: new Map() };
  (r["txn-groups"] ?? []).forEach((g, gi) => {
    if (g["failure-message"]) {
      out.ok = false;
      out.warning ??= { level: "caution", code: "simulation-failed", message: plainAlgorandError(g["failure-message"], { me: dc.me, tokenName }) };
    }
    (g["txn-results"] ?? []).forEach((tr, ti) => {
      const res = tr["txn-result"];
      if (!res) return;
      const idx = n.groups[gi]?.[ti];
      if (idx != null) out.closing.set(idx, { algo: big(res["closing-amount"]), asset: big(res["asset-closing-amount"]) });
      innerMoves(res, dc.me, out.inner);
    });
  });
  if (out.warning) out.warning = { ...out.warning, message: `${out.warning.message} (found in a test run)` };
  return out;
}

/* ------------------------------------------------------------------ whole request */

function sumMoves(moves: Move[]): BalanceChange[] {
  const sum = new Map<string, { asset: AssetRef; delta: bigint }>();
  for (const m of moves) {
    const k = m.asset.address ?? m.asset.key;
    const e = sum.get(k) ?? { asset: m.asset, delta: 0n };
    e.delta += m.delta;
    sum.set(k, e);
  }
  return [...sum.values()].filter((e) => e.delta !== 0n).map((e) => ({ asset: e.asset, delta: e.delta.toString() }));
}

export async function describeRequest(n: Normalized, dc: DescribeContext): Promise<Described> {
  const assets = await loadAssets(dc.algod, assetIdsOf(n.items));
  const tokenName = (id: string) => assets.get(id)?.unitName || undefined;
  const ones = n.items.map((it) => describeOne(it, dc, assets));
  const sim = await simulate(n, dc, tokenName);

  const moves: Move[] = ones.flatMap((o) => o.moves);
  const algo = algoAsset(dc.networkId);
  n.items.forEach((it, i) => {
    if (it.sender !== dc.me) return;
    const c = sim?.ok ? sim.closing.get(i) : undefined;
    const p = it.txn.payment;
    if (p?.closeRemainderTo && addr(p.closeRemainderTo) !== dc.me) {
      if (c?.algo) moves.push({ asset: algo, delta: -c.algo });
      else if (ones[i]!.closeEstimate) moves.push(ones[i]!.closeEstimate!);
    }
    const x = it.txn.assetTransfer;
    if (x && !x.assetSender && x.closeRemainderTo && addr(x.closeRemainderTo) !== dc.me && c?.asset) {
      moves.push({ asset: asaAsset(dc.networkId, x.assetIndex, assets.get(String(x.assetIndex))), delta: -c.asset });
    }
  });
  if (sim?.ok) {
    const innerIds = sim.inner.map((m) => m.assetId).filter((x): x is string => !!x && !assets.has(x));
    for (const [k, v] of await loadAssets(dc.algod, innerIds)) assets.set(k, v);
    for (const m of sim.inner) moves.push({ asset: m.assetId ? asaAsset(dc.networkId, m.assetId, assets.get(m.assetId)) : algo, delta: m.delta });
  }

  const warnings: Warning[] = [];
  for (const w of ones.flatMap((o) => o.warnings)) if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push(w);
  if (sim?.warning) warnings.push(sim.warning);
  const fee = n.items.reduce((a, it, i) => a + (it.sign || it.stxn ? ones[i]!.fee : 0n), 0n);
  if (fee > HIGH_FEE) {
    warnings.push({ level: fee >= 10n * HIGH_FEE ? "danger" : "caution", code: "high-fee", message: say("bg.algorand.highFee", { fee: formatUnits(fee, 6) }) });
  }

  let title: string;
  let lines: Line[];
  if (ones.length === 1) {
    title = ones[0]!.title;
    lines = [...ones[0]!.lines];
  } else {
    const signedCount = n.items.filter((i) => i.sign).length;
    title = say("bg.req.approveCount", { count: ones.length });
    lines = [];
    const grouped = n.groups.some((g) => g.length > 1);
    if (grouped) lines.push({ label: "Together", value: "Transactions in a group all go through, or none do" });
    n.items.forEach((it, i) => {
      const o = ones[i]!;
      lines.push({ label: `Transaction ${i + 1}${it.sign ? "" : " (signed by someone else)"}`, value: o.title });
      lines.push(...o.lines.map((l) => ({ label: `  ${l.label}`, value: l.value })));
    });
    if (signedCount < ones.length) lines.push({ label: "You sign", value: `${signedCount} of ${ones.length}` });
  }
  const groupMessage = n.items.find((i) => i.groupMessage)?.groupMessage ?? n.message;
  if (groupMessage) lines.push({ label: "App says (unverified)", value: groupMessage });
  if (ones.some((o) => o.opaque) && !sim?.ok) {
    lines.push({ label: "App effects", value: "Not shown: the app call couldn't be test-run" });
  }

  return {
    title,
    lines,
    balanceChanges: sumMoves(moves),
    warnings,
    blind: ones.some((o) => o.blind),
    simulated: !!sim?.ok,
    fee,
  };
}
