/**
 * A small ICU MessageFormat subset (https://unicode-org.github.io/icu/userguide/format_parse/messages/),
 * enough for wallet copy and no more:
 *
 *   {name}                                   a value, as text
 *   {count, number}                          a number, formatted for the locale
 *   {count, plural, =0 {…} one {…} other {…}} plural categories from Intl.PluralRules; "#" is the number
 *   {kind, select, send {…} other {…}}       pick by string
 *
 * Differences from full ICU, on purpose: apostrophes are plain text (no ICU quoting, so "You'll" just works),
 * and there are no date/time/ordinal arguments. Tags such as <b>…</b> pass through untouched; the React
 * helper turns them into elements.
 */

import { numberLocale } from "./numbers.js";

type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string; fmt?: "number" }
  | { t: "plural"; name: string; offset: number; options: Record<string, Node[]> }
  | { t: "select"; name: string; options: Record<string, Node[]> }
  | { t: "hash" };

export type MessageValues = Record<string, string | number | bigint | boolean | null | undefined>;

export class MessageSyntaxError extends Error {}

const cache = new Map<string, Node[]>();

export function parseMessage(src: string): Node[] {
  const hit = cache.get(src);
  if (hit) return hit;
  let i = 0;

  function parseNodes(inPlural: boolean, endOnBrace: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push({ t: "text", v: text });
      text = "";
    };
    while (i < src.length) {
      const c = src[i]!;
      if (c === "{") {
        flush();
        i++;
        out.push(parseArg());
      } else if (c === "}") {
        if (!endOnBrace) throw new MessageSyntaxError(`Unexpected "}" at ${i} in "${src}"`);
        break;
      } else if (c === "#" && inPlural) {
        flush();
        out.push({ t: "hash" });
        i++;
      } else {
        text += c;
        i++;
      }
    }
    flush();
    return out;
  }

  function skipWs() {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  }

  function word(): string {
    skipWs();
    const m = /^[^\s,{}]+/.exec(src.slice(i));
    if (!m) throw new MessageSyntaxError(`Expected a name at ${i} in "${src}"`);
    i += m[0].length;
    skipWs();
    return m[0];
  }

  function expect(ch: string) {
    skipWs();
    if (src[i] !== ch) throw new MessageSyntaxError(`Expected "${ch}" at ${i} in "${src}"`);
    i++;
  }

  function parseOptions(inPlural: boolean): Record<string, Node[]> {
    const options: Record<string, Node[]> = {};
    skipWs();
    while (i < src.length && src[i] !== "}") {
      const key = word();
      expect("{");
      options[key] = parseNodes(inPlural, true);
      expect("}");
      skipWs();
    }
    if (!("other" in options)) throw new MessageSyntaxError(`Missing "other" option in "${src}"`);
    return options;
  }

  function parseArg(): Node {
    const name = word();
    if (src[i] === "}") {
      i++;
      return { t: "arg", name };
    }
    expect(",");
    const type = word();
    if (type === "number") {
      expect("}");
      return { t: "arg", name, fmt: "number" };
    }
    if (type !== "plural" && type !== "select") throw new MessageSyntaxError(`Unsupported argument type "${type}" in "${src}"`);
    expect(",");
    let offset = 0;
    skipWs();
    const off = /^offset:(\d+)/.exec(src.slice(i));
    if (type === "plural" && off) {
      offset = Number(off[1]);
      i += off[0].length;
    }
    const options = parseOptions(type === "plural");
    expect("}");
    return type === "plural" ? { t: "plural", name, offset, options } : { t: "select", name, options };
  }

  const nodes = parseNodes(false, false);
  if (i !== src.length) throw new MessageSyntaxError(`Unexpected "}" at ${i} in "${src}"`);
  cache.set(src, nodes);
  return nodes;
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: string, n: number): string {
  let r = pluralRules.get(locale);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules("en");
    }
    pluralRules.set(locale, r);
  }
  return r.select(n);
}

/** Numbers in messages ("#", "{n, number}") use the same digits as amounts: Latin digits in Arabic too. */
function numberText(locale: string, v: unknown): string {
  locale = numberLocale(locale);
  if (typeof v === "bigint") return v.toLocaleString(locale);
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(n);
  } catch {
    return String(n);
  }
}

function render(nodes: Node[], values: MessageValues, locale: string, pluralValue?: number): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += n.v;
        break;
      case "hash":
        out += pluralValue === undefined ? "#" : numberText(locale, pluralValue);
        break;
      case "arg": {
        const v = values[n.name];
        if (v === undefined || v === null) out += `{${n.name}}`;
        else out += n.fmt === "number" ? numberText(locale, v) : String(v);
        break;
      }
      case "plural": {
        const raw = Number(values[n.name] ?? 0);
        const value = raw - n.offset;
        const branch = n.options[`=${raw}`] ?? n.options[pluralCategory(locale, value)] ?? n.options.other!;
        out += render(branch, values, locale, value);
        break;
      }
      case "select": {
        const key = String(values[n.name] ?? "other");
        out += render(n.options[key] ?? n.options.other!, values, locale, pluralValue);
        break;
      }
    }
  }
  return out;
}

/** Formats one message. Unknown values render as "{name}" so a missing variable is visible, never blank. */
export function formatMessage(message: string, values: MessageValues = {}, locale = "en"): string {
  return render(parseMessage(message), values, locale);
}

/**
 * The argument names a message uses (plain, number, plural and select), for checking that every translation
 * uses the same variables as English.
 */
export function messageArguments(message: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.t === "arg") names.add(n.name);
      if (n.t === "plural" || n.t === "select") {
        names.add(n.name);
        for (const o of Object.values(n.options)) walk(o);
      }
    }
  };
  walk(parseMessage(message));
  return [...names].sort();
}

/** The tag names used for rich text ("<b>…</b>" → "b"). */
export function messageTags(message: string): string[] {
  return [...new Set([...message.matchAll(/<([a-z][a-z0-9]*)>/gi)].map((m) => m[1]!))].sort();
}
