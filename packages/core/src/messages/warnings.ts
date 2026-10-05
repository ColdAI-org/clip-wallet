import type { Warning } from "../index.js";
import type { BgMessageId } from "./en/index.js";
import { knownMsg, type Msg } from "./msg.js";

/** Every Warning code, in one place (Warning["code"] is derived from this list). */
export const WARNING_CODES = [
  "blind-signing",
  "unlimited-approval",
  "approval-for-all",
  "permit",
  "durable-nonce",
  "known-scam",
  "domain-mismatch",
  "new-recipient",
  "network-matters",
  "simulation-failed",
  "inscribed-utxo",
  "high-fee",
  "account-takeover",
  "account-closure",
  "memo-required",
  "phishing-site",
  "address-poisoning",
  "malicious-transaction",
  "public-record",
  "unknown-call",
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

/** The general message for each code ("bg.warn.<camelCase code>"). */
export const WARNING_DEFAULT_IDS: Record<WarningCode, BgMessageId> = {
  "blind-signing": "bg.warn.blindSigning",
  "unlimited-approval": "bg.warn.unlimitedApproval",
  "approval-for-all": "bg.warn.approvalForAll",
  "permit": "bg.warn.permit",
  "durable-nonce": "bg.warn.durableNonce",
  "known-scam": "bg.warn.knownScam",
  "domain-mismatch": "bg.warn.domainMismatch",
  "new-recipient": "bg.warn.newRecipient",
  "network-matters": "bg.warn.networkMatters",
  "simulation-failed": "bg.warn.simulationFailed",
  "inscribed-utxo": "bg.warn.inscribedUtxo",
  "high-fee": "bg.warn.highFee",
  "account-takeover": "bg.warn.accountTakeover",
  "account-closure": "bg.warn.accountClosure",
  "memo-required": "bg.warn.memoRequired",
  "phishing-site": "bg.warn.phishingSite",
  "address-poisoning": "bg.warn.addressPoisoning",
  "malicious-transaction": "bg.warn.maliciousTransaction",
  "public-record": "bg.warn.publicRecord",
  "unknown-call": "bg.warn.unknownCall",
};

/**
 * What to show for a warning: its own Msg, else the catalog's exact sentence, else the code's general message
 * (marked `approx`: the UI then also shows the module's English sentence, so no detail is lost).
 */
export function warningMsg(w: Pick<Warning, "code" | "message"> & { msg?: Msg }): Msg {
  if (w.msg && w.msg.fallback === w.message) return w.msg;
  const known = knownMsg(w.message);
  if (known) return known;
  const id = WARNING_DEFAULT_IDS[w.code as WarningCode];
  return id ? { id, fallback: w.message, approx: true } : { id: "", fallback: w.message };
}

/** A Warning whose message is a Msg (`message` is its English). */
export function warning(level: Warning["level"], code: WarningCode, m: Msg): Warning {
  return { level, code, message: m.fallback, msg: m };
}
