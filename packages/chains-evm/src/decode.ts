/**
 * decode(): DappRequest → DecodedRequest in plain words.
 * Titles never contain raw method names; fees are an amount of the network's native asset.
 */
import { ClipError, type BalanceChange, type ChainContext, type DappRequest, type DecodedRequest, type Warning } from "@clip-wallet/core";
import {
  type AbiFunction,
  type Hex,
  decodeFunctionData,
  hexToBytes,
  isAddressEqual,
  isHex,
  parseAbi,
  toFunctionSelector,
} from "viem";
import { chainIdOf, quoteFees, tokenMeta } from "./chain.js";
import { formatAmount, hostOf, isUnlimited, safeChecksum, shortAddress } from "./format.js";
import { type TxParams, type TypedData, parsePersonalSign, parseTx, parseTypedData } from "./params.js";
import { lookupSelector } from "./selectors.js";
import { simulate } from "./simulate.js";
import { appName } from "./tokens.js";

export const SUPPORTED_METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_sign"] as const;

const tokenAbi = parseAbi([
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function setApprovalForAll(address operator, bool approved)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
]);

const sel = (sig: string) => toFunctionSelector(`function ${sig}`);
export const SEL = {
  transfer: sel("transfer(address,uint256)"),
  transferFrom: sel("transferFrom(address,address,uint256)"),
  approve: sel("approve(address,uint256)"),
  increaseAllowance: sel("increaseAllowance(address,uint256)"),
  setApprovalForAll: sel("setApprovalForAll(address,bool)"),
  safeTransferFrom721: sel("safeTransferFrom(address,address,uint256)"),
  safeTransferFrom721Data: sel("safeTransferFrom(address,address,uint256,bytes)"),
  safeTransferFrom1155: sel("safeTransferFrom(address,address,uint256,uint256,bytes)"),
} as const;

/** Name for a contract or account in plain words: a known app, otherwise the short address. */
const who = (address: string): string => appName(address) ?? shortAddress(address);

function base(req: DappRequest): DecodedRequest {
  return { requestId: req.id, title: "", lines: [], balanceChanges: [], simulated: false, blind: false, warnings: [], networkId: req.networkId };
}

export async function decodeRequest(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
  switch (req.method) {
    case "eth_sendTransaction":
      return decodeTransaction(req, ctx);
    case "personal_sign":
      return decodePersonalSign(req, ctx);
    case "eth_signTypedData_v4":
      return decodeTypedData(req, ctx);
    case "eth_sign":
      return decodeEthSign(req);
    default:
      throw new ClipError("Clip Wallet doesn't support this kind of request yet.", "unsupported-method", req.method);
  }
}

/* ------------------------------------------------------------------ transactions */

async function decodeTransaction(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
  const tx = parseTx(req, ctx);
  const d = base(req);
  const native = ctx.network.nativeAsset;
  const host = hostOf(req.origin);
  const staticChanges: BalanceChange[] = [];
  const nativeOut = (v: bigint) => v > 0n && staticChanges.push({ asset: native, delta: (-v).toString() });

  if (!tx.to) {
    d.title = `Create a new app contract for ${host}`;
    d.lines.push({ label: "App", value: host });
    nativeOut(tx.value);
  } else if (tx.data === "0x" || tx.data.length < 10) {
    const amt = formatAmount(tx.value, native.decimals);
    d.title = `Send ${amt} ${native.symbol} to ${shortAddress(tx.to)}`;
    d.lines.push({ label: "To", value: safeChecksum(tx.to) }, { label: "Amount", value: `${amt} ${native.symbol}` });
    nativeOut(tx.value);
  } else {
    await decodeCall(ctx, tx, d, staticChanges, host);
    if (tx.value > 0n) {
      d.lines.push({ label: "Also sends", value: `${formatAmount(tx.value, native.decimals)} ${native.symbol}` });
      nativeOut(tx.value);
    }
  }
  d.lines.push({ label: "Requested by", value: host });

  // Simulation and fee
  const sim = await simulate(ctx, tx);
  if (sim.simulated && !sim.reverts) {
    d.simulated = true;
    d.balanceChanges = sim.balanceChanges;
    for (const m of sim.nftMoves) {
      d.lines.push({ label: m.direction === "in" ? "You receive" : "You send", value: `NFT #${m.tokenId} from ${who(m.contract)}` });
    }
  } else {
    d.balanceChanges = staticChanges;
  }
  if (sim.reverts) {
    d.warnings.push({ level: "danger", code: "simulation-failed", message: `This is expected to fail and would still cost a fee.${sim.revertReason ? ` Reason: ${sim.revertReason}` : ""}` });
  } else if (!sim.simulated) {
    d.warnings.push({ level: "caution", code: "simulation-failed", message: "We couldn't preview the exact result of this on the network. Check the details before you approve." });
  }
  try {
    const fees = await quoteFees(ctx);
    const gas = tx.gas ?? (sim.gasUsed !== undefined ? (sim.gasUsed * 12n) / 10n : undefined);
    if (gas !== undefined) d.fee = { asset: native, amount: (gas * fees.expectedPerGas).toString() };
  } catch {
    /* fee unknown: the UI shows "fee unavailable" */
  }
  return d;
}

async function decodeCall(ctx: ChainContext, tx: TxParams, d: DecodedRequest, staticChanges: BalanceChange[], host: string): Promise<void> {
  const to = tx.to!;
  const selector = tx.data.slice(0, 10).toLowerCase();
  const me = ctx.account.address as `0x${string}`;

  const decoded = (() => {
    try {
      return decodeFunctionData({ abi: tokenAbi, data: tx.data });
    } catch {
      return undefined;
    }
  })();

  if (decoded && (selector === SEL.transfer || selector === SEL.transferFrom)) {
    const [from, recipient, amount] =
      selector === SEL.transfer ? [me, decoded.args[0] as string, decoded.args[1] as bigint] : (decoded.args as unknown as [string, string, bigint]);
    const { asset, isToken } = await tokenMeta(ctx, to);
    if (!isToken) {
      // ERC-721 transferFrom shares the ERC-20 selector.
      d.title = `Send NFT #${amount} from ${asset.name} to ${shortAddress(recipient)}`;
      d.lines.push({ label: "To", value: safeChecksum(recipient) }, { label: "Collection", value: `${asset.name} (${safeChecksum(to)})` });
      return;
    }
    const amt = `${formatAmount(amount, asset.decimals)} ${asset.symbol}`;
    const ownFrom = isAddressEqual(from as `0x${string}`, me);
    d.title = ownFrom ? `Send ${amt} to ${shortAddress(recipient)}` : `Move ${amt} from ${shortAddress(from)} to ${shortAddress(recipient)}`;
    d.lines.push({ label: "To", value: safeChecksum(recipient) }, { label: "Amount", value: amt }, { label: "Token", value: `${asset.name} (${safeChecksum(to)})` });
    if (!ownFrom) d.lines.splice(0, 0, { label: "From", value: safeChecksum(from) });
    if (asset.spam) d.warnings.push({ level: "caution", code: "known-scam", message: `${asset.symbol} looks like a spam token. It may be worthless or a trap.` });
    if (ownFrom) staticChanges.push({ asset, delta: (-amount).toString() });
    if (!ownFrom && isAddressEqual(recipient as `0x${string}`, me)) staticChanges.push({ asset, delta: amount.toString() });
    return;
  }

  if (decoded && (selector === SEL.approve || selector === SEL.increaseAllowance)) {
    const [spender, amount] = decoded.args as unknown as [string, bigint];
    const { asset, isToken } = await tokenMeta(ctx, to);
    const name = who(spender);
    if (!isToken) {
      // ERC-721 approve(to, tokenId)
      d.title = `Allow ${name} to move your NFT #${amount} from ${asset.name}`;
      d.lines.push({ label: "Allowed app", value: safeChecksum(spender) }, { label: "Collection", value: `${asset.name} (${safeChecksum(to)})` });
      return;
    }
    if (selector === SEL.approve && amount === 0n) {
      d.title = `Stop ${name} from spending your ${asset.symbol}`;
    } else if (isUnlimited(amount)) {
      d.title = `Allow ${name} to spend all your ${asset.symbol}`;
      d.warnings.push({
        level: "danger",
        code: "unlimited-approval",
        message: `This lets ${name} take all your ${asset.symbol}, now or any time later, without asking again. Only allow this for apps you trust.`,
      });
    } else {
      const amt = `${formatAmount(amount, asset.decimals)} ${asset.symbol}`;
      d.title = selector === SEL.approve ? `Allow ${name} to spend up to ${amt}` : `Allow ${name} to spend ${amt} more`;
    }
    d.lines.push({ label: "Allowed app", value: safeChecksum(spender) }, { label: "Token", value: `${asset.name} (${safeChecksum(to)})` });
    if (!isUnlimited(amount) && amount > 0n) d.lines.push({ label: "Limit", value: `${formatAmount(amount, asset.decimals)} ${asset.symbol}` });
    return;
  }

  if (decoded && selector === SEL.setApprovalForAll) {
    const [operator, approved] = decoded.args as unknown as [string, boolean];
    const { asset } = await tokenMeta(ctx, to);
    const name = who(operator);
    const collection = asset.name && asset.name !== "token" ? asset.name : shortAddress(to);
    if (approved) {
      d.title = `Allow ${name} to move all your ${collection} NFTs`;
      d.warnings.push({
        level: "danger",
        code: "approval-for-all",
        message: `This lets ${name} take every NFT you hold in ${collection}, including ones you get later. Scams often ask for this.`,
      });
    } else {
      d.title = `Stop ${name} from moving your ${collection} NFTs`;
    }
    d.lines.push({ label: "Allowed app", value: safeChecksum(operator) }, { label: "Collection", value: safeChecksum(to) });
    return;
  }

  if (decoded && (selector === SEL.safeTransferFrom721 || selector === SEL.safeTransferFrom721Data || selector === SEL.safeTransferFrom1155)) {
    const args = decoded.args as unknown as [string, string, bigint, ...unknown[]];
    const [, recipient, id] = args;
    const { asset } = await tokenMeta(ctx, to);
    const collection = asset.name && asset.name !== "token" ? asset.name : shortAddress(to);
    const count = selector === SEL.safeTransferFrom1155 ? (args[3] as bigint) : 1n;
    d.title = count === 1n ? `Send NFT #${id} from ${collection} to ${shortAddress(recipient)}` : `Send ${count} × NFT #${id} from ${collection} to ${shortAddress(recipient)}`;
    d.lines.push({ label: "To", value: safeChecksum(recipient) }, { label: "Collection", value: safeChecksum(to) });
    return;
  }

  const known = lookupSelector(selector);
  const app = appName(to) ?? host;
  if (known) {
    d.title = `${known.action} on ${app}`;
    d.lines.push({ label: "App contract", value: safeChecksum(to) });
    try {
      const { args } = decodeFunctionData({ abi: [known.abi], data: tx.data });
      describeArgs(known.abi, (args ?? []) as readonly unknown[]).forEach((l) => d.lines.push(l));
    } catch {
      /* selector collision; the action name is still right enough to show */
    }
    return;
  }

  d.blind = true;
  d.title = `Approve an unreadable request from ${host}`;
  d.lines.push({ label: "App contract", value: safeChecksum(to) }, { label: "Data", value: `${tx.data.slice(0, 74)}${tx.data.length > 74 ? "…" : ""}` });
  d.warnings.push({
    level: "danger",
    code: "blind-signing",
    message: "We can't read what this does. It could move any of your assets. Only continue if you fully trust this app.",
  });
}

function describeArgs(abi: AbiFunction, args: readonly unknown[]): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  abi.inputs.slice(0, 6).forEach((input, i) => {
    const v = args[i];
    let s: string;
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) s = safeChecksum(v);
    else if (typeof v === "bigint") s = v.toString();
    else if (typeof v === "string") s = v.length > 66 ? `${v.slice(0, 66)}…` : v;
    else s = truncate(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)) ?? "");
    out.push({ label: humanLabel(input.name || input.type), value: s });
  });
  return out;
}

const humanLabel = (name: string) => {
  const s = name.replace(/^_+/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const truncate = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

/* ------------------------------------------------------------------ personal_sign */

const SIWE = /^(?:(?:https?):\/\/)?([^\s]+) wants you to sign in with your Ethereum account:\n(0x[a-fA-F0-9]{40})/;

export function messageText(message: string): { text: string; isText: boolean } {
  if (!isHex(message)) return { text: message, isText: true };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(message as Hex));
    // eslint-disable-next-line no-control-regex
    if (/^[^\x00-\x08\x0E-\x1F\x7F]*$/.test(text)) return { text, isText: true };
  } catch {
    /* not UTF-8 */
  }
  return { text: message, isText: false };
}

async function decodePersonalSign(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
  const { message } = parsePersonalSign(req, ctx);
  const d = base(req);
  const host = hostOf(req.origin);
  const { text, isText } = messageText(message);
  const siwe = isText ? SIWE.exec(text) : null;
  if (siwe) {
    const domain = siwe[1]!;
    d.title = `Sign in to ${domain}`;
    d.lines.push({ label: "Website", value: domain }, { label: "Message", value: text });
    if (domain !== host) {
      d.warnings.push({
        level: "danger",
        code: "domain-mismatch",
        message: `This sign-in is for ${domain}, but the request came from ${host}. A site may be trying to sign in as you somewhere else.`,
      });
    }
    if (!isAddressEqual(siwe[2] as `0x${string}`, ctx.account.address as `0x${string}`)) {
      d.warnings.push({ level: "danger", code: "domain-mismatch", message: "This sign-in names a different account than yours." });
    }
  } else if (isText) {
    d.title = `Sign a message for ${host}`;
    d.lines.push({ label: "Message", value: text });
  } else {
    d.title = `Sign data for ${host}`;
    d.lines.push({ label: "Data", value: truncate(text, 200) });
    d.warnings.push({ level: "caution", code: "blind-signing", message: "This message isn't readable text. It can't move funds by itself, but only sign it if you trust the site." });
  }
  d.lines.push({ label: "Requested by", value: host });
  return d;
}

/* ------------------------------------------------------------------ eth_signTypedData_v4 */

const MAX_UINT160 = (1n << 160n) - 1n;
const PERMIT2_UNLIMITED = MAX_UINT160 >> 1n;

interface PermitGrant {
  token: string;
  amount: bigint | "all";
}

function big(v: unknown): bigint | undefined {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" || (typeof v === "string" && v.length > 0)) return BigInt(v as string | number);
  } catch {
    /* not a number */
  }
  return undefined;
}

async function decodeTypedData(req: DappRequest, ctx: ChainContext): Promise<DecodedRequest> {
  const td = parseTypedData(req, ctx);
  const d = base(req);
  const host = hostOf(req.origin);
  const dom = td.domain;
  const msg = td.message;
  const domainName = typeof dom.name === "string" ? dom.name : undefined;
  const verifying = typeof dom.verifyingContract === "string" ? dom.verifyingContract : undefined;

  const domainChain = big(dom.chainId);
  if (domainChain !== undefined && domainChain !== BigInt(chainIdOf(ctx))) {
    d.warnings.push({ level: "caution", code: "network-matters", message: "This signature is for a different network than the one selected." });
  }

  const isPermit2 = domainName === "Permit2";
  const isEip2612 = td.primaryType === "Permit" && !isPermit2 && "spender" in msg;
  if (isPermit2 || isEip2612) {
    const spender = String(msg.spender ?? "");
    const grants: PermitGrant[] = [];
    if (isEip2612) {
      if ("allowed" in msg) grants.push({ token: verifying ?? "", amount: msg.allowed === true || msg.allowed === "true" ? "all" : 0n });
      else {
        const v = big(msg.value) ?? 0n;
        grants.push({ token: verifying ?? "", amount: isUnlimited(v) ? "all" : v });
      }
    } else {
      const collect = (x: unknown) => {
        const arr = Array.isArray(x) ? x : x ? [x] : [];
        for (const e of arr as Record<string, unknown>[]) {
          const v = big(e.amount) ?? 0n;
          grants.push({ token: String(e.token ?? ""), amount: v >= PERMIT2_UNLIMITED ? "all" : v });
        }
      };
      collect(msg.details);
      collect(msg.permitted);
    }
    const parts: string[] = [];
    let unlimited = false;
    for (const g of grants) {
      const { asset } = g.token ? await tokenMeta(ctx, g.token).catch(() => ({ asset: undefined })) : { asset: undefined };
      const sym = asset?.symbol ?? (isEip2612 && domainName ? domainName : "tokens");
      if (g.amount === "all") {
        unlimited = true;
        parts.push(`all your ${sym}`);
      } else parts.push(`${asset ? formatAmount(g.amount, asset.decimals) : g.amount.toString()} ${sym}`);
      d.lines.push({ label: "Token", value: g.token ? `${asset?.name ?? sym} (${safeChecksum(g.token)})` : sym });
    }
    const name = spender ? who(spender) : host;
    d.title = parts.length ? `Allow ${name} to spend ${parts.join(", ")}` : `Give ${name} permission to spend your tokens`;
    if (spender) d.lines.unshift({ label: "Allowed app", value: safeChecksum(spender) });
    const deadline = big(msg.deadline ?? msg.sigDeadline ?? msg.expiry ?? (msg.details as Record<string, unknown> | undefined)?.expiration);
    if (deadline !== undefined && deadline > 0n && deadline < 1n << 48n) {
      d.lines.push({ label: "Permission expires", value: new Date(Number(deadline) * 1000).toISOString().replace(".000Z", "Z") });
    }
    d.warnings.push({
      level: unlimited ? "danger" : "caution",
      code: "permit",
      message: `Signing this lets ${name} move ${parts.join(", ") || "your tokens"} without asking again. It costs nothing to sign, which is why scams use it.`,
    });
    if (unlimited) d.warnings.push({ level: "danger", code: "unlimited-approval", message: `${name} could take all of these tokens at any time.` });
  } else {
    d.title = `Sign a message for ${host}`;
    if (domainName) d.lines.push({ label: "App", value: domainName });
    if (verifying) d.lines.push({ label: "App contract", value: safeChecksum(verifying) });
    d.lines.push({ label: "Type", value: humanLabel(td.primaryType) });
    for (const [k, v] of Object.entries(msg).slice(0, 8)) {
      const s = typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? safeChecksum(v) : typeof v === "object" ? truncate(JSON.stringify(v)) : String(v);
      d.lines.push({ label: humanLabel(k), value: s });
    }
  }
  d.lines.push({ label: "Requested by", value: host });
  return d;
}

/* ------------------------------------------------------------------ eth_sign */

function decodeEthSign(req: DappRequest): DecodedRequest {
  const d = base(req);
  d.blind = true;
  d.title = `Refused: unreadable signature request from ${hostOf(req.origin)}`;
  d.lines.push({ label: "Requested by", value: hostOf(req.origin) });
  const w: Warning = {
    level: "danger",
    code: "blind-signing",
    message: "This kind of request can authorize anything, including moving all your funds. Clip Wallet doesn't sign it.",
  };
  d.warnings.push(w);
  return d;
}

