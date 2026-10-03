import { type AssetRef, type ChainContext, ClipError, type DappRequest } from "@clip-wallet/core";
import { isAccountId, isEvmAddress, longZeroToAccountId, stripChecksum } from "./address.js";
import { accountIdString, compareAccountIds, compareEntityIds, dateTimestamp, parseAccountId, parseEntityId } from "./ids.js";
import { Mirror } from "./mirror.js";
import { ledgerOf, mirrorUrl } from "./networks.js";
import {
  type AccountIdP,
  BODY,
  type EntityIdP,
  type TokenTransferListIn,
  encodeApproveAllowance,
  encodeAssociate,
  encodeContractCall,
  encodeCryptoTransfer,
  encodeCryptoUpdate,
  encodeSchedulableBody,
  encodeScheduleCreate,
  encodeScheduleSign,
} from "./proto/hapi.js";
import { type TxDraft, type TxInput, defaultMaxFee, freezeInput } from "./tx.js";
import { b64encode, randomId } from "./util.js";

/** Internal-only method: sign a transaction and hand back the signed bytes without submitting (Secure Trade). */
export const SIGN_TRANSACTION_BYTES = "clip_hedera_signTransactionBytes";

export function mirrorFor(ctx: ChainContext): Mirror {
  return new Mirror(mirrorUrl(ctx.network), ctx.fetch);
}

/** The user's 0.0.x. Throws a plain-language error while the alias hasn't been auto-created yet (HIP-583). */
export async function resolvePayer(ctx: ChainContext, mirror = mirrorFor(ctx)): Promise<string> {
  if (ctx.account.hederaAccountId) return ctx.account.hederaAccountId;
  const acct = await mirror.account(ctx.account.address);
  if (acct) return acct.account;
  throw new ClipError(
    "Your Hedera account opens when it first receives HBAR. Receive some HBAR first, then try again.",
    "hedera/account-not-created",
  );
}

/** Accepts 0.0.x (with or without checksum) or a 0x address. Existing aliases resolve to their 0.0.x. */
export async function resolveRecipient(to: string, mirror: Mirror): Promise<AccountIdP> {
  const v = to.trim();
  if (isAccountId(v)) return parseAccountId(stripChecksum(v));
  if (isEvmAddress(v)) {
    const longZero = longZeroToAccountId(v);
    if (longZero) return parseAccountId(longZero);
    const acct = await mirror.account(v.toLowerCase()).catch(() => null);
    if (acct) return parseAccountId(acct.account);
    return parseAccountId(v.toLowerCase()); // HIP-583: first transfer creates the account
  }
  throw new ClipError("That doesn't look like a Hedera address. It should look like 0.0.1234 or 0x…", "hedera/bad-address");
}

/**
 * Freezes a new transaction for `payer`: a fresh transaction id and NODES_PER_TRANSACTION random nodes of the
 * network. Takes a draft from the helpers below, unfrozen transaction bytes, or (for older callers) an unfrozen
 * Hiero SDK transaction, which is read through its own `toBytes()`. Returns TransactionList bytes.
 */
export function freezeNew(tx: TxInput, payer: string, ctx: ChainContext): Uint8Array {
  return freezeInput(tx, { payer, ledger: ledgerOf(ctx.network.id) });
}

export function requestFor(
  tx: Uint8Array,
  payer: string,
  ctx: ChainContext,
  method: string = "hedera_signAndExecuteTransaction",
): DappRequest {
  return {
    id: randomId(),
    origin: "clip-wallet",
    via: "injected",
    family: "hedera",
    networkId: ctx.network.id,
    method,
    params: { signerAccountId: `${ctx.network.id}:${payer}`, transactionList: b64encode(tx) },
  };
}

function parseAmount(amount: string): bigint {
  if (!/^\d+$/.test(amount)) throw new ClipError("Enter an amount greater than zero.", "hedera/bad-amount");
  const v = BigInt(amount);
  if (v <= 0n) throw new ClipError("Enter an amount greater than zero.", "hedera/bad-amount");
  return v;
}

const acct = (a: string | AccountIdP): AccountIdP => (typeof a === "string" ? parseAccountId(a) : a);

/* ------------------------------------------------------------------ drafts (the transaction bodies the wallet builds) */

/**
 * A CryptoTransfer under construction, mirroring the SDK's TransferTransaction: repeated legs for the same
 * account (and token) are summed, and the lists are sorted and grouped exactly like
 * AbstractTokenTransferTransaction._makeTransactionData, so the encoded body matches the SDK byte for byte.
 */
export class TransferDraft {
  private hbar: { accountId: AccountIdP; amount: bigint; isApproval: boolean }[] = [];
  private tokens: { tokenId: EntityIdP; accountId: AccountIdP; amount: bigint; isApproval: boolean; expectedDecimals: number | null }[] = [];
  private nfts: { tokenId: EntityIdP; sender: AccountIdP; receiver: AccountIdP; serial: bigint; isApproval: boolean }[] = [];
  memo = "";
  validDuration?: number;
  maxFee?: bigint;

  addHbar(account: string | AccountIdP, tinybars: bigint, isApproval = false): this {
    const a = acct(account);
    const same = this.hbar.find((t) => compareAccountIds(t.accountId, a) === 0);
    if (same) same.amount += tinybars;
    else this.hbar.push({ accountId: a, amount: tinybars, isApproval });
    return this;
  }

  addToken(tokenId: string, account: string | AccountIdP, amount: bigint, decimals: number | null = null, isApproval = false): this {
    const t = parseEntityId(tokenId);
    const a = acct(account);
    const same = this.tokens.find((x) => compareEntityIds(x.tokenId, t) === 0 && compareAccountIds(x.accountId, a) === 0);
    if (same) {
      same.amount += amount;
      same.expectedDecimals = decimals;
    } else this.tokens.push({ tokenId: t, accountId: a, amount, isApproval, expectedDecimals: decimals });
    return this;
  }

  addNft(tokenId: string, serial: bigint | number, sender: string | AccountIdP, receiver: string | AccountIdP, isApproval = false): this {
    this.nfts.push({ tokenId: parseEntityId(tokenId), sender: acct(sender), receiver: acct(receiver), serial: BigInt(serial), isApproval });
    return this;
  }

  /** CryptoTransferTransactionBody bytes. */
  encode(): Uint8Array {
    this.hbar.sort((a, b) => compareAccountIds(a.accountId, b.accountId));
    this.tokens.sort((a, b) => compareEntityIds(a.tokenId, b.tokenId) || compareAccountIds(a.accountId, b.accountId));
    this.nfts.sort((a, b) => compareAccountIds(a.sender, b.sender) || compareAccountIds(a.receiver, b.receiver) || (a.serial < b.serial ? -1 : a.serial > b.serial ? 1 : 0));

    // The SDK's merge of fungible and NFT legs into per-token lists (same walk, same order).
    const lists: TokenTransferListIn[] = [];
    const tokenLeg = (t: (typeof this.tokens)[number]) => ({ accountId: t.accountId, amount: t.amount, isApproval: t.isApproval });
    const nftLeg = (n: (typeof this.nfts)[number]) => ({ sender: n.sender, receiver: n.receiver, serial: n.serial, isApproval: n.isApproval });
    let i = 0;
    let j = 0;
    while (i < this.tokens.length || j < this.nfts.length) {
      if (i < this.tokens.length && j < this.nfts.length) {
        const ti = this.tokens[i]!;
        const nj = this.nfts[j]!;
        const last = lists[lists.length - 1];
        if (last && compareEntityIds(last.token, ti.tokenId) === 0) {
          last.transfers.push(tokenLeg(this.tokens[i++]!));
          continue;
        }
        if (last && compareEntityIds(last.token, nj.tokenId) === 0) {
          last.nfts.push(nftLeg(this.nfts[j++]!));
          continue;
        }
        const c = compareEntityIds(ti.tokenId, nj.tokenId);
        if (c === 0) lists.push({ token: ti.tokenId, expectedDecimals: ti.expectedDecimals, transfers: [tokenLeg(this.tokens[i++]!)], nfts: [nftLeg(this.nfts[j++]!)] });
        else if (c < 0) lists.push({ token: ti.tokenId, expectedDecimals: ti.expectedDecimals, transfers: [tokenLeg(this.tokens[i++]!)], nfts: [] });
        else lists.push({ token: nj.tokenId, expectedDecimals: null, transfers: [], nfts: [nftLeg(this.nfts[j++]!)] });
      } else if (i < this.tokens.length) {
        const ti = this.tokens[i]!;
        const last = [...lists].reverse().find((l) => compareEntityIds(l.token, ti.tokenId) === 0);
        if (last) {
          last.transfers.push(tokenLeg(this.tokens[i++]!));
          continue;
        }
        lists.push({ token: ti.tokenId, expectedDecimals: ti.expectedDecimals, transfers: [tokenLeg(this.tokens[i++]!)], nfts: [] });
      } else {
        const nj = this.nfts[j]!;
        const last = [...lists].reverse().find((l) => compareEntityIds(l.token, nj.tokenId) === 0);
        if (last) {
          last.nfts.push(nftLeg(this.nfts[j++]!));
          continue;
        }
        lists.push({ token: nj.tokenId, expectedDecimals: null, transfers: [], nfts: [nftLeg(this.nfts[j++]!)] });
      }
    }
    return encodeCryptoTransfer({ hbar: this.hbar, tokens: lists });
  }

  draft(): TxDraft {
    const d: TxDraft = { kind: BODY.cryptoTransfer, data: this.encode(), memo: this.memo };
    if (this.validDuration != null) d.validDuration = this.validDuration;
    if (this.maxFee != null) d.maxFee = this.maxFee;
    return d;
  }
}

export function associateDraft(account: string, tokenIds: string[], dissociate = false): TxDraft {
  return {
    kind: dissociate ? BODY.tokenDissociate : BODY.tokenAssociate,
    data: encodeAssociate({ account: parseAccountId(account), tokens: tokenIds.map(parseEntityId) }),
  };
}

/** ContractExecuteTransaction: gas, optional payable HBAR (tinybars), ABI-encoded call data. */
export function contractCallDraft(p: { contractId: string; gas: number | bigint; functionParameters?: Uint8Array; payableTinybars?: bigint | string | number }): TxDraft {
  return {
    kind: BODY.contractCall,
    data: encodeContractCall({
      contractId: parseEntityId(p.contractId),
      gas: BigInt(p.gas),
      amount: p.payableTinybars != null ? BigInt(p.payableTinybars) : null,
      params: p.functionParameters ?? null,
    }),
  };
}

/** AccountAllowanceApproveTransaction with one fungible-token allowance (HIP-336). */
export function tokenAllowanceDraft(p: { tokenId: string; owner: string; spender: string; amount: bigint | string | number }): TxDraft {
  return {
    kind: BODY.cryptoApproveAllowance,
    data: encodeApproveAllowance({ token: [{ tokenId: parseEntityId(p.tokenId), owner: parseAccountId(p.owner), spender: parseAccountId(p.spender), amount: BigInt(p.amount) }] }),
  };
}

/** AccountAllowanceApproveTransaction with one HBAR allowance. */
export function hbarAllowanceDraft(p: { owner: string; spender: string; tinybars: bigint | string | number }): TxDraft {
  return {
    kind: BODY.cryptoApproveAllowance,
    data: encodeApproveAllowance({ hbar: [{ owner: parseAccountId(p.owner), spender: parseAccountId(p.spender), amount: BigInt(p.tinybars) }] }),
  };
}

/**
 * AccountAllowanceApproveTransaction with several allowances at once (HIP-336): HBAR and fungible-token
 * allowances by amount, NFT "all serials" allowances by switch. Revoking = amount 0 / approvedForAll false.
 */
export function approveAllowanceDraft(p: {
  owner: string;
  hbar?: { spender: string; tinybars: bigint | string | number }[];
  token?: { tokenId: string; spender: string; amount: bigint | string | number }[];
  nftAll?: { tokenId: string; spender: string; approved: boolean }[];
}): TxDraft {
  const owner = parseAccountId(p.owner);
  return {
    kind: BODY.cryptoApproveAllowance,
    data: encodeApproveAllowance({
      hbar: (p.hbar ?? []).map((a) => ({ owner, spender: parseAccountId(a.spender), amount: BigInt(a.tinybars) })),
      token: (p.token ?? []).map((a) => ({ tokenId: parseEntityId(a.tokenId), owner, spender: parseAccountId(a.spender), amount: BigInt(a.amount) })),
      nft: (p.nftAll ?? []).map((a) => ({ tokenId: parseEntityId(a.tokenId), owner, spender: parseAccountId(a.spender), approvedForAll: a.approved })),
    }),
  };
}

/* ------------------------------------------------------------------ builders */

/** HBAR (asset.address absent) or an HTS fungible token (asset.address = token id). `amount` in base units. */
export async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
  const mirror = mirrorFor(ctx);
  const payer = await resolvePayer(ctx, mirror);
  const to = await resolveRecipient(p.to, mirror);
  if (accountIdString(to) === payer) throw new ClipError("That's your own account.", "hedera/self-transfer");
  const amount = parseAmount(p.amount);
  const tx = new TransferDraft();
  if (!p.asset.address) tx.addHbar(payer, -amount).addHbar(to, amount);
  else tx.addToken(p.asset.address, payer, -amount, p.asset.decimals).addToken(p.asset.address, to, amount, p.asset.decimals);
  return requestFor(freezeNew(tx.draft(), payer, ctx), payer, ctx);
}

export async function buildNftTransfer(p: { tokenId: string; serial: string | number; to: string }, ctx: ChainContext): Promise<DappRequest> {
  const mirror = mirrorFor(ctx);
  const payer = await resolvePayer(ctx, mirror);
  const to = await resolveRecipient(p.to, mirror);
  const tx = new TransferDraft().addNft(p.tokenId, BigInt(p.serial), payer, to);
  return requestFor(freezeNew(tx.draft(), payer, ctx), payer, ctx);
}

/** "Add the SAUCE token to your account." */
export async function buildAssociate(tokenIds: string | string[], ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  return requestFor(freezeNew(associateDraft(payer, [tokenIds].flat()), payer, ctx), payer, ctx);
}

/** "Remove the SAUCE token from your account." The balance must be zero first. */
export async function buildDissociate(tokenIds: string | string[], ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  return requestFor(freezeNew(associateDraft(payer, [tokenIds].flat(), true), payer, ctx), payer, ctx);
}

export type StakeTarget = { nodeId: number } | { accountId: string } | { stop: true };

/**
 * Native staking (HIP-406): the HBAR never leaves the account; rewards accrue to it.
 * `declineReward` keeps staking but turns rewards off.
 */
export async function buildStakeUpdate(target: StakeTarget, ctx: ChainContext, declineReward?: boolean): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  const data = encodeCryptoUpdate({
    account: parseAccountId(payer),
    stakedAccount: "accountId" in target ? parseAccountId(stripChecksum(target.accountId)) : null,
    stakedNode: "nodeId" in target ? BigInt(target.nodeId) : "stop" in target ? -1n : null, // -1 clears staking (SDK clearStakedNodeId)
    declineReward: declineReward ?? null,
  });
  return requestFor(freezeNew({ kind: BODY.cryptoUpdateAccount, data }, payer, ctx), payer, ctx);
}

export type SwapLeg =
  | { asset: AssetRef; amount: string } // HBAR when asset.address is absent, else an HTS token id
  | { nft: { tokenId: string; serial: string | number } };

export interface AtomicSwapOptions {
  give: SwapLeg;
  get: SwapLeg;
  counterparty: string;
  /**
   * Wrap in a ScheduleCreate so the counterparty can approve later (ScheduleSign) instead of within the
   * transaction's 3-minute validity window. `expiresAt` needs long-term schedules (HIP-423); without it the
   * network's default schedule lifetime applies.
   */
  schedule?: { expiresAt?: Date; memo?: string };
  memo?: string;
}

function addLeg(tx: TransferDraft, leg: SwapLeg, from: AccountIdP | string, to: AccountIdP | string) {
  if ("nft" in leg) {
    tx.addNft(leg.nft.tokenId, BigInt(leg.nft.serial), from, to);
  } else if (!leg.asset.address) {
    const v = parseAmount(leg.amount);
    tx.addHbar(from, -v).addHbar(to, v);
  } else {
    const v = parseAmount(leg.amount);
    tx.addToken(leg.asset.address, from, -v, leg.asset.decimals).addToken(leg.asset.address, to, v, leg.asset.decimals);
  }
}

/**
 * Secure Trade: ONE TransferTransaction moving both legs, so either both happen or neither does.
 * Both parties' keys must sign it. Two flows:
 *
 *  1. Direct (no `schedule`): returns a `clip_hedera_signTransactionBytes` request. After approval, finalize()
 *     returns `{ transactionList }` — the transaction signed by this wallet. Hand those bytes to the
 *     counterparty (link/QR/relay); their wallet shows both legs and runs `hedera_signAndExecuteTransaction`,
 *     adding their signature and submitting. Must complete within the transaction's validity window (≤180 s).
 *  2. Scheduled (`schedule` set): returns a `hedera_signAndExecuteTransaction` request for a ScheduleCreate
 *     wrapping the transfer. Our signature on the ScheduleCreate counts toward the inner transfer. The receipt
 *     carries the schedule id; the counterparty approves with `buildScheduleSign(scheduleId)` (their wallet
 *     shows the inner transfer, read from the mirror node). The network runs the transfer the moment the last
 *     required signature arrives, or drops it at expiry.
 */
export async function buildAtomicSwap(opts: AtomicSwapOptions, ctx: ChainContext): Promise<DappRequest> {
  const mirror = mirrorFor(ctx);
  const me = await resolvePayer(ctx, mirror);
  const other = await resolveRecipient(opts.counterparty, mirror);
  if (accountIdString(other) === me) throw new ClipError("You can't trade with yourself.", "hedera/self-trade");
  const transfer = new TransferDraft();
  addLeg(transfer, opts.give, me, other);
  addLeg(transfer, opts.get, other, me);
  if (opts.memo) transfer.memo = opts.memo;

  if (!opts.schedule) {
    transfer.validDuration = 180;
    return requestFor(freezeNew(transfer.draft(), me, ctx), me, ctx, SIGN_TRANSACTION_BYTES);
  }
  // The SDK's ScheduleCreateTransaction: the inner body carries the transfer's own max fee (its type default,
  // 1 HBAR) and memo; the schedule memo, expiry and wait_for_expiry only when set.
  const inner = encodeSchedulableBody({ fee: defaultMaxFee(BODY.cryptoTransfer), memo: transfer.memo, kind: BODY.cryptoTransfer, data: transfer.encode() });
  const data = encodeScheduleCreate({
    scheduled: inner,
    memo: opts.schedule.memo ?? null,
    payer: parseAccountId(me),
    expiration: opts.schedule.expiresAt ? dateTimestamp(opts.schedule.expiresAt) : null,
    waitForExpiry: opts.schedule.expiresAt ? false : null,
  });
  return requestFor(freezeNew({ kind: BODY.scheduleCreate, data }, me, ctx), me, ctx);
}

/** Approve someone else's scheduled transaction (e.g. the other side of a Secure Trade). */
export async function buildScheduleSign(scheduleId: string, ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  return requestFor(freezeNew({ kind: BODY.scheduleSign, data: encodeScheduleSign(parseEntityId(scheduleId)) }, payer, ctx), payer, ctx);
}
