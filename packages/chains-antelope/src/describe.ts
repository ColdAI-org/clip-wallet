import { type BalanceChange, type NetworkId, type Warning, say } from "@clip-wallet/core";
import { type Abi, AbiError, TOKEN_ABI, decodeActionData, isTokenTransfer } from "./abi.js";
import { fromHex, parseAsset } from "./bytes.js";
import { assetFor, knownTokens } from "./networks.js";
import type { Rpc } from "./rpc.js";
import type { ActionJson } from "./transaction.js";

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
  /** This key's accounts on the network. */
  mine: Set<string>;
  rpc: Rpc | null;
}

/** Actions on eosio that hand control of an account to other keys or accounts. */
const AUTH_ACTIONS = new Set(["updateauth", "deleteauth", "linkauth", "unlinkauth"]);

const danger = (code: Warning["code"], message: string): Warning => ({ level: "danger", code, message });
const caution = (code: Warning["code"], message: string): Warning => ({ level: "caution", code, message });

function short(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** The ABI to read an action with: eosio.token-style transfers of known token contracts need no network call. */
export async function abiFor(a: ActionJson, dc: { networkId: NetworkId; rpc: Rpc | null }): Promise<Abi | null> {
  if (a.name === "transfer" && knownTokens(dc.networkId).some((t) => t.contract === a.account)) return TOKEN_ABI;
  if (!dc.rpc) return null;
  return dc.rpc.abi(a.account);
}

interface One {
  title: string;
  lines: Line[];
  changes: BalanceChange[];
  warnings: Warning[];
  blind?: boolean;
}

async function describeAction(a: ActionJson, dc: DescribeContext): Promise<One> {
  let abi: Abi | null = null;
  try {
    abi = await abiFor(a, dc);
  } catch {
    abi = null;
  }
  let data: Record<string, unknown>;
  try {
    if (!abi) throw new AbiError("no ABI");
    data = decodeActionData(abi, a.name, fromHex(a.data));
  } catch {
    return { title: say("bg.antelope.callOn", { action: a.name, contract: a.account }), lines: [{ label: "Data", value: `0x${a.data.slice(0, 64)}${a.data.length > 64 ? "…" : ""}` }], changes: [], warnings: [], blind: true };
  }

  if (abi && isTokenTransfer(abi, a.name)) {
    const from = String(data.from);
    const to = String(data.to);
    let q;
    try {
      q = parseAsset(String(data.quantity));
    } catch {
      return { title: say("bg.antelope.callOn", { action: a.name, contract: a.account }), lines: [], changes: [], warnings: [], blind: true };
    }
    const asset = assetFor(dc.networkId, a.account, q.symbol.code, q.symbol.precision);
    const amount = `${String(data.quantity).split(" ")[0]} ${q.symbol.code}`;
    const lines: Line[] = [{ label: "To", value: to }];
    if (!dc.mine.has(from)) lines.unshift({ label: "From", value: from });
    if (data.memo) lines.push({ label: "Memo", value: short(data.memo) });
    lines.push({ label: "Token", value: `${q.symbol.code} · ${a.account}` });
    const warnings: Warning[] = [];
    if (asset.spam) warnings.push(danger("known-scam", say("bg.warn.spamToken", { symbol: q.symbol.code })));
    else if (!knownTokens(dc.networkId).some((t) => t.contract === a.account && t.symbol === q.symbol.code)) {
      warnings.push(caution("unknown-call", say("bg.antelope.unknownToken", { symbol: q.symbol.code, contract: a.account })));
    }
    const changes: BalanceChange[] = [];
    if (dc.mine.has(from) && !dc.mine.has(to)) changes.push({ asset, delta: (-q.amount).toString() });
    if (!dc.mine.has(from) && dc.mine.has(to)) changes.push({ asset, delta: q.amount.toString() });
    const title = dc.mine.has(from) ? say("bg.req.sendTo", { amount, to }) : say("bg.req.othersSend", { from, amount, to });
    if (dc.rpc && dc.mine.has(from) && !dc.mine.has(to)) {
      const exists = await dc.rpc.account(to).catch(() => undefined);
      if (exists === null) warnings.push(danger("simulation-failed", say("bg.antelope.noRecipient", { to })));
    }
    return { title, lines, changes, warnings };
  }

  const fields: Line[] = Object.entries(data).map(([k, v]) => ({ label: k, value: short(v) }));
  if (a.account === "eosio" && AUTH_ACTIONS.has(a.name)) {
    const account = String(data.account ?? "");
    const permission = String(data.permission ?? data.requirement ?? "");
    const title =
      a.name === "updateauth"
        ? say("bg.antelope.updateAuth", { permission, account })
        : a.name === "deleteauth"
          ? say("bg.antelope.deleteAuth", { permission, account })
          : a.name === "linkauth"
            ? say("bg.antelope.linkAuth", { permission: String(data.requirement ?? ""), action: `${String(data.code)}::${String(data.type || "*")}` })
            : say("bg.antelope.unlinkAuth", { action: `${String(data.code)}::${String(data.type || "*")}` });
    const warning = a.name === "unlinkauth" ? caution("account-takeover", say("bg.antelope.unlinkWarning")) : danger("account-takeover", say("bg.antelope.authWarning", { account: account || [...dc.mine][0] || "?" }));
    return { title, lines: fields, changes: [], warnings: [warning] };
  }

  return {
    title: say("bg.antelope.callOn", { action: a.name, contract: a.account }),
    lines: fields,
    changes: [],
    warnings: [caution("unknown-call", "Clip Wallet can name this call but can't fully read it, so some of its effects may not be shown.")],
  };
}

/** Reads every action. Blind when any action can't be read through its contract's ABI. */
export async function describeActions(actions: ActionJson[], dc: DescribeContext): Promise<Described> {
  const parts: One[] = [];
  for (const a of actions) parts.push(await describeAction(a, dc));
  const blind = parts.some((p) => p.blind);
  const lines: Line[] = [];
  if (parts.length === 1) lines.push(...parts[0]!.lines);
  else {
    parts.forEach((p, i) => {
      lines.push({ label: say("bg.label.actionN", { n: i + 1 }), value: p.title });
      lines.push(...p.lines);
    });
  }
  for (const a of actions) {
    for (const p of a.authorization) if (!dc.mine.has(p.actor)) lines.push({ label: say("bg.antelope.label.alsoSigns"), value: `${p.actor}@${p.permission}` });
  }
  const warnings = parts.flatMap((p) => p.warnings);
  if (blind) warnings.unshift({ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." });
  // Net balance changes per asset.
  const net = new Map<string, BalanceChange>();
  for (const c of parts.flatMap((p) => p.changes)) {
    const k = `${c.asset.key}/${c.asset.address ?? ""}`;
    const prev = net.get(k);
    net.set(k, { asset: c.asset, delta: (BigInt(prev?.delta ?? "0") + BigInt(c.delta)).toString() });
  }
  return {
    title: parts.length === 1 ? parts[0]!.title : say("bg.req.approveOps", { count: parts.length }),
    lines,
    balanceChanges: [...net.values()].filter((c) => c.delta !== "0"),
    warnings,
    blind,
  };
}
