import type { AccountIdP, EntityIdP, TimestampP, TransactionIdP } from "./proto/hapi.js";
import { fromHex, hex } from "./util.js";

/** Entity ids ("0.0.1234") and transaction ids, as the Hiero SDK prints and parses them. */

const ENTITY_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]{5}))?$/;

/** "0.0.1234" (an optional HIP-15 checksum is accepted and ignored) → shard/realm/num. */
export function parseEntityId(text: string): EntityIdP {
  const m = ENTITY_RE.exec(text.trim());
  if (!m) throw new Error(`not an entity id: ${text}`);
  return { shard: BigInt(m[1]!), realm: BigInt(m[2]!), num: BigInt(m[3]!) };
}

/** "0.0.1234" or "0x…" (a 20-byte EVM alias: the account is created on first transfer, HIP-583). */
export function parseAccountId(text: string): AccountIdP {
  const v = text.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { shard: 0n, realm: 0n, alias: fromHex(v) };
  const { shard, realm, num } = parseEntityId(v);
  return { shard, realm, num };
}

export function entityIdString(e: { shard: bigint; realm: bigint; num: bigint; evm?: Uint8Array }): string {
  if (e.evm?.length) return `0x${hex(e.evm)}`;
  return `${e.shard}.${e.realm}.${e.num}`;
}

/** 20-byte aliases are EVM addresses; longer ones are key aliases (shown as hex). */
export function accountIdString(a: AccountIdP): string {
  if (a.alias?.length === 20) return `0x${hex(a.alias)}`;
  if (a.alias?.length) return `${a.shard}.${a.realm}.${hex(a.alias)}`;
  return `${a.shard}.${a.realm}.${a.num ?? 0n}`;
}

export function accountEvm(a: AccountIdP): string | null {
  return a.alias?.length === 20 ? `0x${hex(a.alias)}` : null;
}

/** The SDK's TransactionId.toString(): "0.0.1001@1790000000.000000000" (+ "?scheduled", "/nonce"). */
export function transactionIdString(t: TransactionIdP): string | null {
  if (!t.accountId || !t.validStart) return null;
  const nanos = String(t.validStart.nanos).padStart(9, "0");
  return `${accountIdString(t.accountId)}@${t.validStart.seconds}.${nanos}${t.scheduled ? "?scheduled" : ""}${t.nonce != null ? `/${t.nonce}` : ""}`;
}

export function timestampDate(t: TimestampP): Date {
  return new Date(Number(t.seconds) * 1000 + Math.floor(t.nanos / 1_000_000));
}

export function dateTimestamp(d: Date): TimestampP {
  const ms = d.getTime();
  const seconds = Math.floor(ms / 1000);
  return { seconds: BigInt(seconds), nanos: (ms - seconds * 1000) * 1_000_000 };
}

/**
 * A transaction valid-start a few seconds in the past, like the SDK's Timestamp.generate(): 3–8 s of jitter so a
 * slightly fast clock doesn't hit INVALID_TRANSACTION_START, plus random nanos so two ids never collide.
 */
export function generateValidStart(now = Date.now()): TimestampP {
  const t = now - (Math.floor(Math.random() * 5000) + 3000);
  return { seconds: BigInt(Math.floor(t / 1000)), nanos: Math.floor(t % 1000) * 1_000_000 + Math.floor(Math.random() * 1_000_000) };
}

/** The SDK's AccountId.compare (used to order transfer lists the same way). */
export function compareAccountIds(a: AccountIdP, b: AccountIdP): number {
  const c = cmp(a.shard, b.shard) || cmp(a.realm, b.realm);
  if (c) return c;
  if (a.alias && b.alias) {
    const x = hex(a.alias);
    const y = hex(b.alias);
    return x > y ? 1 : x < y ? -1 : 0;
  }
  if (!a.alias && !b.alias) return cmp(a.num ?? 0n, b.num ?? 0n);
  return 1;
}

export function compareEntityIds(a: EntityIdP, b: EntityIdP): number {
  return cmp(a.shard, b.shard) || cmp(a.realm, b.realm) || cmp(a.num, b.num);
}

function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** HIP-15 ledger ids: mainnet 0x00, testnet 0x01, previewnet 0x02. */
export const LEDGER_ID_BYTES = { mainnet: 0, testnet: 1, previewnet: 2 } as const;

/**
 * HIP-15 address checksum ("0.0.123" → "laujm"), https://hips.hedera.com/hip/hip-15, same algorithm as the SDK's
 * EntityIdHelper._checksum.
 */
export function entityChecksum(ledgerId: number, address: string): string {
  const p3 = 26 * 26 * 26;
  const p5 = 26 * 26 * 26 * 26 * 26;
  const m = 1000003;
  const w = 31;
  const d = [...address].map((ch) => (ch === "." ? 10 : Number.parseInt(ch, 10)));
  let s0 = 0;
  let s1 = 0;
  let s = 0;
  d.forEach((x, i) => {
    s = (w * s + x) % p3;
    if (i % 2 === 0) s0 = (s0 + x) % 11;
    else s1 = (s1 + x) % 11;
  });
  let sh = 0;
  for (const b of [ledgerId, 0, 0, 0, 0, 0, 0]) sh = (w * sh + b) % p5;
  let c = ((((address.length % 5) * 11 + s0) * 11 + s1) * p3 + s + sh) % p5;
  c = (c * m) % p5;
  let out = "";
  for (let i = 0; i < 5; i++) {
    out = String.fromCharCode(97 + (c % 26)) + out;
    c = Math.floor(c / 26);
  }
  return out;
}
