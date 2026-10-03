import "./buffer.js";
import { Address, Cell, beginCell } from "@ton/core";
import { OP, cellFromB64 } from "./payload.js";

export type { Cell as TonCell } from "@ton/core";

/**
 * Message bodies for wallet-built DeFi actions (Clip Wallet features: STON.fi swaps, Tonstakers liquid staking).
 * Built here so `@clip-wallet/features` never needs @ton/core, and parsed back with the same SDK so tests and
 * `Step.verify` check the real bytes. Pure data in and out: addresses as strings, amounts as bigint, cells as
 * base64 BoC.
 *
 * Layouts follow the official sources (read 2026-10-03):
 *  - STON.fi DEX v2 (v2.1 and v2.2 routers share it): ston-fi/sdk `src/contracts/dex/v2_1/router/BaseRouterV2_1.ts`
 *    (`createSwapBody`, op 0x6664de2a), `src/contracts/pTON/v2_1/PtonV2_1.ts` (`createTonTransferBody`, op 0x01f3835d).
 *  - Tonstakers: ton-blockchain/liquid-staking-contract `contracts/op-codes.func` (pool::deposit 0x47d54391,
 *    jetton::burn 0x595f07bc) and `contracts/pool.func`; payload layout as in tonstakers/tonstakers-sdk `src/tonstakers.ts`.
 */
export const DEFI_OP = {
  stonfiSwap: 0x6664de2a,
  ptonTonTransfer: 0x01f3835d,
  tonstakersDeposit: 0x47d54391,
  jettonBurn: OP.jettonBurn,
  jettonTransfer: OP.jettonTransfer,
} as const;

const b64 = (c: Cell) => c.toBoc().toString("base64");
const addr = (s: string) => Address.parse(s.trim());

/** True when two TON addresses (raw or friendly, any flags) are the same account. */
export function sameTonAddress(a: string, b: string): boolean {
  try {
    return addr(a).equals(addr(b));
  } catch {
    return false;
  }
}

export function isTonAddress(s: string): boolean {
  return Address.isFriendly(s.trim()) || Address.isRaw(s.trim());
}

/** "0:abcd…" form. */
export function rawTonAddress(s: string): string {
  return addr(s).toRawString();
}

/** Friendly form with explicit flags (contracts: bounceable; testnet: test-only). */
export function friendlyTonAddress(s: string, o: { bounceable: boolean; testOnly: boolean }): string {
  return addr(s).toString({ urlSafe: true, bounceable: o.bounceable, testOnly: o.testOnly });
}

/** An address stored in a cell (tonapi get-method stack `cell` entries are hex BoC). */
export function addressFromCellHex(hexBoc: string): string {
  return Cell.fromBoc(Buffer.from(hexBoc, "hex"))[0]!.beginParse().loadAddress().toRawString();
}

/** Hex BoC of a cell holding one address (the form tonapi uses for get-method `cell` results). */
export function addressCellHex(s: string): string {
  return beginCell().storeAddress(addr(s)).endCell().toBoc().toString("hex");
}

/* ------------------------------------------------------------------ STON.fi v2 */

export interface StonfiSwapParams {
  /** The router's jetton wallet for the token you get (pTON wallet when you get GRAM). */
  askJettonWallet: string;
  /** Who receives the output (always the user). */
  receiver: string;
  minOut: bigint;
  /** Where the offer comes back if the swap fails. */
  refund: string;
  excesses?: string;
  /** Unix seconds. */
  deadline: number;
}

/** Router swap payload (BaseRouterV2_1.createSwapBody, no referral, no custom payloads). */
export function stonfiSwapPayload(p: StonfiSwapParams): Cell {
  return beginCell()
    .storeUint(DEFI_OP.stonfiSwap, 32)
    .storeAddress(addr(p.askJettonWallet))
    .storeAddress(addr(p.refund))
    .storeAddress(addr(p.excesses ?? p.refund))
    .storeUint(p.deadline, 64)
    .storeRef(
      beginCell()
        .storeCoins(p.minOut)
        .storeAddress(addr(p.receiver))
        .storeCoins(0n) // dex custom payload forward gas
        .storeMaybeRef(null) // dex custom payload
        .storeCoins(0n) // refund forward gas
        .storeMaybeRef(null) // refund payload
        .storeUint(10, 16) // referral value (bps), SDK default; no referral address so nothing is paid
        .storeAddress(null)
        .endCell(),
    )
    .endCell();
}

export interface ParsedStonfiSwap {
  askJettonWallet: string;
  refund: string;
  excesses: string;
  deadline: number;
  minOut: bigint;
  receiver: string;
  referral: string | null;
  hasCustomPayloads: boolean;
}

export function parseStonfiSwapPayload(c: Cell): ParsedStonfiSwap {
  const s = c.beginParse();
  if (s.loadUint(32) !== DEFI_OP.stonfiSwap) throw new Error("not a STON.fi swap");
  const askJettonWallet = s.loadAddress().toRawString();
  const refund = s.loadAddress().toRawString();
  const excesses = s.loadAddress().toRawString();
  const deadline = Number(s.loadUintBig(64));
  const r = s.loadRef().beginParse();
  const minOut = r.loadCoins();
  const receiver = r.loadAddress().toRawString();
  const g1 = r.loadCoins();
  const cp = r.loadMaybeRef();
  const g2 = r.loadCoins();
  const rp = r.loadMaybeRef();
  r.loadUint(16);
  const ref = r.loadMaybeAddress();
  return { askJettonWallet, refund, excesses, deadline, minOut, receiver, referral: ref ? ref.toRawString() : null, hasCustomPayloads: g1 > 0n || g2 > 0n || !!cp || !!rp };
}

/** pTON v2.1 ton_transfer: GRAM in, wrapped and forwarded to the router with the swap payload. */
export function ptonTransferBody(p: { tonAmount: bigint; refund: string; forwardPayload: Cell; queryId?: bigint }): Cell {
  return beginCell()
    .storeUint(DEFI_OP.ptonTonTransfer, 32)
    .storeUint(p.queryId ?? 0n, 64)
    .storeCoins(p.tonAmount)
    .storeAddress(addr(p.refund))
    .storeBit(true)
    .storeRef(p.forwardPayload)
    .endCell();
}

export function parsePtonTransfer(c: Cell): { queryId: bigint; tonAmount: bigint; refund: string; forwardPayload: Cell | null } {
  const s = c.beginParse();
  if (s.loadUint(32) !== DEFI_OP.ptonTonTransfer) throw new Error("not a pTON transfer");
  const queryId = s.loadUintBig(64);
  const tonAmount = s.loadCoins();
  const refund = s.loadAddress().toRawString();
  const forwardPayload = s.loadBit() ? s.loadRef() : null;
  return { queryId, tonAmount, refund, forwardPayload };
}

/** TEP-74 transfer, parsed in full (destination, response, forward payload as a cell). */
export function parseJettonTransferFull(c: Cell): {
  queryId: bigint;
  amount: bigint;
  destination: string;
  responseDestination: string | null;
  hasCustomPayload: boolean;
  forwardTon: bigint;
  forwardPayload: Cell | null;
} {
  const s = c.beginParse();
  if (s.loadUint(32) !== DEFI_OP.jettonTransfer) throw new Error("not a jetton transfer");
  const queryId = s.loadUintBig(64);
  const amount = s.loadCoins();
  const destination = s.loadAddress().toRawString();
  const resp = s.loadMaybeAddress();
  const hasCustomPayload = !!s.loadMaybeRef();
  const forwardTon = s.loadCoins();
  let forwardPayload: Cell | null = null;
  if (s.remainingBits > 0 && s.loadBit()) forwardPayload = s.loadRef();
  else if (s.remainingBits > 0 || s.remainingRefs > 0) forwardPayload = s.asCell();
  return { queryId, amount, destination, responseDestination: resp ? resp.toRawString() : null, hasCustomPayload, forwardTon, forwardPayload };
}

/* ------------------------------------------------------------------ Tonstakers */

/** pool::deposit: op, query_id, then the partner code the official SDK appends (ignored by the pool). */
export function tonstakersDepositBody(p: { queryId?: bigint; partnerCode?: bigint } = {}): Cell {
  return beginCell()
    .storeUint(DEFI_OP.tonstakersDeposit, 32)
    .storeUint(p.queryId ?? 1n, 64)
    .storeUint(p.partnerCode ?? 0n, 64)
    .endCell();
}

export function parseTonstakersDeposit(c: Cell): { queryId: bigint } {
  const s = c.beginParse();
  if (s.loadUint(32) !== DEFI_OP.tonstakersDeposit) throw new Error("not a Tonstakers deposit");
  return { queryId: s.loadUintBig(64) };
}

/**
 * TEP-74 burn sent to your own tsTON wallet. Tonstakers reads the custom payload as two bits:
 * wait_till_round_end, fill_or_kill (both off = instant when the pool has liquidity, else at round end).
 */
export function jettonBurnBody(p: { amount: bigint; responseDestination: string; queryId?: bigint; waitTillRoundEnd?: boolean; fillOrKill?: boolean }): Cell {
  return beginCell()
    .storeUint(DEFI_OP.jettonBurn, 32)
    .storeUint(p.queryId ?? 0n, 64)
    .storeCoins(p.amount)
    .storeAddress(addr(p.responseDestination))
    .storeMaybeRef(
      beginCell()
        .storeUint(p.waitTillRoundEnd ? 1 : 0, 1)
        .storeUint(p.fillOrKill ? 1 : 0, 1)
        .endCell(),
    )
    .endCell();
}

export function parseJettonBurn(c: Cell): { queryId: bigint; amount: bigint; responseDestination: string | null; waitTillRoundEnd: boolean; fillOrKill: boolean } {
  const s = c.beginParse();
  if (s.loadUint(32) !== DEFI_OP.jettonBurn) throw new Error("not a jetton burn");
  const queryId = s.loadUintBig(64);
  const amount = s.loadCoins();
  const resp = s.loadMaybeAddress();
  const cp = s.loadMaybeRef();
  const cs = cp?.beginParse();
  return { queryId, amount, responseDestination: resp ? resp.toRawString() : null, waitTillRoundEnd: !!cs && cs.loadBit(), fillOrKill: !!cs && cs.loadBit() };
}

/* ------------------------------------------------------------------ BoC helpers */

export function cellToB64(c: Cell): string {
  return b64(c);
}

export function cellFromBase64(s: string): Cell {
  return cellFromB64(s, "payload");
}

/** First 32 bits of a body, or null. */
export function opOf(c: Cell | null): number | null {
  if (!c) return null;
  const s = c.beginParse();
  return s.remainingBits >= 32 ? s.preloadUint(32) : null;
}
