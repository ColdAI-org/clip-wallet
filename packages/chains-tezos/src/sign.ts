import { ClipError, type Warning } from "@clip-wallet/core";
import { LocalForger, type ProtocolsHash } from "@taquito/local-forging";
import { fromHex, hex, hostOf, isHex, textOf } from "./encoding.js";
import { unpack } from "./micheline.js";

export type SigningType = "raw" | "operation" | "micheline";

/** Beacon / TZIP-10 sign-in message prefix ("Tezos Signed Message: <dapp url> <ISO time> <statement>"). */
export const SIGNED_MESSAGE_PREFIX = "Tezos Signed Message: ";

export interface SignPayload {
  signingType: SigningType;
  bytes: Uint8Array;
}

/**
 * tezos_sign payloads are hex (WalletConnect example "05010000004254"; Beacon's `payload`). A raw payload that isn't
 * hex is taken as UTF-8 text. Without a signingType: 05… is Micheline, 03… is an operation, anything else raw.
 * Tezos signs blake2b-256 of these bytes (the watermark, 0x03 or 0x05, is already the first byte).
 */
export function signPayload(params: { payload?: unknown; signingType?: unknown }): SignPayload {
  const p = params.payload;
  if (typeof p !== "string" || !p.length) throw new ClipError("This request is missing what to sign.", "tezos/bad-params");
  const h = p.startsWith("0x") ? p.slice(2) : p;
  const declared = params.signingType;
  if (declared != null && declared !== "raw" && declared !== "operation" && declared !== "micheline") {
    throw new ClipError("Clip Wallet doesn't know this kind of Tezos signature.", "tezos/bad-params");
  }
  const bytes = isHex(h) ? fromHex(h) : declared === "raw" || declared == null ? new TextEncoder().encode(p) : null;
  if (!bytes || !bytes.length) throw new ClipError("What this app asks you to sign isn't valid.", "tezos/bad-payload");
  const inferred: SigningType = bytes[0] === 0x05 ? "micheline" : bytes[0] === 0x03 ? "operation" : "raw";
  const signingType = (declared as SigningType | undefined) ?? inferred;
  if (signingType === "micheline" && bytes[0] !== 0x05) throw new ClipError("This Micheline message doesn't start with 05, so Clip Wallet won't sign it.", "tezos/bad-payload");
  if (signingType === "operation" && bytes[0] !== 0x03) throw new ClipError("This operation doesn't start with 03, so Clip Wallet won't sign it.", "tezos/bad-payload");
  return { signingType, bytes };
}

export interface MessageView {
  title: string;
  lines: { label: string; value: string }[];
  warnings: Warning[];
  blind: boolean;
}

function urlHosts(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s/?#]+/gi)) out.push(hostOf(m[0]).toLowerCase());
  return out;
}

const sameSite = (a: string, b: string) => {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
  return strip(a) === strip(b);
};

/** Text messages: sign-in ("Tezos Signed Message: …") or plain text, with the domain checked against the requester. */
export function describeText(text: string, origin: string): MessageView {
  const host = hostOf(origin);
  const warnings: Warning[] = [];
  const lines: { label: string; value: string }[] = [];
  let title = `Sign a message for ${host}`;
  if (text.startsWith(SIGNED_MESSAGE_PREFIX)) {
    const rest = text.slice(SIGNED_MESSAGE_PREFIX.length).trim();
    const [first = "", second = "", ...statement] = rest.split(/\s+/);
    const claimed = /^https?:\/\//i.test(first) ? hostOf(first) : first.replace(/\/.*$/, "");
    title = `Sign in to ${claimed || host}`;
    if (claimed && !sameSite(claimed, host)) {
      warnings.push({ level: "danger", code: "domain-mismatch", message: `This sign-in is for ${claimed}, but the request comes from ${host}. It may be a phishing site.` });
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(second)) lines.push({ label: "Time", value: second });
    const st = /^\d{4}-\d{2}-\d{2}T/.test(second) ? statement.join(" ") : [second, ...statement].join(" ").trim();
    if (st) lines.push({ label: "Statement", value: st });
    lines.push({ label: "Message", value: text });
  } else {
    lines.push({ label: "Message", value: text });
  }
  const other = urlHosts(text).find((h) => !sameSite(h, host));
  if (other && !warnings.length) {
    warnings.push({ level: "danger", code: "domain-mismatch", message: `This message mentions ${other}, but the request comes from ${host}. It may be a phishing site.` });
  }
  return { title, lines, warnings, blind: false };
}

/** Micheline payload (05…). Strings are shown; anything else is blind (it may be a TZIP-17 permit). */
export function describeMicheline(bytes: Uint8Array, origin: string): MessageView {
  const u = unpack(bytes);
  if (u?.kind === "string") return describeText(u.text, origin);
  const host = hostOf(origin);
  if (u?.kind === "bytes") {
    const text = textOf(u.bytes);
    if (text != null) return describeText(text, origin);
  }
  return {
    title: `Sign data for ${host}`,
    lines: [{ label: "Data (not text)", value: `0x${hex(bytes).slice(0, 400)}${bytes.length > 200 ? "…" : ""}` }],
    warnings: [
      {
        level: "danger",
        code: "permit",
        message: "This is signed data a contract can accept as your permission (for example a token permit). Clip Wallet can't read it.",
      },
      { level: "danger", code: "blind-signing", message: "Clip Wallet can't read this. Only sign it if you trust the app." },
    ],
    blind: true,
  };
}

/** Parses a forged operation (03 + forged bytes). Returns null if it doesn't parse. */
export async function parseOperationPayload(bytes: Uint8Array, protocol: ProtocolsHash): Promise<{ branch: string; contents: { kind: string; [k: string]: unknown }[] } | null> {
  try {
    const r = (await new LocalForger(protocol).parse(hex(bytes.subarray(1)))) as { branch: string; contents: { kind: string }[] };
    return r && Array.isArray(r.contents) && r.contents.length ? (r as never) : null;
  } catch {
    return null;
  }
}
