import { ClipError } from "@clip-wallet/core";
import { bcs } from "@mysten/sui/bcs";
import { type TransactionData, Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import { b64decode } from "./util.js";

/**
 * Wallet-built Sui DeFi transactions (native staking, aggregator swaps). Pure building and parsing: no keys,
 * no network. The results are Wallet Standard transaction JSON (`transaction.toJSON()`), which this module's
 * `sui:signAndExecuteTransaction` resolves and builds over GraphQL (gas, shared-object versions), so decode,
 * prepare and finalize all see the same bytes.
 *
 * Staking (MystenLabs/sui crates/sui-framework/packages/sui-system/sources/sui_system.move, checked 2026-10-03):
 *   public entry fun request_add_stake(wrapper: &mut SuiSystemState, stake: Coin<SUI>, validator_address: address, ctx)
 *   public entry fun request_withdraw_stake(wrapper: &mut SuiSystemState, staked_sui: StakedSui, ctx)
 * SuiSystemState is the shared object 0x5. staking_pool.move: MIN_STAKING_THRESHOLD = 1_000_000_000 (1 SUI).
 */
export const SUI_SYSTEM_STATE_ID = normalizeSuiAddress("0x5");
export const SUI_SYSTEM_PACKAGE = normalizeSuiAddress("0x3");
export const MIN_STAKE_MIST = 1_000_000_000n;
/** 0x5 is created at genesis (initial shared version 1) and both staking calls take it as `&mut`. */
const SYSTEM_STATE_REF = { objectId: "0x5", initialSharedVersion: 1, mutable: true } as const;
export const STAKED_SUI_TYPE = "0x3::staking_pool::StakedSui";

function addr(a: string, what: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(a.trim())) throw new ClipError(`That ${what} doesn't look right.`, "sui/bad-address");
  return normalizeSuiAddress(a.trim());
}

/** SplitCoins(gas, amount) + 0x3::sui_system::request_add_stake(0x5, coin, validator). Returns transaction JSON. */
export async function buildStakeTransaction(p: { sender: string; validator: string; amount: bigint }): Promise<string> {
  if (p.amount < MIN_STAKE_MIST) throw new ClipError("Stake at least 1 SUI.", "sui/stake-below-minimum");
  const tx = new Transaction();
  tx.setSender(addr(p.sender, "account"));
  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(p.amount)]);
  tx.moveCall({
    target: `${SUI_SYSTEM_PACKAGE}::sui_system::request_add_stake`,
    arguments: [tx.sharedObjectRef(SYSTEM_STATE_REF), coin!, tx.pure.address(addr(p.validator, "validator"))],
  });
  return tx.toJSON();
}

/** 0x3::sui_system::request_withdraw_stake(0x5, StakedSui). Principal and rewards come back to the sender. */
export async function buildUnstakeTransaction(p: { sender: string; stakedSuiId: string }): Promise<string> {
  const tx = new Transaction();
  tx.setSender(addr(p.sender, "account"));
  tx.moveCall({
    target: `${SUI_SYSTEM_PACKAGE}::sui_system::request_withdraw_stake`,
    arguments: [tx.sharedObjectRef(SYSTEM_STATE_REF), tx.object(addr(p.stakedSuiId, "stake"))],
  });
  return tx.toJSON();
}

/** A base64 BCS TransactionKind (what aggregator APIs return) → transaction JSON with this sender. */
export async function transactionFromKind(kindB64: string, sender: string): Promise<string> {
  let tx: Transaction;
  try {
    tx = Transaction.fromKind(kindB64);
  } catch (cause) {
    throw new ClipError("The swap service sent a transaction Clip Wallet can't read. Nothing was sent.", "sui/bad-transaction", cause);
  }
  tx.setSender(addr(sender, "account"));
  return tx.toJSON();
}

/** Parse transaction JSON (or a base64 TransactionKind) back into plain TransactionData with the SDK. */
export function inspectTransaction(source: string, kind = false): TransactionData {
  try {
    return (kind ? Transaction.fromKind(source) : Transaction.from(source)).getData();
  } catch (cause) {
    throw new ClipError("This transaction can't be read.", "sui/bad-transaction", cause);
  }
}

export type { TransactionData };

type Input = TransactionData["inputs"][number];

/** The pure bytes of an input, if it is one (resolved `Pure` or unresolved pure value). */
function pureBytes(input: Input | undefined): Uint8Array | null {
  if (!input) return null;
  const i = input as { Pure?: { bytes: string }; UnresolvedPure?: { value: unknown } };
  if (i.Pure) return b64decode(i.Pure.bytes);
  return null;
}

/** A pure u64 input's value, or null. */
export function pureU64Of(input: Input | undefined): bigint | null {
  const b = pureBytes(input);
  if (!b || b.length !== 8) return null;
  return BigInt(bcs.u64().parse(b));
}

/** A pure address input's value (normalized), or null. */
export function pureAddressOf(input: Input | undefined): string | null {
  const b = pureBytes(input);
  if (!b || b.length !== 32) return null;
  return normalizeSuiAddress(bcs.Address.parse(b));
}

/** `0x2::sui::SUI` style → fully normalized struct tag (for comparing coin types). */
export function normalizeCoinType(t: string): string {
  return normalizeStructTag(t);
}

export { normalizeSuiAddress };
