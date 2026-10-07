import { type AssetRef, type BalanceChange, type NetworkId, type Warning, say } from "@clip-wallet/core";
import { currencyName, tokenAsset, xrpAsset } from "./networks.js";
import type { AccountRoot, Reserves, Rpc } from "./rpc.js";
import { decimalToUnits, formatUnits, isObj, short, textOfHex } from "./util.js";

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
  me: string;
  /** null in unit tests that don't look up the ledger. */
  rpc: Rpc | null;
  reserves: Reserves | null;
  /** This account as the ledger has it (null = not activated). undefined = unknown. */
  account?: AccountRoot | null;
}

/* ------------------------------------------------------------------ flags (definitions.json) */

export const TF = {
  partialPayment: 0x00020000,
  sellNft: 0x00000001,
  burnable: 0x00000001,
  onlyXrp: 0x00000002,
  transferable: 0x00000008,
  mutable: 0x00000010,
  offerPassive: 0x00010000,
  offerIoc: 0x00020000,
  offerFok: 0x00040000,
  offerSell: 0x00080000,
  setNoRipple: 0x00020000,
  setFreeze: 0x00100000,
  setDeepFreeze: 0x00400000,
} as const;

/** AccountRoot flags (lsf*). */
export const LSF = {
  requireDestTag: 0x00020000,
  disallowXrp: 0x00080000,
  disableMaster: 0x00100000,
  depositAuth: 0x01000000,
} as const;

/** AccountSet SetFlag / ClearFlag values (asf*) → what they do, in words. */
export const ASF: Record<number, { name: string; words: () => string; takeover?: boolean; caution?: boolean }> = {
  1: { name: "asfRequireDest", words: () => say("bg.xrpl.asf.requireDest") },
  2: { name: "asfRequireAuth", words: () => say("bg.xrpl.asf.requireAuth") },
  3: { name: "asfDisallowXRP", words: () => say("bg.xrpl.asf.disallowXrp") },
  4: { name: "asfDisableMaster", words: () => say("bg.xrpl.asf.disableMaster"), takeover: true },
  5: { name: "asfAccountTxnID", words: () => say("bg.xrpl.asf.accountTxnId") },
  6: { name: "asfNoFreeze", words: () => say("bg.xrpl.asf.noFreeze"), caution: true },
  7: { name: "asfGlobalFreeze", words: () => say("bg.xrpl.asf.globalFreeze"), caution: true },
  8: { name: "asfDefaultRipple", words: () => say("bg.xrpl.asf.defaultRipple") },
  9: { name: "asfDepositAuth", words: () => say("bg.xrpl.asf.depositAuth") },
  10: { name: "asfAuthorizedNFTokenMinter", words: () => say("bg.xrpl.asf.nftMinter"), caution: true },
  12: { name: "asfDisallowIncomingNFTokenOffer", words: () => say("bg.xrpl.asf.noNftOffers") },
  13: { name: "asfDisallowIncomingCheck", words: () => say("bg.xrpl.asf.noChecks") },
  14: { name: "asfDisallowIncomingPayChan", words: () => say("bg.xrpl.asf.noPayChannels") },
  15: { name: "asfDisallowIncomingTrustline", words: () => say("bg.xrpl.asf.noTrustLines") },
  16: { name: "asfAllowTrustLineClawback", words: () => say("bg.xrpl.asf.clawback"), caution: true },
  17: { name: "asfAllowTrustLineLocking", words: () => say("bg.xrpl.asf.lockTokens") },
};

/** AccountSet tf* flags: [bit, turns on?, the asf value it stands for]. */
const ACCOUNTSET_TF: [number, boolean, number][] = [
  [0x00010000, true, 1],
  [0x00020000, false, 1],
  [0x00040000, true, 2],
  [0x00080000, false, 2],
  [0x00100000, true, 3],
  [0x00200000, false, 3],
];

/** Seconds between the Unix epoch and the Ripple epoch (2000-01-01T00:00:00Z). */
export const RIPPLE_EPOCH = 946684800;

export function rippleTime(t: unknown): string {
  return typeof t === "number" ? new Date((t + RIPPLE_EPOCH) * 1000).toISOString().replace(".000Z", " UTC").replace("T", " ") : String(t);
}

/* ------------------------------------------------------------------ amounts */

export interface Amt {
  asset: AssetRef;
  /** Base units (drops, or the asset's decimals). */
  units: bigint;
  xrp: boolean;
  /** Issued tokens: the currency and issuer as the ledger writes them. */
  currency?: string;
  issuer?: string;
}

export function amountOf(networkId: NetworkId, v: unknown): Amt | null {
  if (typeof v === "string" && /^\d+$/.test(v)) return { asset: xrpAsset(networkId), units: BigInt(v), xrp: true };
  if (isObj(v) && typeof v.currency === "string" && typeof v.issuer === "string" && typeof v.value === "string") {
    const asset = tokenAsset(networkId, v.currency, v.issuer);
    try {
      return { asset, units: decimalToUnits(v.value, asset.decimals), xrp: false, currency: v.currency, issuer: v.issuer };
    } catch {
      return null;
    }
  }
  return null;
}

export function amountText(a: Amt): string {
  return `${formatUnits(a.units < 0n ? -a.units : a.units, a.asset.decimals)} ${a.asset.symbol}`;
}

const xrpText = (drops: bigint) => `${formatUnits(drops, 6)} XRP`;

function tokenLabel(a: Amt): string {
  return a.xrp ? "XRP" : `${a.asset.symbol} · ${a.issuer}`;
}

const danger = (code: Warning["code"], message: string): Warning => ({ level: "danger", code, message });
const caution = (code: Warning["code"], message: string): Warning => ({ level: "caution", code, message });
const info = (code: Warning["code"], message: string): Warning => ({ level: "info", code, message });

const spamWarning = (a: Amt): Warning[] => (a.asset.spam ? [caution("known-scam", say("bg.warn.spamToken", { symbol: a.asset.symbol }))] : []);

function memoLines(tx: Record<string, unknown>): Line[] {
  if (!Array.isArray(tx.Memos)) return [];
  const out: Line[] = [];
  for (const m of tx.Memos) {
    const memo = isObj(m) && isObj(m.Memo) ? m.Memo : null;
    if (!memo) continue;
    const data = typeof memo.MemoData === "string" ? memo.MemoData : "";
    const text = textOfHex(data);
    if (text !== null) out.push({ label: "Memo", value: text.length > 200 ? `${text.slice(0, 197)}…` : text });
    else if (data) out.push({ label: "Data", value: `0x${data.slice(0, 64).toLowerCase()}${data.length > 64 ? "…" : ""}` });
  }
  return out;
}

/* ------------------------------------------------------------------ the transaction */

const CHANGES = (...c: (BalanceChange | null)[]) => c.filter((x): x is BalanceChange => !!x);
const change = (a: Amt | null, sign: 1n | -1n): BalanceChange | null => (a && a.units !== 0n ? { asset: a.asset, delta: (a.units * sign).toString() } : null);

/** Reads what this transaction does. `blind` when it's a type Clip Wallet can't explain. */
export async function describeTx(tx: Record<string, unknown>, dc: DescribeContext): Promise<Described> {
  const type = String(tx.TransactionType);
  const flags = typeof tx.Flags === "number" ? tx.Flags : 0;
  const lines: Line[] = [];
  const warnings: Warning[] = [];
  let changes: BalanceChange[] = [];
  let title: string;
  const amt = (v: unknown) => amountOf(dc.networkId, v);

  switch (type) {
    case "Payment": {
      const a = amt(tx.Amount);
      const dest = String(tx.Destination);
      if (!a) return blindOf(tx);
      const sendMax = tx.SendMax !== undefined ? amt(tx.SendMax) : null;
      const deliverMin = tx.DeliverMin !== undefined ? amt(tx.DeliverMin) : null;
      const partial = (flags & TF.partialPayment) !== 0;
      const cross = sendMax && sendMax.asset.key !== a.asset.key;
      lines.push({ label: "To", value: dest });
      if (tx.DestinationTag !== undefined) lines.push({ label: say("bg.xrpl.label.destinationTag"), value: String(tx.DestinationTag) });
      if (!a.xrp) lines.push({ label: "Token", value: tokenLabel(a) });
      if (cross && sendMax) {
        title = say("bg.xrpl.payUpTo", { amount: amountText(sendMax), to: short(dest), get: amountText(a) });
        lines.push({ label: "You pay", value: say("bg.xrpl.atMost", { amount: amountText(sendMax) }) });
      } else {
        title = say("bg.req.sendTo", { amount: amountText(a), to: short(dest) });
      }
      if (partial) {
        lines.push({ label: say("bg.xrpl.label.deliversAtLeast"), value: deliverMin ? amountText(deliverMin) : say("bg.xrpl.anyAmount") });
        warnings.push(danger("simulation-failed", say("bg.xrpl.partialPayment", { amount: amountText(a) })));
      }
      const out = cross || partial ? (sendMax ?? a) : a;
      if (dest !== dc.me) changes = CHANGES(change(out, -1n));
      else if (!cross && !partial && a.xrp) warnings.push(danger("simulation-failed", say("bg.xrpl.xrpToSelf")));
      warnings.push(...spamWarning(a));
      if (dest !== dc.me) warnings.push(...(await destinationWarnings(dest, a, tx.DestinationTag !== undefined, dc)));
      break;
    }
    case "TrustSet": {
      const limit = isObj(tx.LimitAmount) ? amt(tx.LimitAmount) : null;
      if (!limit || limit.xrp) return blindOf(tx);
      lines.push({ label: "Token", value: limit.asset.symbol }, { label: say("bg.xrpl.label.issuer"), value: String(limit.issuer) });
      if (limit.units === 0n) {
        title = say("bg.req.removeFromYourAccount", { symbol: limit.asset.symbol });
        lines.push({ label: "Also", value: say("bg.xrpl.frees", { amount: dc.reserves ? xrpText(dc.reserves.inc) : "0.2 XRP" }) });
      } else {
        title = say("bg.req.addToYourAccount", { symbol: limit.asset.symbol });
        lines.push({ label: "Limit", value: amountText(limit) });
        lines.push({ label: "Locks", value: say("bg.xrpl.locksReserve", { amount: dc.reserves ? xrpText(dc.reserves.inc) : "0.2 XRP" }) });
        warnings.push(...spamWarning(limit));
      }
      if (flags & (TF.setFreeze | TF.setDeepFreeze)) warnings.push(caution("unknown-call", say("bg.xrpl.freezesLine")));
      break;
    }
    case "OfferCreate": {
      const give = amt(tx.TakerGets);
      const get = amt(tx.TakerPays);
      if (!give || !get) return blindOf(tx);
      title = say("bg.req.trade", { give: amountText(give), get: amountText(get) });
      lines.push({ label: "You pay", value: say("bg.xrpl.atMost", { amount: amountText(give) }) }, { label: "You get", value: amountText(get) });
      if (tx.OfferSequence !== undefined) lines.push({ label: say("bg.xrpl.label.replacesOffer"), value: `#${tx.OfferSequence}` });
      if (tx.Expiration !== undefined) lines.push({ label: "Expires", value: rippleTime(tx.Expiration) });
      const kind = flags & TF.offerFok ? say("bg.xrpl.offer.fillOrKill") : flags & TF.offerIoc ? say("bg.xrpl.offer.immediate") : say("bg.xrpl.offer.standing");
      lines.push({ label: "Kind", value: kind });
      changes = CHANGES(change(give, -1n), change(get, 1n));
      warnings.push(...spamWarning(give), ...spamWarning(get));
      break;
    }
    case "OfferCancel":
      title = say("bg.xrpl.cancelOffer");
      lines.push({ label: "Offer", value: `#${String(tx.OfferSequence)}` });
      break;
    case "AccountSet": {
      title = say("bg.xrpl.changeSettings");
      for (const [key, label] of [
        ["SetFlag", say("bg.xrpl.label.turnsOn")],
        ["ClearFlag", say("bg.xrpl.label.turnsOff")],
      ] as const) {
        const v = tx[key];
        if (typeof v !== "number") continue;
        const def = ASF[v];
        if (!def) return blindOf(tx);
        lines.push({ label, value: def.words() });
        if (key === "SetFlag" && def.takeover) warnings.push(danger("account-takeover", say("bg.xrpl.disableMasterWarning")));
        if (key === "SetFlag" && def.caution) warnings.push(caution("unknown-call", say("bg.xrpl.issuerSettingWarning")));
      }
      if (typeof tx.Domain === "string") lines.push({ label: say("bg.xrpl.label.domain"), value: textOfHex(tx.Domain) ?? (tx.Domain ? `0x${tx.Domain}` : say("bg.xrpl.cleared")) });
      if (tx.TransferRate !== undefined) {
        const r = Number(tx.TransferRate);
        lines.push({ label: say("bg.xrpl.label.transferFee"), value: r === 0 || r === 1e9 ? "0%" : `${((r - 1e9) / 1e7).toFixed(4).replace(/\.?0+$/, "")}%` });
      }
      if (typeof tx.NFTokenMinter === "string") {
        lines.push({ label: say("bg.xrpl.label.nftMinter"), value: tx.NFTokenMinter });
        warnings.push(caution("account-takeover", say("bg.xrpl.nftMinterWarning", { who: short(tx.NFTokenMinter) })));
      }
      if (typeof tx.MessageKey === "string") lines.push({ label: "Key", value: tx.MessageKey ? `0x${tx.MessageKey.slice(0, 16)}…` : say("bg.xrpl.cleared") });
      if (tx.TickSize !== undefined) lines.push({ label: "Details", value: `TickSize ${tx.TickSize}` });
      // Legacy AccountSet transaction flags (tfRequireDestTag … tfAllowXRP) do the same as SetFlag/ClearFlag 1–3.
      for (const [bit, on, asf] of ACCOUNTSET_TF) {
        if (!(flags & bit)) continue;
        lines.push({ label: on ? say("bg.xrpl.label.turnsOn") : say("bg.xrpl.label.turnsOff"), value: ASF[asf]!.words() });
      }
      if (flags & ~ACCOUNTSET_TF.reduce((m, [b]) => m | b, 0x80000000) & 0xffffffff) return blindOf(tx);
      break;
    }
    case "SetRegularKey":
      if (typeof tx.RegularKey === "string") {
        title = say("bg.req.giveControl", { who: short(tx.RegularKey) });
        lines.push({ label: "Key", value: tx.RegularKey });
        warnings.push(danger("account-takeover", say("bg.xrpl.regularKeyWarning", { who: short(tx.RegularKey) })));
      } else {
        title = say("bg.xrpl.removeRegularKey");
      }
      break;
    case "SignerListSet": {
      const entries = Array.isArray(tx.SignerEntries) ? tx.SignerEntries.map((e) => (isObj(e) && isObj(e.SignerEntry) ? e.SignerEntry : {})) : [];
      if (!tx.SignerQuorum) {
        title = say("bg.xrpl.removeSigners");
        break;
      }
      title = say("bg.xrpl.setSigners", { count: entries.length });
      for (const e of entries) lines.push({ label: "Account", value: `${String(e.Account)} (${String(e.SignerWeight)})` });
      lines.push({ label: say("bg.xrpl.label.quorum"), value: String(tx.SignerQuorum) });
      warnings.push(danger("account-takeover", say("bg.xrpl.signersWarning")));
      break;
    }
    case "AccountDelete": {
      const dest = String(tx.Destination);
      title = say("bg.xrpl.closeAccount", { to: short(dest) });
      lines.push({ label: "To", value: dest });
      if (tx.DestinationTag !== undefined) lines.push({ label: say("bg.xrpl.label.destinationTag"), value: String(tx.DestinationTag) });
      const fee = BigInt(typeof tx.Fee === "string" && /^\d+$/.test(tx.Fee) ? tx.Fee : "0");
      warnings.push(danger("account-closure", say("bg.xrpl.closeWarning", { to: short(dest), fee: xrpText(fee) })));
      if (dc.account) {
        const left = BigInt(dc.account.Balance) - fee;
        if (left > 0n) changes = [{ asset: xrpAsset(dc.networkId), delta: (-left).toString() }];
      }
      warnings.push(...(await destinationWarnings(dest, null, tx.DestinationTag !== undefined, dc)));
      break;
    }
    case "NFTokenMint": {
      title = say("bg.xrpl.mintNft");
      const uri = typeof tx.URI === "string" ? (textOfHex(tx.URI) ?? `0x${tx.URI}`) : null;
      if (uri) lines.push({ label: say("bg.xrpl.label.link"), value: uri });
      lines.push({ label: "Collection", value: say("bg.xrpl.taxon", { taxon: String(tx.NFTokenTaxon ?? 0) }) });
      if (tx.TransferFee !== undefined) lines.push({ label: say("bg.xrpl.label.royalty"), value: `${Number(tx.TransferFee) / 1000}%` });
      const props = [
        flags & TF.transferable ? say("bg.xrpl.nft.transferable") : say("bg.xrpl.nft.notTransferable"),
        ...(flags & TF.burnable ? [say("bg.xrpl.nft.issuerCanBurn")] : []),
        ...(flags & TF.mutable ? [say("bg.xrpl.nft.mutable")] : []),
      ];
      lines.push({ label: "Details", value: props.join("; ") });
      if (typeof tx.Issuer === "string" && tx.Issuer !== dc.me) lines.push({ label: say("bg.xrpl.label.issuer"), value: tx.Issuer });
      if (tx.Amount !== undefined) {
        const a = amt(tx.Amount);
        if (!a) return blindOf(tx);
        lines.push({ label: "Offer", value: amountText(a) });
      }
      break;
    }
    case "NFTokenBurn":
      title = say("bg.xrpl.burnNft");
      lines.push({ label: "NFT", value: String(tx.NFTokenID) });
      if (typeof tx.Owner === "string" && tx.Owner !== dc.me) lines.push({ label: "Owner", value: tx.Owner });
      warnings.push(caution("unknown-call", say("bg.warn.burnForGood")));
      break;
    case "NFTokenCreateOffer": {
      const a = amt(tx.Amount);
      if (!a) return blindOf(tx);
      const nft = String(tx.NFTokenID);
      lines.push({ label: "NFT", value: nft });
      if (flags & TF.sellNft) {
        if (a.units === 0n) {
          title = typeof tx.Destination === "string" ? say("bg.xrpl.giveNft", { to: short(tx.Destination) }) : say("bg.xrpl.sellNft", { amount: amountText(a) });
          if (typeof tx.Destination !== "string") warnings.push(danger("new-recipient", say("bg.xrpl.freeForAnyone")));
        } else {
          title = say("bg.xrpl.sellNft", { amount: amountText(a) });
        }
        if (typeof tx.Destination === "string") lines.push({ label: "To", value: tx.Destination });
      } else {
        title = say("bg.xrpl.buyNft", { amount: amountText(a) });
        if (typeof tx.Owner === "string") lines.push({ label: "Owner", value: tx.Owner });
        lines.push({ label: "Locks", value: say("bg.xrpl.offerHolds") });
      }
      if (tx.Expiration !== undefined) lines.push({ label: "Expires", value: rippleTime(tx.Expiration) });
      warnings.push(...spamWarning(a));
      break;
    }
    case "NFTokenAcceptOffer": {
      const ids = [tx.NFTokenSellOffer, tx.NFTokenBuyOffer].filter((x): x is string => typeof x === "string");
      title = say("bg.xrpl.acceptNftOffer");
      if (ids.length === 2) {
        lines.push({ label: "Details", value: say("bg.xrpl.brokered") });
        if (tx.NFTokenBrokerFee !== undefined) {
          const fee = amt(tx.NFTokenBrokerFee);
          if (fee) lines.push({ label: "You get", value: amountText(fee) });
        }
        break;
      }
      const offer = dc.rpc && ids[0] ? await nftOffer(dc.rpc, ids[0]) : null;
      if (!offer) {
        lines.push({ label: "Offer", value: ids[0] ?? "?" });
        warnings.push(caution("simulation-failed", say("bg.xrpl.offerUnknown")));
        break;
      }
      const a = amt(offer.Amount);
      if (!a) return blindOf(tx);
      lines.push({ label: "NFT", value: offer.NFTokenID }, { label: "From", value: offer.Owner });
      if (typeof tx.NFTokenSellOffer === "string") {
        title = say("bg.xrpl.acceptNftSell", { amount: amountText(a) });
        changes = CHANGES(change(a, -1n));
      } else {
        title = say("bg.xrpl.acceptNftBuy", { amount: amountText(a) });
        changes = CHANGES(change(a, 1n));
      }
      warnings.push(...spamWarning(a));
      break;
    }
    case "NFTokenCancelOffer": {
      const offers = Array.isArray(tx.NFTokenOffers) ? tx.NFTokenOffers : [];
      title = say("bg.xrpl.cancelNftOffers", { count: offers.length });
      break;
    }
    case "EscrowCreate": {
      const a = amt(tx.Amount);
      if (!a) return blindOf(tx);
      const dest = String(tx.Destination);
      title = say("bg.xrpl.escrowCreate", { amount: amountText(a), to: short(dest) });
      lines.push({ label: "To", value: dest });
      if (tx.FinishAfter !== undefined) lines.push({ label: say("bg.xrpl.label.releaseAfter"), value: rippleTime(tx.FinishAfter) });
      if (tx.CancelAfter !== undefined) lines.push({ label: say("bg.xrpl.label.cancelAfter"), value: rippleTime(tx.CancelAfter) });
      if (tx.Condition !== undefined) lines.push({ label: "Details", value: say("bg.xrpl.escrowCondition") });
      warnings.push(caution("durable-nonce", say("bg.xrpl.escrowLocked")));
      if (dest !== dc.me) changes = CHANGES(change(a, -1n));
      break;
    }
    case "EscrowFinish":
    case "EscrowCancel":
      title = say(type === "EscrowFinish" ? "bg.xrpl.escrowFinish" : "bg.xrpl.escrowCancel");
      lines.push({ label: "Owner", value: String(tx.Owner) }, { label: "Details", value: `#${String(tx.OfferSequence)}` });
      break;
    case "AMMDeposit":
    case "AMMWithdraw": {
      const pool = [tx.Asset, tx.Asset2].map((x) => (isObj(x) ? (x.currency === "XRP" ? "XRP" : currencyName(String(x.currency))) : "?")).join(" / ");
      const a = tx.Amount !== undefined ? amt(tx.Amount) : null;
      const b = tx.Amount2 !== undefined ? amt(tx.Amount2) : null;
      if ((tx.Amount !== undefined && !a) || (tx.Amount2 !== undefined && !b)) return blindOf(tx);
      lines.push({ label: "Pool", value: pool });
      if (type === "AMMDeposit") {
        title = say("bg.xrpl.ammDeposit");
        for (const x of [a, b]) if (x) lines.push({ label: "You pay", value: say("bg.xrpl.atMost", { amount: amountText(x) }) });
        changes = CHANGES(change(a, -1n), change(b, -1n));
      } else {
        title = say("bg.xrpl.ammWithdraw");
        for (const x of [a, b]) if (x) lines.push({ label: "You get", value: amountText(x) });
        if (!a && !b) lines.push({ label: "You get", value: say("bg.xrpl.yourShare") });
      }
      warnings.push(caution("simulation-failed", say("bg.xrpl.poolAmounts")));
      break;
    }
    default:
      return blindOf(tx);
  }

  lines.push(...memoLines(tx));
  if (typeof tx.SourceTag === "number") lines.push({ label: say("bg.xrpl.label.sourceTag"), value: String(tx.SourceTag) });
  return { title, lines, balanceChanges: changes, warnings, blind: false };
}

export function blindOf(tx: Record<string, unknown>): Described {
  return {
    title: say("bg.xrpl.unknownTx", { type: String(tx.TransactionType) }),
    lines: [{ label: "Type", value: String(tx.TransactionType) }, ...memoLines(tx)],
    balanceChanges: [],
    warnings: [{ level: "danger", code: "blind-signing", message: "Clip Wallet can't read this transaction. Only sign it if you trust the app." }],
    blind: true,
  };
}

async function nftOffer(rpc: Rpc, index: string): Promise<{ Amount: unknown; NFTokenID: string; Owner: string; Flags: number } | null> {
  try {
    const r = await rpc.call<{ node?: { LedgerEntryType?: string; Amount: unknown; NFTokenID: string; Owner: string; Flags: number } }>("ledger_entry", { index, ledger_index: "validated" });
    return r.node?.LedgerEntryType === "NFTokenOffer" ? r.node : null;
  } catch {
    return null;
  }
}

/** What the ledger knows about the recipient: not activated, needs a tag, refuses XRP, has no trust line. */
async function destinationWarnings(dest: string, a: Amt | null, hasTag: boolean, dc: DescribeContext): Promise<Warning[]> {
  if (!dc.rpc) return [];
  const out: Warning[] = [];
  let acct: AccountRoot | null;
  try {
    acct = await dc.rpc.accountInfo(dest);
  } catch {
    return [caution("simulation-failed", say("bg.xrpl.recipientUnchecked"))];
  }
  const base = dc.reserves ? xrpText(dc.reserves.base) : "1 XRP";
  if (!acct) {
    if (a && a.xrp && dc.reserves && a.units < dc.reserves.base) out.push(danger("simulation-failed", say("bg.xrpl.newAccountTooSmall", { reserve: base })));
    else if (a && a.xrp) out.push(info("new-recipient", say("bg.xrpl.opensAccount", { reserve: base })));
    else out.push(danger("simulation-failed", say("bg.xrpl.noRecipientAccount")));
    return out;
  }
  if (acct.Flags & LSF.requireDestTag && !hasTag) out.push(danger("memo-required", say("bg.xrpl.destinationTagNeeded")));
  if (a?.xrp && acct.Flags & LSF.disallowXrp) out.push(caution("new-recipient", say("bg.xrpl.disallowsXrp")));
  if (acct.Flags & LSF.depositAuth) out.push(caution("simulation-failed", say("bg.xrpl.depositAuth")));
  if (a && !a.xrp && a.issuer !== dest) {
    try {
      const lines = await dc.rpc.lines(dest, a.issuer);
      const want = (a.currency ?? "").toUpperCase();
      if (!lines.some((l) => l.currency.toUpperCase() === want && l.account === a.issuer)) out.push(danger("simulation-failed", say("bg.xrpl.noTrustLine", { symbol: a.asset.symbol })));
    } catch {
      /* unknown: no warning beyond the network's own answer */
    }
  }
  return out;
}
