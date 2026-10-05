import type { BgMessageId } from "./en/index.js";
import { isMsg, knownMsg, type Msg } from "./msg.js";

/**
 * Error kinds by the code's last part ("near/insufficient-funds" → "insufficient-funds"), or the whole code.
 * Each maps to a general message that is true for every code listed; codes not listed stay English unless
 * their exact sentence is in the catalog or the error carries a Msg.
 */
export const ERROR_CATEGORIES: readonly { id: BgMessageId; codes: readonly string[] }[] = [
  { id: "bg.err.declined", codes: ["user-rejected"] },
  { id: "bg.err.cat.locked", codes: ["vault/locked"] },
  { id: "bg.err.cat.timeout", codes: ["approval/timeout", "hw/timeout", "status-timeout"] },
  { id: "bg.err.cat.cancelled", codes: ["cancelled", "social-cancelled"] },
  { id: "bg.err.cat.insufficient", codes: ["insufficient-funds", "insufficient", "insufficient-token", "insufficient-balance"] },
  {
    id: "bg.err.cat.unreachable",
    codes: ["offline", "unreachable", "rpc-unreachable", "network-unreachable", "mirror-unreachable", "esplora-unreachable", "indexer-unreachable", "status-unreachable", "hedera-unreachable"],
  },
  { id: "bg.err.cat.busy", codes: ["rate-limited", "status-rate-limited", "hedera-rate-limited", "stellar/busy"] },
  { id: "bg.err.cat.unavailable", codes: ["no-rpc", "no-indexer", "rpc/unavailable", "rpc/no-endpoint"] },
  { id: "bg.err.unsupportedRequest", codes: ["unsupported-method"] },
  { id: "bg.err.cat.unsupported", codes: ["unsupported", "unsupported-action", "unsupported-operation", "unsupported-type", "unsupported-call", "unsupported-token", "unsupported-asset"] },
  { id: "bg.err.cat.badAddress", codes: ["bad-address", "bad-recipient", "send/address"] },
  { id: "bg.err.ownAddress", codes: ["self-transfer"] },
  { id: "bg.err.cat.badAmount", codes: ["bad-amount", "send/amount", "precision"] },
  { id: "bg.err.cat.tooSmall", codes: ["too-small"] },
  { id: "bg.err.otherAccountUsing", codes: ["wrong-account"] },
  { id: "bg.err.cat.wrongNetwork", codes: ["network-mismatch", "chain-mismatch"] },
  { id: "bg.err.cat.badSignature", codes: ["bad-signature", "missing-signature"] },
  { id: "bg.err.cat.unreadable", codes: ["bad-transaction", "bad-params", "bad-request", "bad-payload", "bad-psbt", "parse-failed", "unreadable-operation", "bus/invalid", "bus/bad-reply"] },
  { id: "bg.err.cat.expired", codes: ["not-prepared", "expired", "approval/gone"] },
  { id: "bg.err.cat.quoteExpired", codes: ["quote-expired"] },
  { id: "bg.err.cat.sendFailed", codes: ["send-failed", "broadcast-rejected", "submit-failed"] },
  {
    id: "bg.err.tokenNotFound",
    codes: ["near/unknown-token", "starknet/unknown-token", "algorand/unknown-asset", "cardano/unknown-asset", "substrate/unknown-asset", "solana/unknown-mint"],
  },
  { id: "bg.err.cat.noRoute", codes: ["no-route"] },
  { id: "bg.err.notInBuild", codes: ["off", "features/off", "social/off", "security/off"] },
];

let byCode: Map<string, BgMessageId> | undefined;

/** The general message id for an error code, if its kind is known. */
export function errorCategoryId(code: string | undefined): BgMessageId | undefined {
  if (!code) return undefined;
  if (!byCode) {
    byCode = new Map();
    for (const c of ERROR_CATEGORIES) for (const k of c.codes) byCode.set(k, c.id);
  }
  return byCode.get(code) ?? byCode.get(code.slice(code.lastIndexOf("/") + 1));
}

/**
 * What to show for an error (a ClipError, or one rebuilt from a bus reply): its own Msg, else the catalog's
 * exact sentence, else the general message for its kind (`approx`), else undefined (show userMessage).
 */
export function errorMsg(err: unknown): Msg | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { userMessage?: unknown; code?: unknown; msg?: unknown };
  const text = typeof e.userMessage === "string" ? e.userMessage : undefined;
  if (isMsg(e.msg) && (text === undefined || e.msg.fallback === text)) return e.msg;
  if (!text) return undefined;
  const known = knownMsg(text);
  if (known) return known;
  const id = errorCategoryId(typeof e.code === "string" ? e.code : undefined);
  return id ? { id, fallback: text, approx: true } : undefined;
}
