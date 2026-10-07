/**
 * Chainflip State Chain: plain words for the calls its own apps send (LP portal lp.chainflip.io, the funding /
 * auctions app, Boost and lending), FLIP balances from `Flip.Account`, and cross-chain address formatting.
 *
 * Call shapes are from Chainflip runtime metadata (chainflip-node 20216 mainnet, 20302 Perseverance, read
 * 2026-10-06); semantics from chainflip-io/chainflip-backend (state-chain/pallets/cf-funding, cf-flip,
 * cf-lp, cf-swapping, cf-lending-pools) and docs.chainflip.io:
 *  - `Funding.redeem { amount: Max | Exact(u128), address: [u8;20], executor: Option<[u8;20]> }` asks the validators
 *    to register a redemption on Ethereum's StateChainGateway; the person then executes it on Ethereum before it
 *    expires (docs.chainflip.io/validators/mainnet/funding).
 *  - `Funding.bind_redeem_address` / `bind_executor_address` are "a one-off irreversible operation" (same page):
 *    the account can then only ever redeem to that address / be executed by that address.
 *  - Fees are burned from `Flip.Account.balance`, bond included (cf-flip on_charge_transaction.rs `try_debit`),
 *    while redemptions can only take the liquid part (`balance - bond`, `FlipAccount::liquid`).
 */
import type { AssetRef, BalanceChange, Warning } from "@clip-wallet/core";
import { knownMsg, recallMsg, say } from "@clip-wallet/core";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, createBase58check } from "@scure/base";
import { fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { readStorage } from "./chain.js";
import type { Runtime } from "./metadata.js";
import type { SubstrateRpc } from "./rpc.js";
import { formatUnits, fromHex, hex, isHex, short, textOf } from "./util.js";

/** A runtime is Chainflip's when it keeps FLIP in `Flip` and moves it with `Funding` (no Balances pallet). */
export function isChainflip(rt: Runtime): boolean {
  return rt.pallets.has("Flip") && rt.pallets.has("Funding") && !rt.pallets.has("Balances");
}

/**
 * Chainflip's `Asset` enum (cf-primitives) → token, chain and decimals. Decimals are each token's own on its chain
 * (docs.chainflip.io/protocol/supported-chains-assets/chains-assets: cbBTC 8, BSC USDT 18; the rest are the
 * tokens' standard decimals). Variants not listed are shown by name with base units.
 */
export const CHAINFLIP_ASSETS: Record<string, { symbol: string; chain: string; decimals: number }> = {
  Eth: { symbol: "ETH", chain: "Ethereum", decimals: 18 },
  Flip: { symbol: "FLIP", chain: "Ethereum", decimals: 18 },
  Usdc: { symbol: "USDC", chain: "Ethereum", decimals: 6 },
  Usdt: { symbol: "USDT", chain: "Ethereum", decimals: 6 },
  Wbtc: { symbol: "WBTC", chain: "Ethereum", decimals: 8 },
  Cbbtc: { symbol: "cbBTC", chain: "Ethereum", decimals: 8 },
  Dot: { symbol: "DOT", chain: "Polkadot", decimals: 10 },
  Btc: { symbol: "BTC", chain: "Bitcoin", decimals: 8 },
  ArbEth: { symbol: "ETH", chain: "Arbitrum", decimals: 18 },
  ArbUsdc: { symbol: "USDC", chain: "Arbitrum", decimals: 6 },
  ArbUsdt: { symbol: "USDT", chain: "Arbitrum", decimals: 6 },
  Sol: { symbol: "SOL", chain: "Solana", decimals: 9 },
  SolUsdc: { symbol: "USDC", chain: "Solana", decimals: 6 },
  SolUsdt: { symbol: "USDT", chain: "Solana", decimals: 6 },
  HubDot: { symbol: "DOT", chain: "Polkadot Asset Hub", decimals: 10 },
  HubUsdc: { symbol: "USDC", chain: "Polkadot Asset Hub", decimals: 6 },
  HubUsdt: { symbol: "USDT", chain: "Polkadot Asset Hub", decimals: 6 },
  Trx: { symbol: "TRX", chain: "Tron", decimals: 6 },
  TrxUsdt: { symbol: "USDT", chain: "Tron", decimals: 6 },
  Bnb: { symbol: "BNB", chain: "BNB Smart Chain", decimals: 18 },
  BscUsdt: { symbol: "USDT", chain: "BNB Smart Chain", decimals: 18 },
};

/** `EncodedAddress` variants (cf-chains) → chain name. */
const ADDRESS_CHAINS: Record<string, string> = {
  Eth: "Ethereum",
  Arb: "Arbitrum",
  Bsc: "BNB Smart Chain",
  Dot: "Polkadot",
  Hub: "Polkadot Asset Hub",
  Sol: "Solana",
  Btc: "Bitcoin",
  Tron: "Tron",
};

const tronCheck = createBase58check(sha256);

export function bytesOf(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string" && isHex(v)) return fromHex(v);
  if (v && typeof v === "object" && typeof (v as { asBytes?: unknown }).asBytes === "function") return (v as { asBytes(): Uint8Array }).asBytes();
  return null;
}

/** EIP-55 checksummed 0x address. */
export function ethAddress(v: unknown): string {
  const b = bytesOf(v);
  if (!b || b.length !== 20) return b ? `0x${hex(b)}` : String(v);
  const lower = hex(b);
  const h = hex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) out += parseInt(h[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

/** A Chainflip `EncodedAddress` ({ type: "Eth", value: bytes }) → the address as people write it on that chain. */
export function foreignAddress(v: unknown): { chain: string; address: string } {
  const e = v as { type?: string; value?: unknown } | undefined;
  const chain = (e?.type && ADDRESS_CHAINS[e.type]) ?? e?.type ?? "another chain";
  const b = bytesOf(e?.value);
  if (!b) return { chain, address: String(e?.value ?? "") };
  switch (e?.type) {
    case "Eth":
    case "Arb":
    case "Bsc":
      return { chain, address: ethAddress(b) };
    case "Dot":
    case "Hub":
      return { chain, address: b.length === 32 ? fromBufferToBase58(0)(b) : `0x${hex(b)}` };
    case "Sol":
      return { chain, address: base58.encode(b) };
    case "Tron":
      return { chain, address: b.length === 20 ? tronCheck.encode(Uint8Array.of(0x41, ...b)) : `0x${hex(b)}` };
    case "Btc":
      // cf-chains EncodedAddress::Btc carries the address string's bytes.
      return { chain, address: textOf(b) ?? `0x${hex(b)}` };
    default:
      return { chain, address: `0x${hex(b)}` };
  }
}

const big = (v: unknown): bigint => (typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : 0n);
const variant = (v: unknown): string => (v && typeof v === "object" && typeof (v as { type?: unknown }).type === "string" ? (v as { type: string }).type : String(v));

/** "USDC (Ethereum)" for an Asset enum value. */
export function assetName(v: unknown): string {
  const a = CHAINFLIP_ASSETS[variant(v)];
  return a ? `${a.symbol} (${a.chain})` : variant(v);
}

/** "1.5 USDC (Ethereum)" for an amount of an Asset enum value (base units when the asset is unknown). */
export function assetAmount(v: unknown, amount: unknown): string {
  const a = CHAINFLIP_ASSETS[variant(v)];
  return a ? `${formatUnits(big(amount), a.decimals)} ${a.symbol} (${a.chain})` : `${big(amount)} ${variant(v)}`;
}

export interface FlipAccount {
  /** Everything in the account, bond included (`Flip.Account.balance`). Fees are paid from this. */
  balance: bigint;
  /** Bonded by a validator; it can't be redeemed (`Flip.Account.bond`). */
  bond: bigint;
  /** What can be redeemed to Ethereum now: balance − bond. */
  redeemable: bigint;
  /** FLIP already on its way to Ethereum (not in `balance`), with the Ethereum address it goes to. */
  pendingRedemption: { amount: bigint; to: string } | null;
}

export async function readFlipAccount(rpc: SubstrateRpc, rt: Runtime, me: string): Promise<FlipAccount> {
  const acct = await readStorage<{ balance: bigint; bond: bigint }>(rpc, rt, "Flip", "Account", me);
  const balance = big(acct?.balance);
  const bond = big(acct?.bond);
  const pending = await readStorage<{ total: bigint; redeem_address: unknown } | null>(rpc, rt, "Funding", "PendingRedemptions", me).catch(() => null);
  return {
    balance,
    bond,
    redeemable: balance > bond ? balance - bond : 0n,
    pendingRedemption: pending ? { amount: big(pending.total), to: ethAddress(pending.redeem_address) } : null,
  };
}

interface Out {
  title: string;
  lines: { label: string; value: string }[];
  balanceChanges: BalanceChange[];
  warnings: Warning[];
  blind: boolean;
}

export interface ChainflipCtx {
  native: AssetRef;
  isMe(address: string): boolean;
  /** Describes a nested call (AccountRoles.as_sub_account). */
  inner(call: { type: string; value: { type: string; value: unknown } }): Promise<{ title: string; lines: { label: string; value: string }[]; warnings: Warning[]; blind: boolean }>;
}

/** Plain words for a Chainflip call, or null to fall back to the generic `Pallet.call(args)` view. */
export async function describeChainflip(pallet: string, name: string, a: Record<string, unknown>, c: ChainflipCtx): Promise<Out | null> {
  const sym = c.native.symbol;
  const flip = (v: unknown) => `${formatUnits(big(v), c.native.decimals)} ${sym}`;
  const out: Out = { title: "", lines: [], balanceChanges: [], warnings: [], blind: false };
  const foreign = (v: unknown, label: string) => {
    const f = foreignAddress(v);
    out.lines.push({ label, value: `${f.address} (${f.chain})` });
    out.warnings.push({ level: "caution", code: "network-matters", message: say("bg.chainflip.foreignRecipient", { to: short(f.address), chain: f.chain }) });
    return f;
  };
  const otherAccount = (to: string) => {
    if (!c.isMe(to)) out.warnings.push({ level: "caution", code: "new-recipient", message: say("bg.chainflip.otherAccount", { to: short(to) }) });
  };

  switch (`${pallet}.${name}`) {
    case "Funding.redeem": {
      const to = ethAddress(a.address);
      const amount = a.amount as { type?: string; value?: unknown } | undefined;
      const exact = amount?.type === "Exact";
      out.title = exact ? say("bg.chainflip.redeem", { amount: flip(amount.value), to: short(to) }) : say("bg.chainflip.redeemAll", { symbol: sym, to: short(to) });
      out.lines.push({ label: "Amount", value: exact ? flip(amount.value) : say("bg.chainflip.allRedeemable", { symbol: sym }) });
      out.lines.push({ label: "Goes to", value: `${to} (Ethereum)` });
      const ex = a.executor == null ? null : ethAddress(a.executor);
      out.lines.push({ label: say("bg.chainflip.label.executor"), value: ex ?? say("bg.chainflip.anyone") });
      out.lines.push({ label: "What happens", value: say("bg.chainflip.redeemSteps") });
      out.warnings.push({ level: "caution", code: "network-matters", message: say("bg.chainflip.redeemWarn", { symbol: sym, to: short(to) }) });
      if (exact) out.balanceChanges.push({ asset: c.native, delta: (-big(amount.value)).toString() });
      return out;
    }
    case "Funding.bind_redeem_address": {
      const to = ethAddress(a.address);
      out.title = say("bg.chainflip.bindRedeem", { to: short(to) });
      out.lines.push({ label: "Address", value: `${to} (Ethereum)` });
      out.warnings.push({ level: "danger", code: "new-recipient", message: say("bg.chainflip.bindRedeemWarn", { symbol: sym, to: short(to) }) });
      return out;
    }
    case "Funding.bind_executor_address": {
      const to = ethAddress(a.executor_address);
      out.title = say("bg.chainflip.bindExecutor", { to: short(to) });
      out.lines.push({ label: "Address", value: `${to} (Ethereum)` });
      out.warnings.push({ level: "danger", code: "new-recipient", message: say("bg.chainflip.bindExecutorWarn", { symbol: sym, to: short(to) }) });
      return out;
    }
    case "Funding.rebalance": {
      const to = String(a.recipient_account_id);
      const amount = a.amount as { type?: string; value?: unknown } | undefined;
      const exact = amount?.type === "Exact";
      out.title = exact ? say("bg.chainflip.moveTo", { amount: flip(amount.value), to: short(to) }) : say("bg.chainflip.moveAllTo", { symbol: sym, to: short(to) });
      out.lines.push({ label: "To", value: to }, { label: "Amount", value: exact ? flip(amount.value) : say("bg.chainflip.allRedeemable", { symbol: sym }) });
      if (a.redemption_address != null) out.lines.push({ label: "Goes to", value: `${ethAddress(a.redemption_address)} (Ethereum)` });
      otherAccount(to);
      if (exact && !c.isMe(to)) out.balanceChanges.push({ asset: c.native, delta: (-big(amount.value)).toString() });
      return out;
    }
    case "LiquidityProvider.register_lp_account":
      out.title = say("bg.chainflip.registerLp");
      return out;
    case "LiquidityProvider.deregister_lp_account":
      out.title = say("bg.chainflip.deregisterLp");
      return out;
    case "LiquidityProvider.register_liquidity_refund_address": {
      const f = foreignAddress(a.address);
      out.title = say("bg.chainflip.refundAddress", { chain: f.chain, to: short(f.address) });
      out.lines.push({ label: "Address", value: `${f.address} (${f.chain})` });
      out.warnings.push({ level: "caution", code: "network-matters", message: say("bg.chainflip.foreignRecipient", { to: short(f.address), chain: f.chain }) });
      return out;
    }
    case "LiquidityProvider.request_liquidity_deposit_address":
      out.title = say("bg.chainflip.depositAddress", { asset: assetName(a.asset) });
      if (big(a.boost_fee) > 0n) out.lines.push({ label: say("bg.chainflip.label.boostFee"), value: `${big(a.boost_fee)} bps` });
      return out;
    case "LiquidityProvider.withdraw_asset": {
      const f = foreignAddress(a.destination_address);
      out.title = say("bg.chainflip.withdraw", { amount: assetAmount(a.asset, a.amount), to: short(f.address), chain: f.chain });
      out.lines.push({ label: "Amount", value: assetAmount(a.asset, a.amount) });
      foreign(a.destination_address, "Goes to");
      return out;
    }
    case "LiquidityProvider.transfer_asset": {
      const to = String(a.destination);
      out.title = say("bg.chainflip.moveTo", { amount: assetAmount(a.asset, a.amount), to: short(to) });
      out.lines.push({ label: "To", value: to }, { label: "Amount", value: assetAmount(a.asset, a.amount) });
      otherAccount(to);
      return out;
    }
    case "LiquidityProvider.schedule_swap":
      out.title = say("bg.chainflip.swap", { amount: assetAmount(a.input_asset, a.amount), asset: assetName(a.output_asset) });
      out.lines.push({ label: "You pay", value: assetAmount(a.input_asset, a.amount) }, { label: "You get", value: assetName(a.output_asset) });
      return out;
    case "Swapping.request_swap_deposit_address":
    case "Swapping.request_swap_deposit_address_with_affiliates": {
      out.title = say("bg.chainflip.swapChannel", { from: assetName(a.source_asset), to: assetName(a.destination_asset) });
      foreign(a.destination_address, "Sends what you get to");
      const refund = (a.refund_parameters as { refund_address?: unknown } | undefined)?.refund_address;
      if (refund) {
        const r = foreignAddress(refund);
        out.lines.push({ label: say("bg.chainflip.label.refundTo"), value: `${r.address} (${r.chain})` });
      }
      if (big(a.broker_commission) > 0n) out.lines.push({ label: "Fees", value: `${big(a.broker_commission)} bps` });
      if (big(a.boost_fee) > 0n) out.lines.push({ label: say("bg.chainflip.label.boostFee"), value: `${big(a.boost_fee)} bps` });
      return out;
    }
    case "LendingPools.add_boost_funds":
      out.title = say("bg.chainflip.addBoost", { amount: assetAmount(a.asset, a.amount), tier: String(big(a.pool_tier)) });
      out.lines.push({ label: "Amount", value: assetAmount(a.asset, a.amount) }, { label: "Pool", value: `${assetName(a.asset)}, ${big(a.pool_tier)} bps` });
      return out;
    case "LendingPools.stop_boosting":
      out.title = say("bg.chainflip.stopBoost", { asset: assetName(a.asset), tier: String(big(a.pool_tier)) });
      return out;
    case "LendingPools.add_lender_funds":
      out.title = say("bg.chainflip.lend", { amount: assetAmount(a.asset, a.amount) });
      return out;
    case "LendingPools.remove_lender_funds":
      out.title = a.amount == null ? say("bg.chainflip.unlendAll", { asset: assetName(a.asset) }) : say("bg.chainflip.unlend", { amount: assetAmount(a.asset, a.amount) });
      return out;
    case "LendingPools.request_loan":
      out.title = say("bg.chainflip.borrow", { amount: assetAmount(a.loan_asset, a.loan_amount) });
      return out;
    case "LendingPools.make_repayment": {
      const amount = a.amount as { type?: string; value?: unknown } | undefined;
      // The call carries no asset (it's the loan's), so a partial amount is shown in the asset's base units.
      out.title = amount?.type === "Exact" ? say("bg.chainflip.repay", { id: String(big(a.loan_id)) }) : say("bg.chainflip.repayAll", { id: String(big(a.loan_id)) });
      if (amount?.type === "Exact") out.lines.push({ label: "Amount", value: String(big(amount.value)) });
      return out;
    }
    case "AccountRoles.as_sub_account": {
      const inner = await c.inner(a.call as { type: string; value: { type: string; value: unknown } });
      const innerMsg = recallMsg(inner.title) ?? knownMsg(inner.title);
      out.title = say("bg.chainflip.onSubAccount", { n: String(big(a.sub_account_index)), inner: innerMsg ?? inner.title });
      out.lines.push(...inner.lines);
      out.warnings.push(...inner.warnings);
      out.blind = inner.blind;
      return out;
    }
  }
  return null;
}
