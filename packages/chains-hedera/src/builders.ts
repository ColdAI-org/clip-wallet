import { type AssetRef, type ChainContext, ClipError, type DappRequest } from "@clip-wallet/core";
import {
  AccountId,
  AccountUpdateTransaction,
  Client,
  Hbar,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  Timestamp,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  type Transaction,
  TransactionId,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { isAccountId, isEvmAddress, longZeroToAccountId, stripChecksum } from "./address.js";
import { Mirror } from "./mirror.js";
import { ledgerOf, mirrorUrl } from "./networks.js";
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
export async function resolveRecipient(to: string, mirror: Mirror): Promise<AccountId> {
  const v = to.trim();
  if (isAccountId(v)) return AccountId.fromString(stripChecksum(v));
  if (isEvmAddress(v)) {
    const longZero = longZeroToAccountId(v);
    if (longZero) return AccountId.fromString(longZero);
    const acct = await mirror.account(v.toLowerCase()).catch(() => null);
    if (acct) return AccountId.fromString(acct.account);
    return AccountId.fromEvmAddress(0, 0, v.toLowerCase()); // HIP-583: first transfer creates the account
  }
  throw new ClipError("That doesn't look like a Hedera address. It should look like 0.0.1234 or 0x…", "hedera/bad-address");
}

export function freezeNew(tx: Transaction, payer: string, ctx: ChainContext): Transaction {
  tx.setTransactionId(TransactionId.generate(AccountId.fromString(payer)));
  const client = Client.forName(ledgerOf(ctx.network.id), { scheduleNetworkUpdate: false });
  try {
    tx.freezeWith(client);
  } finally {
    client.close();
  }
  return tx;
}

export function requestFor(
  tx: Transaction,
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
    params: { signerAccountId: `${ctx.network.id}:${payer}`, transactionList: b64encode(tx.toBytes()) },
  };
}

function parseAmount(amount: string): bigint {
  if (!/^\d+$/.test(amount)) throw new ClipError("Enter an amount greater than zero.", "hedera/bad-amount");
  const v = BigInt(amount);
  if (v <= 0n) throw new ClipError("Enter an amount greater than zero.", "hedera/bad-amount");
  return v;
}

/** HBAR (asset.address absent) or an HTS fungible token (asset.address = token id). `amount` in base units. */
export async function buildTransfer(p: { asset: AssetRef; to: string; amount: string }, ctx: ChainContext): Promise<DappRequest> {
  const mirror = mirrorFor(ctx);
  const payer = await resolvePayer(ctx, mirror);
  const to = await resolveRecipient(p.to, mirror);
  if (to.toString() === payer) throw new ClipError("That's your own account.", "hedera/self-transfer");
  const amount = parseAmount(p.amount);
  const tx = new TransferTransaction();
  if (!p.asset.address) {
    tx.addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString())).addHbarTransfer(to, Hbar.fromTinybars(amount.toString()));
  } else {
    tx.addTokenTransferWithDecimals(p.asset.address, payer, -amount, p.asset.decimals).addTokenTransferWithDecimals(
      p.asset.address,
      to,
      amount,
      p.asset.decimals,
    );
  }
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
}

export async function buildNftTransfer(p: { tokenId: string; serial: string | number; to: string }, ctx: ChainContext): Promise<DappRequest> {
  const mirror = mirrorFor(ctx);
  const payer = await resolvePayer(ctx, mirror);
  const to = await resolveRecipient(p.to, mirror);
  const tx = new TransferTransaction().addNftTransfer(p.tokenId, Number(p.serial), payer, to);
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
}

/** "Add the SAUCE token to your account." */
export async function buildAssociate(tokenIds: string | string[], ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  const tx = new TokenAssociateTransaction().setAccountId(payer).setTokenIds([tokenIds].flat());
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
}

/** "Remove the SAUCE token from your account." The balance must be zero first. */
export async function buildDissociate(tokenIds: string | string[], ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  const tx = new TokenDissociateTransaction().setAccountId(payer).setTokenIds([tokenIds].flat());
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
}

export type StakeTarget = { nodeId: number } | { accountId: string } | { stop: true };

/**
 * Native staking (HIP-406): the HBAR never leaves the account; rewards accrue to it.
 * `declineReward` keeps staking but turns rewards off.
 */
export async function buildStakeUpdate(target: StakeTarget, ctx: ChainContext, declineReward?: boolean): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  const tx = new AccountUpdateTransaction().setAccountId(payer);
  if ("nodeId" in target) tx.setStakedNodeId(target.nodeId);
  else if ("accountId" in target) tx.setStakedAccountId(stripChecksum(target.accountId));
  else tx.clearStakedNodeId();
  if (declineReward != null) tx.setDeclineStakingReward(declineReward);
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
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

function addLeg(tx: TransferTransaction, leg: SwapLeg, from: AccountId | string, to: AccountId | string) {
  if ("nft" in leg) {
    tx.addNftTransfer(leg.nft.tokenId, Number(leg.nft.serial), from, to);
  } else if (!leg.asset.address) {
    const v = parseAmount(leg.amount);
    tx.addHbarTransfer(from, Hbar.fromTinybars((-v).toString())).addHbarTransfer(to, Hbar.fromTinybars(v.toString()));
  } else {
    const v = parseAmount(leg.amount);
    tx.addTokenTransferWithDecimals(leg.asset.address, from, -v, leg.asset.decimals).addTokenTransferWithDecimals(
      leg.asset.address,
      to,
      v,
      leg.asset.decimals,
    );
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
  if (other.toString() === me) throw new ClipError("You can't trade with yourself.", "hedera/self-trade");
  const transfer = new TransferTransaction();
  addLeg(transfer, opts.give, me, other);
  addLeg(transfer, opts.get, other, me);
  if (opts.memo) transfer.setTransactionMemo(opts.memo);

  if (!opts.schedule) {
    transfer.setTransactionValidDuration(180);
    return requestFor(freezeNew(transfer, me, ctx), me, ctx, SIGN_TRANSACTION_BYTES);
  }
  const create = new ScheduleCreateTransaction().setScheduledTransaction(transfer).setPayerAccountId(AccountId.fromString(me));
  if (opts.schedule.memo) create.setScheduleMemo(opts.schedule.memo);
  if (opts.schedule.expiresAt) create.setExpirationTime(Timestamp.fromDate(opts.schedule.expiresAt)).setWaitForExpiry(false);
  return requestFor(freezeNew(create, me, ctx), me, ctx);
}

/** Approve someone else's scheduled transaction (e.g. the other side of a Secure Trade). */
export async function buildScheduleSign(scheduleId: string, ctx: ChainContext): Promise<DappRequest> {
  const payer = await resolvePayer(ctx);
  const tx = new ScheduleSignTransaction().setScheduleId(scheduleId);
  return requestFor(freezeNew(tx, payer, ctx), payer, ctx);
}
