import { utf8 } from "./util.js";

/**
 * Legacy Amino JSON signing (SIGN_MODE_LEGACY_AMINO_JSON) and ADR-36 arbitrary-message signing.
 *
 *  - StdSignDoc and its canonical bytes: cosmjs `serializeSignDoc` = UTF-8 of `sortedJsonStringify(doc)` with "&", "<"
 *    and ">" escaped as \u0026, \u003c, \u003e (Go's encoding/json HTML escaping, which the SDK's legacytx
 *    StdSignBytes → sdk.MustSortJSON produces). https://github.com/cosmos/cosmjs/blob/main/packages/amino/src/signdoc.ts
 *  - ADR-36: https://github.com/cosmos/cosmos-sdk/blob/main/docs/architecture/adr-036-arbitrary-signature.md and Keplr
 *    `makeADR36AminoSignDoc` (packages/cosmos/src/adr-36/amino.ts): chain_id "", account_number "0", sequence "0",
 *    fee { gas "0", amount [] }, memo "", one msg { type "sign/MsgSignData", value { signer, data: base64(bytes) } }.
 */

export interface AminoCoin {
  denom: string;
  amount: string;
}

export interface AminoMsg {
  type: string;
  value: unknown;
}

export interface StdFee {
  amount: readonly AminoCoin[];
  gas: string;
  payer?: string;
  granter?: string;
}

export interface StdSignDoc {
  chain_id: string;
  account_number: string;
  sequence: string;
  fee: StdFee;
  msgs: readonly AminoMsg[];
  memo: string;
  timeout_height?: string;
}

function sortedObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sortedObject);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) out[k] = sortedObject((obj as Record<string, unknown>)[k]);
  return out;
}

/** JSON with sorted keys and Go's HTML escaping (cosmjs sortedJsonStringify + escapeCharacters). */
export function sortedJson(obj: unknown): string {
  return JSON.stringify(sortedObject(obj)).replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function serializeSignDoc(doc: StdSignDoc): Uint8Array {
  return utf8(sortedJson(doc));
}

/** Shape check for a StdSignDoc from a dapp (strings where the SDK has strings). */
export function isStdSignDoc(x: unknown): x is StdSignDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  const fee = d.fee as Record<string, unknown> | undefined;
  return (
    typeof d.chain_id === "string" &&
    typeof d.account_number === "string" &&
    typeof d.sequence === "string" &&
    typeof d.memo === "string" &&
    Array.isArray(d.msgs) &&
    d.msgs.every((m) => !!m && typeof m === "object" && typeof (m as AminoMsg).type === "string") &&
    !!fee &&
    typeof fee === "object" &&
    typeof fee.gas === "string" &&
    Array.isArray(fee.amount) &&
    (fee.amount as unknown[]).every((c) => !!c && typeof (c as AminoCoin).denom === "string" && typeof (c as AminoCoin).amount === "string")
  );
}

export const ADR36_MSG_TYPE = "sign/MsgSignData";

/** Keplr makeADR36AminoSignDoc: `data` is base64 of the bytes (a string is UTF-8 encoded first). */
export function makeAdr36SignDoc(signer: string, dataBase64: string): StdSignDoc {
  return {
    chain_id: "",
    account_number: "0",
    sequence: "0",
    fee: { gas: "0", amount: [] },
    msgs: [{ type: ADR36_MSG_TYPE, value: { signer, data: dataBase64 } }],
    memo: "",
  };
}

/** True for an ADR-36 sign doc exactly as Keplr builds it (one MsgSignData, nothing else set). */
export function isAdr36SignDoc(doc: StdSignDoc): { signer: string; data: string } | null {
  if (doc.chain_id !== "" || doc.account_number !== "0" || doc.sequence !== "0" || doc.memo !== "") return null;
  if (doc.fee.gas !== "0" || doc.fee.amount.length !== 0 || doc.msgs.length !== 1) return null;
  const m = doc.msgs[0]!;
  const v = m.value as { signer?: unknown; data?: unknown } | null;
  if (m.type !== ADR36_MSG_TYPE || !v || typeof v.signer !== "string" || typeof v.data !== "string") return null;
  if (Object.keys(v).length !== 2) return null;
  return { signer: v.signer, data: v.data };
}
