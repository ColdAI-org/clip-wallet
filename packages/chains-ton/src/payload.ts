import "./buffer.js";
import { type Address, Cell, type Slice, beginCell } from "@ton/core";

/** Message body opcodes (TEP-74 jettons, TEP-62 NFTs, wallet comments). */
export const OP = {
  comment: 0x00000000,
  encryptedComment: 0x2167da4b,
  jettonTransfer: 0x0f8a7ea5,
  jettonBurn: 0x595f07bc,
  nftTransfer: 0x5fcc3d14,
} as const;

export type Body =
  | { kind: "empty" }
  | { kind: "comment"; text: string }
  | { kind: "encrypted-comment" }
  | { kind: "jetton-transfer"; queryId: bigint; amount: bigint; destination: Address | null; responseDestination: Address | null; forwardTon: bigint; forwardComment?: string; hasCustomPayload: boolean }
  | { kind: "jetton-burn"; queryId: bigint; amount: bigint }
  | { kind: "nft-transfer"; queryId: bigint; newOwner: Address | null; responseDestination: Address | null; forwardTon: bigint; forwardComment?: string; hasCustomPayload: boolean }
  | { kind: "unknown"; op: number | null };

function commentOf(s: Slice): string | undefined {
  try {
    if (s.remainingBits < 32) return undefined;
    if (s.loadUint(32) !== OP.comment) return undefined;
    const text = s.loadStringTail();
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ? undefined : text;
  } catch {
    return undefined;
  }
}

function forwardComment(s: Slice): string | undefined {
  if (s.remainingBits < 1) return undefined;
  const inRef = s.loadBit();
  const p = inRef ? (s.remainingRefs ? s.loadRef().beginParse() : null) : s;
  return p ? commentOf(p) : undefined;
}

export function parseBody(cell: Cell | null): Body {
  if (!cell) return { kind: "empty" };
  const s = cell.beginParse();
  if (s.remainingBits === 0 && s.remainingRefs === 0) return { kind: "empty" };
  if (s.remainingBits < 32) return { kind: "unknown", op: null };
  const op = s.preloadUint(32);
  try {
    switch (op) {
      case OP.comment: {
        const text = commentOf(s);
        return text === undefined ? { kind: "unknown", op } : { kind: "comment", text };
      }
      case OP.encryptedComment:
        return { kind: "encrypted-comment" };
      case OP.jettonTransfer: {
        s.loadUint(32);
        const queryId = s.loadUintBig(64);
        const amount = s.loadCoins();
        const destination = s.loadMaybeAddress();
        const responseDestination = s.loadMaybeAddress();
        const hasCustomPayload = s.loadBit();
        if (hasCustomPayload) s.loadRef();
        const forwardTon = s.loadCoins();
        const fc = forwardComment(s);
        return { kind: "jetton-transfer", queryId, amount, destination, responseDestination, forwardTon, hasCustomPayload, ...(fc !== undefined ? { forwardComment: fc } : {}) };
      }
      case OP.jettonBurn: {
        s.loadUint(32);
        const queryId = s.loadUintBig(64);
        return { kind: "jetton-burn", queryId, amount: s.loadCoins() };
      }
      case OP.nftTransfer: {
        s.loadUint(32);
        const queryId = s.loadUintBig(64);
        const newOwner = s.loadMaybeAddress();
        const responseDestination = s.loadMaybeAddress();
        const hasCustomPayload = s.loadBit();
        if (hasCustomPayload) s.loadRef();
        const forwardTon = s.loadCoins();
        const fc = forwardComment(s);
        return { kind: "nft-transfer", queryId, newOwner, responseDestination, forwardTon, hasCustomPayload, ...(fc !== undefined ? { forwardComment: fc } : {}) };
      }
      default:
        return { kind: "unknown", op };
    }
  } catch {
    return { kind: "unknown", op };
  }
}

export function cellFromB64(b64: string, what: string): Cell {
  try {
    const cells = Cell.fromBoc(Buffer.from(b64, "base64"));
    if (cells.length !== 1) throw new Error("expected one root cell");
    return cells[0]!;
  } catch (cause) {
    throw Object.assign(new Error(`bad ${what}`), { cause });
  }
}

export function commentCell(text: string): Cell {
  return beginCell().storeUint(OP.comment, 32).storeStringTail(text).endCell();
}

/** TEP-74 transfer body (sent to *your* jetton wallet). */
export function jettonTransferBody(p: {
  queryId?: bigint;
  amount: bigint;
  destination: Address;
  responseDestination: Address;
  customPayload?: Cell | null;
  forwardTon: bigint;
  forwardPayload?: Cell | null;
}): Cell {
  const b = beginCell()
    .storeUint(OP.jettonTransfer, 32)
    .storeUint(p.queryId ?? 0n, 64)
    .storeCoins(p.amount)
    .storeAddress(p.destination)
    .storeAddress(p.responseDestination)
    .storeMaybeRef(p.customPayload ?? null)
    .storeCoins(p.forwardTon);
  if (p.forwardPayload) b.storeBit(1).storeRef(p.forwardPayload);
  else b.storeBit(0);
  return b.endCell();
}

/** TEP-62 transfer body (sent to the NFT item). */
export function nftTransferBody(p: {
  queryId?: bigint;
  newOwner: Address;
  responseDestination: Address;
  customPayload?: Cell | null;
  forwardTon: bigint;
  forwardPayload?: Cell | null;
}): Cell {
  const b = beginCell()
    .storeUint(OP.nftTransfer, 32)
    .storeUint(p.queryId ?? 0n, 64)
    .storeAddress(p.newOwner)
    .storeAddress(p.responseDestination)
    .storeMaybeRef(p.customPayload ?? null)
    .storeCoins(p.forwardTon);
  if (p.forwardPayload) b.storeBit(1).storeRef(p.forwardPayload);
  else b.storeBit(0);
  return b.endCell();
}
