/**
 * Structured, translatable text from the background (chain modules, features, security, route, engine).
 *
 * Everything the background shows a person used to be an English string: approval titles, line labels,
 * warnings, ClipError messages, activity titles, staking/swap step titles. Those strings stay (they are the
 * English truth and every existing consumer keeps working); a `Msg` travels alongside them:
 *
 *   d.title    = "Send 1.5 ETH to 0x12…ab"
 *   d.titleMsg = { id: "bg.req.sendTo", values: { amount: "1.5 ETH", to: "0x12…ab" }, fallback: d.title }
 *
 * The UI renders `fallback` in English (it is exactly what the module said), and in other languages the
 * translation of `id` with `values`, else `fallback`. Values are data and are never translated: amounts,
 * symbols, addresses, app and token names. A value may itself be a Msg ("Schedule: {inner}").
 *
 * Ids and their English live in ./en (one catalog, "bg.*"); translations in ./locales/<code>.ts.
 */
import { BG_MESSAGES, type BgMessageId } from "./en/index.js";

export type MsgValue = string | number | Msg;

export interface Msg {
  /** A "bg.*" id from BG_MESSAGES. */
  id: string;
  values?: Record<string, MsgValue>;
  /** The English text, exactly as the background produced it. Shown when there is no translation. */
  fallback: string;
  /**
   * True when `id` is a general message standing in for a more specific English sentence (a Warning code's
   * or an error kind's general text). The UI shows `fallback` underneath it, so no detail is lost.
   */
  approx?: true;
}

/** Fills "{name}" in an English template. BG_MESSAGES only uses plain arguments, so this is all English needs. */
export function fillTemplate(template: string, values: Record<string, MsgValue> = {}): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const v = values[name];
    if (v === undefined) return whole;
    return typeof v === "object" ? v.fallback : String(v);
  });
}

/**
 * A Msg for a catalog id. `fallback` defaults to the English template filled with `values`; pass it when the
 * existing English differs in a detail the template can't express (it always wins in English).
 */
export function msg(id: BgMessageId, input?: Record<string, MsgValue | bigint>, fallback?: string): Msg {
  const values = input && Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
  const out: Msg = { id, fallback: fallback ?? fillTemplate(BG_MESSAGES[id], values) };
  if (values && Object.keys(values).length) out.values = values;
  return out;
}

/** Same Msg, different English fallback (e.g. lower-cased first letter when it is nested mid-sentence). */
export function withFallback(m: Msg, fallback: string): Msg {
  return { ...m, fallback };
}

/** A string, or the Msg's English. */
export function msgText(m: string | Msg): string {
  return typeof m === "string" ? m : m.fallback;
}

/** Shape check for a Msg that crossed a message bus (data from the background, still checked). */
export function isMsg(x: unknown, depth = 0): x is Msg {
  if (!x || typeof x !== "object" || depth > 4) return false;
  const m = x as Record<string, unknown>;
  if (typeof m.id !== "string" || typeof m.fallback !== "string") return false;
  if (m.values === undefined) return true;
  if (!m.values || typeof m.values !== "object") return false;
  return Object.values(m.values as Record<string, unknown>).every((v) => typeof v === "string" || typeof v === "number" || isMsg(v, depth + 1));
}

/* ------------------------------------------------------------------ fixed sentences */

let byText: Map<string, BgMessageId> | undefined;

/**
 * The Msg for a fixed English sentence or label the catalog has verbatim (no arguments), else undefined.
 * Lets the many identical fixed strings across families ("To", "Network fee", "That's your own address.",
 * "This transaction can't be read.") be translated without a Msg at every site. Exact match only: text that
 * differs in any way (values, punctuation) stays English.
 */
export function knownMsg(text: string | undefined): Msg | undefined {
  if (!text) return undefined;
  if (!byText) {
    byText = new Map();
    for (const [id, en] of Object.entries(BG_MESSAGES) as [BgMessageId, string][]) if (!/\{/.test(en) && !byText.has(en)) byText.set(en, id);
  }
  const id = byText.get(text);
  return id ? { id, fallback: text } : undefined;
}

/** A line label's Msg: the one attached, else the catalog's fixed label. */
export function lineLabelMsg(line: { label: string; labelMsg?: Msg }): Msg | undefined {
  return current(line.labelMsg, line.label) ?? knownMsg(line.label);
}

/** A line value's Msg: the one attached only (values are data: addresses, amounts, names). */
export function lineValueMsg(line: { value: string; valueMsg?: Msg }): Msg | undefined {
  return current(line.valueMsg, line.value);
}

/** A decoded request's title. */
export function titleMsgOf(d: { title: string; titleMsg?: Msg }): Msg | undefined {
  return current(d.titleMsg, d.title) ?? knownMsg(d.title);
}

/**
 * A Msg only while it still describes `text`: code that rewrites a title (`{ ...d, title: "…" }`) and forgets
 * the Msg must never get the old meaning translated. Every reader goes through this check.
 */
export function current(m: Msg | undefined, text: string): Msg | undefined {
  return m && m.fallback === text ? m : undefined;
}

/** `{ title, titleMsg }` from a Msg, to spread into a DecodedRequest or a step: `{ ...titled(msg("bg.req.stake", { amount })) }`. */
export function titled(m: Msg): { title: string; titleMsg: Msg } {
  return { title: m.fallback, titleMsg: m };
}

/** `{ label, labelMsg }` (and value) for a line whose label has values ("Action 2"). */
export function labelled(m: Msg, value: string): { label: string; labelMsg: Msg; value: string } {
  return { label: m.fallback, labelMsg: m, value };
}

/** A Msg for text that is already final (e.g. written by the UI in the person's language): never re-translated. */
export function finalMsg(text: string): Msg {
  return { id: "", fallback: text };
}
