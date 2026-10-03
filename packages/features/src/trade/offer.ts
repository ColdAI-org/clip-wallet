import { ClipError } from "@clip-wallet/core";
import { b64urlDecode, b64urlEncode } from "../util.js";

/** One side of a trade, as carried in a share link. Amounts in base units. */
export type LegSpec =
  | { kind: "asset"; symbol: string; decimals: number; amount: string; tokenId?: string; assetKey: string }
  | { kind: "nft"; tokenId: string; serial: string; name?: string };

/**
 * What a Secure Trade link carries. Nothing secret: the maker's signed transaction (direct) or the schedule id
 * (scheduled) is exactly what the counterparty needs. Every claim here is re-checked against the actual
 * transaction (decoded by the Hedera module) before the counterparty can accept.
 */
export interface OfferPayload {
  v: 1;
  /** Network id (Hedera ledger). */
  n: string;
  mode: "direct" | "scheduled";
  maker: string;
  taker: string;
  /** What the maker gives (the taker receives). */
  give: LegSpec;
  /** What the maker gets (the taker pays). */
  get: LegSpec;
  /** Direct: base64 signed transaction bytes. */
  tx?: string;
  /** Scheduled: schedule id. */
  schedule?: string;
  /** Unix ms. */
  expiresAt?: number;
}

const MAX_LINK = 16_000;

export function encodeOffer(base: string, p: OfferPayload): string {
  return `${base.replace(/[#?]+$/, "")}#offer=${b64urlEncode(JSON.stringify(p))}`;
}

function isLeg(x: unknown): x is LegSpec {
  if (!x || typeof x !== "object") return false;
  const l = x as Record<string, unknown>;
  if (l.kind === "nft") return typeof l.tokenId === "string" && /^0\.0\.\d+$/.test(l.tokenId) && typeof l.serial === "string" && /^\d+$/.test(l.serial);
  return (
    l.kind === "asset" &&
    typeof l.symbol === "string" &&
    l.symbol.length <= 32 &&
    typeof l.decimals === "number" &&
    typeof l.amount === "string" &&
    /^\d+$/.test(l.amount) &&
    typeof l.assetKey === "string" &&
    (l.tokenId === undefined || (typeof l.tokenId === "string" && /^0\.0\.\d+$/.test(l.tokenId)))
  );
}

/** Accepts the full link, the `#offer=…` fragment, or the bare payload. Throws a plain error otherwise. */
export function decodeOffer(link: string): OfferPayload {
  const bad = () => new ClipError("That isn't a Secure Trade link, or it got cut off. Ask for the link again.", "trade/bad-link");
  const s = link.trim();
  if (!s || s.length > MAX_LINK) throw bad();
  const m = /(?:^|[#&?])offer=([A-Za-z0-9_-]+)/.exec(s);
  const raw = m ? m[1]! : /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
  if (!raw) throw bad();
  let p: OfferPayload;
  try {
    p = JSON.parse(b64urlDecode(raw)) as OfferPayload;
  } catch {
    throw bad();
  }
  const ok =
    p &&
    p.v === 1 &&
    typeof p.n === "string" &&
    p.n.startsWith("hedera:") &&
    (p.mode === "direct" || p.mode === "scheduled") &&
    typeof p.maker === "string" &&
    /^0\.0\.\d+$/.test(p.maker) &&
    typeof p.taker === "string" &&
    p.taker.length <= 64 &&
    isLeg(p.give) &&
    isLeg(p.get) &&
    (p.mode === "direct" ? typeof p.tx === "string" && /^[A-Za-z0-9+/=]+$/.test(p.tx) : typeof p.schedule === "string" && /^0\.0\.\d+$/.test(p.schedule));
  if (!ok) throw bad();
  return p;
}

export function legText(l: LegSpec, formatUnits: (a: string, d: number) => string): string {
  return l.kind === "nft" ? `${l.name ?? `NFT ${l.tokenId}`} #${l.serial}` : `${formatUnits(l.amount, l.decimals)} ${l.symbol}`;
}
