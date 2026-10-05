import type { DecodedRequest } from "../index.js";
import type { BgMessageId } from "./en/index.js";
import { current, knownMsg, msg, type Msg, type MsgValue } from "./msg.js";

/**
 * Modules that build a title as a string through several helpers (a list of action titles, a ternary chain,
 * `out(title, …)`) can't easily carry a Msg alongside it. `say()` returns the English string as before and
 * remembers which Msg produced it; the background then attaches the Msg to the DecodedRequest by that exact
 * text (`attachMsgs`, run right after decode). The memory is bounded and only holds text the wallet's own
 * modules produced, so a dapp can't plant a translation.
 */
const MAX = 2000;
const remembered = new Map<string, Msg>();

export function remember(m: Msg): Msg {
  if (!m.id) return m;
  remembered.delete(m.fallback);
  remembered.set(m.fallback, m);
  if (remembered.size > MAX) remembered.delete(remembered.keys().next().value!);
  return m;
}

/** The English string of a Msg, remembered so `attachMsgs` can find the Msg again. */
export function say(id: BgMessageId, values?: Record<string, MsgValue | bigint>, fallback?: string): string {
  return remember(msg(id, values, fallback)).fallback;
}

/** The Msg that produced this exact text, if a module said it recently. */
export function recallMsg(text: string | undefined): Msg | undefined {
  return text === undefined ? undefined : remembered.get(text);
}

/**
 * Fills titleMsg, line labelMsg/valueMsg (only values that are titles the modules said, never a dapp's
 * message text: lines labelled "Message"/"Data" are skipped) and Warning.msg from what modules said.
 * Never replaces a Msg that is already there.
 */
export function attachMsgs<T extends Pick<DecodedRequest, "title" | "titleMsg" | "lines" | "warnings">>(d: T): T {
  const out = { ...d };
  const t = current(out.titleMsg, out.title) ?? recallMsg(out.title);
  if (t) out.titleMsg = nestRecalled(t);
  else delete out.titleMsg;
  out.lines = out.lines.map((l) => {
    const labelMsg = current(l.labelMsg, l.label) ?? recallMsg(l.label);
    // Values are data, except fixed sentences the modules wrote; a dapp's own text (message, data, memo) never.
    const valueMsg = current(l.valueMsg, l.value) ?? (/^(Message|Data|Note|Memo|Comment|Statement|Arguments|Value|Type)/.test(l.label) ? undefined : (recallMsg(l.value) ?? knownMsg(l.value)));
    return labelMsg || valueMsg ? { ...l, ...(labelMsg ? { labelMsg } : {}), ...(valueMsg ? { valueMsg } : {}) } : l;
  });
  out.warnings = out.warnings.map((w) => {
    const found = current(w.msg, w.message) ?? recallMsg(w.message);
    const m = found && nestRecalled(found);
    if (m === w.msg) return w;
    const { msg: _stale, ...rest } = w;
    return m ? { ...rest, msg: m } : rest;
  });
  return out;
}

/**
 * String values that are themselves text a module said (e.g. "app.example (unverified)" as the {host} of a
 * title) become nested Msgs, so the whole title translates. Returns the same object when nothing changes.
 */
function nestRecalled(m: Msg, depth = 0): Msg {
  if (!m.values || depth > 3) return m;
  let changed = false;
  const values: Record<string, MsgValue> = {};
  for (const [k, v] of Object.entries(m.values)) {
    const inner = typeof v === "string" ? recallMsg(v) : typeof v === "object" ? nestRecalled(v, depth + 1) : undefined;
    values[k] = inner ?? v;
    if (inner && inner !== v) changed = true;
  }
  return changed ? { ...m, values } : m;
}
