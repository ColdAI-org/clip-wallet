/**
 * Renders a structured message from the background ({ id, values, fallback }, @clip-wallet/core's Msg) in a
 * locale. Structural on purpose: this package has no dependencies.
 *
 * English (and any locale without the id) shows `fallback`, the module's exact English. Otherwise the
 * locale's message for `id`, with values (a value may itself be a message, rendered the same way). A broken
 * translation falls back to the English, never to a blank or an id.
 */
import { formatMessage, type MessageValues } from "./message.js";

export interface MsgLike {
  id: string;
  values?: Record<string, string | number | MsgLike>;
  fallback: string;
}

export function formatMsg(m: MsgLike, messages: Readonly<Record<string, string>> | undefined, locale: string): string {
  if (locale === "en" || !messages) return m.fallback;
  const template = messages[m.id];
  if (template === undefined) return m.fallback;
  const values: MessageValues = {};
  for (const [k, v] of Object.entries(m.values ?? {})) values[k] = typeof v === "object" ? formatMsg(v, messages, locale) : v;
  try {
    return formatMessage(template, values, locale);
  } catch {
    return m.fallback;
  }
}
