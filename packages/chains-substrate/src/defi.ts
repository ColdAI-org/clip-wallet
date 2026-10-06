/**
 * Read helpers for wallet features built on this module (nomination-pool staking, AssetConversion swaps). Reads
 * only; every transaction still goes through `buildCall` → `substrate_signAndSubmit` → decode → approval.
 */
import { type ChainContext, ClipError } from "@clip-wallet/core";
import { Enum, fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { constantOf, readStorage } from "./chain.js";
import { isChainflip, readFlipAccount } from "./chainflip.js";
import { type Runtime, loadRuntime } from "./metadata.js";
import { type SubstrateSpec, specOf } from "./networks.js";
import { SubstrateRpc } from "./rpc.js";
import { fromHex } from "./util.js";

export interface Connection {
  rpc: SubstrateRpc;
  rt: Runtime;
  spec: SubstrateSpec;
  /** This account's address in the network's SS58 format. */
  me: string;
}

/** RPC, runtime metadata (cached per genesis + specVersion) and this account's address for `ctx`. */
export async function connect(ctx: ChainContext): Promise<Connection> {
  const spec = specOf(ctx.network.id);
  if (!spec) throw new ClipError("Clip Wallet doesn't know this Polkadot network.", "substrate/unknown-network");
  const pub = fromHex(ctx.account.publicKey);
  if (pub.length !== 32) throw new ClipError("This Polkadot account isn't set up correctly.", "substrate/bad-account");
  const rpc = new SubstrateRpc(ctx.network.rpcUrls, ctx.fetch);
  const rt = await loadRuntime(rpc, spec.genesisHash);
  return { rpc, rt, spec, me: fromBufferToBase58(rt.ss58)(pub) };
}

/* ------------------------------------------------------------------ XCM locations (AssetConversion ids) */

/** XCM v4/v5 Location as polkadot-api's dynamic codecs read and write it. */
export interface XcmLocation {
  parents: number;
  interior: { type: string; value?: unknown };
}

/**
 * The relay chain's token as seen from Asset Hub: `{ parents: 1, interior: Here }` (DOT / KSM / WND / PAS).
 * This is how `AssetConversion.Pools` keys native pools on every Asset Hub (read live on 2026-10-03).
 */
export const nativeLocation = (): XcmLocation => ({ parents: 1, interior: Enum("Here") as XcmLocation["interior"] });

/** A pallet-assets asset on Asset Hub: `{ parents: 0, interior: X2[PalletInstance(50), GeneralIndex(id)] }`. */
export const assetLocation = (id: number | bigint): XcmLocation => ({
  parents: 0,
  interior: Enum("X2", [Enum("PalletInstance", 50), Enum("GeneralIndex", BigInt(id))]) as XcmLocation["interior"],
});

/** "native", a pallet-assets id, or null for anything else (foreign assets, other pallets). */
export function locationAsset(loc: unknown): "native" | number | null {
  const l = loc as XcmLocation | undefined;
  if (!l || typeof l !== "object" || !l.interior) return null;
  if (l.parents === 1 && l.interior.type === "Here") return "native";
  if (l.parents === 0 && l.interior.type === "X2" && Array.isArray(l.interior.value)) {
    const [a, b] = l.interior.value as { type: string; value: unknown }[];
    if (a?.type === "PalletInstance" && a.value === 50 && b?.type === "GeneralIndex") {
      const id = typeof b.value === "bigint" ? b.value : BigInt(b.value as number);
      if (id <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(id);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ balances and staking timing */

/** Existential deposit of the native token (Balances constant). */
export function existentialDeposit(rt: Runtime): bigint {
  return BigInt(constantOf<bigint>(rt, "Balances", "ExistentialDeposit") ?? 0n);
}

/**
 * Native balance you can move while keeping the account alive: free − max(frozen − reserved, ED), per the
 * Polkadot SDK fungible "reducible balance" rule with Preservation::Preserve.
 */
export async function spendableNative(c: Connection): Promise<bigint> {
  // Chainflip: no Balances pallet; FLIP that can leave the account is Flip.Account balance − bond.
  if (isChainflip(c.rt)) return (await readFlipAccount(c.rpc, c.rt, c.me)).redeemable;
  const acct = await readStorage<{ data: { free: bigint; reserved: bigint; frozen?: bigint } }>(c.rpc, c.rt, "System", "Account", c.me);
  const free = acct?.data.free ?? 0n;
  const reserved = acct?.data.reserved ?? 0n;
  const frozen = acct?.data.frozen ?? 0n;
  const ed = existentialDeposit(c.rt);
  const untouchable = frozen - reserved > ed ? frozen - reserved : ed;
  return free > untouchable ? free - untouchable : 0n;
}

/** Era index pools count unbonding from (`Staking.ActiveEra`; staking-async's `current_era()` returns the active era). */
export async function activeEra(c: Connection): Promise<number | null> {
  const a = await readStorage<{ index: number } | null>(c.rpc, c.rt, "Staking", "ActiveEra").catch(() => null);
  if (a && typeof a.index === "number") return a.index;
  const cur = await readStorage<number | null>(c.rpc, c.rt, "Staking", "CurrentEra").catch(() => null);
  return typeof cur === "number" ? cur : null;
}

/**
 * Eras a pool member waits after unbonding. Pools use `nominator_bonding_duration()` (nomination-pools
 * adapter.rs → staking-async impls.rs): `BondingDuration` when `Staking.AreNominatorsSlashable` is true,
 * otherwise `NominatorFastUnbondDuration`. Runtimes without the fast-unbond constant use `BondingDuration`.
 */
export async function poolUnbondingEras(c: Connection): Promise<number | null> {
  const full = constantOf<number>(c.rt, "Staking", "BondingDuration");
  const fast = constantOf<number>(c.rt, "Staking", "NominatorFastUnbondDuration");
  if (fast === null) return full;
  const slashable = await readStorage<boolean>(c.rpc, c.rt, "Staking", "AreNominatorsSlashable").catch(() => true);
  return slashable === false ? fast : full;
}

/** "about 28 days", "about 12 hours" for a number of eras on this network (null when the era length is unknown). */
export function erasToText(spec: SubstrateSpec, eras: number): string | null {
  if (!spec.eraHours) return null;
  const hours = Math.max(0, eras) * spec.eraHours;
  if (hours < 1) return "less than an hour";
  if (hours < 48) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `about ${days} days`;
}
