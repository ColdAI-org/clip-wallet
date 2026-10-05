/**
 * Translation QA checks that go beyond `checkTranslation` (same ids, variables, tags): plural categories,
 * rendering with every plausible value, bidi isolation for right-to-left languages, and glossary
 * consistency. Test-only: import from "@clip-wallet/i18n/qa", never from app code.
 */
import { formatMessage, parseMessage, type MessageValues } from "../message.js";
import type { CatalogProblem, Messages } from "../translator.js";

/** First Strong Isolate / Pop Directional Isolate (https://www.unicode.org/reports/tr9/#Explicit_Directional_Isolates). */
export const FSI = "⁨";
export const PDI = "⁩";

type AnyNode = { t: string; name?: string; fmt?: string; v?: string; options?: Record<string, AnyNode[]> };

function walk(nodes: AnyNode[], visit: (n: AnyNode) => void) {
  for (const n of nodes) {
    visit(n);
    if (n.options) for (const o of Object.values(n.options)) walk(o, visit);
  }
}

/** Plural and select arguments with their option keys, and which arguments are plain values. */
function shape(message: string) {
  const plurals = new Map<string, Set<string>>();
  const selects = new Map<string, Set<string>>();
  const plain = new Set<string>();
  walk(parseMessage(message) as AnyNode[], (n) => {
    if (n.t === "plural") plurals.set(n.name!, new Set([...(plurals.get(n.name!) ?? []), ...Object.keys(n.options!)]));
    else if (n.t === "select") selects.set(n.name!, new Set([...(selects.get(n.name!) ?? []), ...Object.keys(n.options!)]));
    else if (n.t === "arg") plain.add(n.name!);
  });
  return { plurals, selects, plain };
}

/** Counts that exercise every plural category in every shipped language (0, 1, 2, few, many, fractions, large). */
export const SAMPLE_COUNTS = [0, 1, 2, 3, 5, 11, 12, 21, 22, 100, 101, 1.5, 1000000];

/** Plural categories that change the grammar enough that `other` is not an acceptable fallback. */
const REQUIRED_CATEGORIES: Record<string, readonly string[]> = {
  // Arabic: 3–10 take a plural noun, 11–99 a singular accusative; "other" (100+, singular genitive) is wrong for both.
  ar: ["one", "few", "many", "other"],
};

/**
 * Lints one translated message against its English source:
 *   - plural option keys are categories this language has (or exact "=n" matches);
 *   - the categories whose grammar differs from "other" are present (Arabic few/many);
 *   - every select key English uses is still there;
 *   - it renders for every sample count and select key with nothing left as "{name}" or a stray "#".
 */
export function lintMessage(en: string, message: string, locale: string, id = ""): CatalogProblem[] {
  const out: CatalogProblem[] = [];
  let tr: ReturnType<typeof shape>;
  let src: ReturnType<typeof shape>;
  try {
    src = shape(en);
    tr = shape(message);
  } catch (e) {
    return [{ locale, id, problem: "syntax", detail: String(e) }];
  }
  const cats = new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
  for (const [name, keys] of tr.plurals) {
    const bad = [...keys].filter((k) => !k.startsWith("=") && !cats.includes(k));
    if (bad.length) out.push({ locale, id, problem: "plural", detail: `{${name}} has categories ${locale} doesn't use: ${bad.join(", ")}` });
    const missing = (REQUIRED_CATEGORIES[locale] ?? []).filter((c) => !keys.has(c));
    if (missing.length) out.push({ locale, id, problem: "plural", detail: `{${name}} needs ${missing.join(", ")}` });
    for (const k of src.plurals.get(name) ?? []) {
      if (k.startsWith("=") && !keys.has(k)) out.push({ locale, id, problem: "plural", detail: `{${name}} dropped ${k}` });
    }
  }
  for (const [name, keys] of src.selects) {
    const mine = tr.selects.get(name);
    for (const k of keys) if (!mine?.has(k)) out.push({ locale, id, problem: "select", detail: `{${name}} dropped "${k}"` });
  }
  const base: MessageValues = {};
  for (const n of [...src.plain, ...tr.plain]) base[n] = `‹${n}›`;
  const selectKeys = [...tr.selects].map(([name, keys]) => [name, [...keys]] as const);
  const samples: MessageValues[] = [];
  for (const count of tr.plurals.size ? SAMPLE_COUNTS : [1]) {
    const v: MessageValues = { ...base };
    for (const name of tr.plurals.keys()) v[name] = count;
    if (!selectKeys.length) samples.push(v);
    for (const [name, keys] of selectKeys) for (const k of keys) samples.push({ ...v, [name]: k === "other" ? "__other__" : k });
  }
  for (const v of samples) {
    let s: string;
    try {
      s = formatMessage(message, v, locale);
    } catch (e) {
      out.push({ locale, id, problem: "render", detail: String(e) });
      break;
    }
    const left = /\{[A-Za-z0-9_]+\}/.exec(s);
    if (left) {
      out.push({ locale, id, problem: "render", detail: `${left[0]} left unformatted with ${JSON.stringify(v)}` });
      break;
    }
  }
  // "#" only means "the number" inside a plural branch; anywhere else it is printed literally.
  const literalHash = (parseMessage(message) as AnyNode[]).some((n) => n.t === "text" && n.v!.includes("#")) && !(parseMessage(en) as AnyNode[]).some((n) => n.t === "text" && n.v!.includes("#"));
  if (literalHash) out.push({ locale, id, problem: "render", detail: `literal "#" outside a plural` });
  return out;
}

/** Lints every message of a translation (see `lintMessage`). */
export function lintCatalog(en: Messages, other: Messages, locale: string): CatalogProblem[] {
  return Object.keys(en).flatMap((id) => (other[id] === undefined ? [] : lintMessage(en[id]!, other[id]!, locale, id)));
}

/**
 * Value arguments ({name}, {n, number}) that are not inside a First Strong Isolate … Pop Directional Isolate
 * pair. In a right-to-left sentence an un-isolated value can reorder its neighbours: "@alex" shows as
 * "alex@", "-5 USDC" loses its sign's position, a Latin name next to a number swaps sides.
 * Plural "#" is a bare number and needs no isolate. Also reports unbalanced isolates.
 */
export function unisolatedArguments(message: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  // Walk the raw source: braces of plural/select options are structure, value arguments are "{name}" or "{name, number}".
  const valueArg = /^\{\s*([A-Za-z0-9_]+)\s*(,\s*number\s*)?\}/;
  while (i < message.length) {
    const c = message[i]!;
    if (c === FSI) depth++;
    else if (c === PDI) {
      depth--;
      if (depth < 0) {
        out.push("(unbalanced isolate)");
        depth = 0;
      }
    } else if (c === "{") {
      const m = valueArg.exec(message.slice(i));
      if (m) {
        if (depth === 0) out.push(m[1]!);
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  if (depth !== 0) out.push("(unbalanced isolate)");
  return out;
}

export interface GlossaryEntry {
  /** The English term, matched case-insensitively on word boundaries in the English message. */
  en: string;
  /** What every translation of a message using the term must contain (a regex source, case-insensitive). */
  tr: string;
  /** Message ids where the English term is used in another sense (e.g. "Trade" as a verb in a category name). */
  except?: readonly string[];
}

/**
 * Same English term → same translation everywhere: for each glossary entry, every message whose English uses
 * the term must use the glossary translation.
 */
export function checkGlossary(en: Messages, other: Messages, locale: string, glossary: readonly GlossaryEntry[]): CatalogProblem[] {
  const out: CatalogProblem[] = [];
  for (const g of glossary) {
    const enRe = new RegExp(`(^|[^\\p{L}])${g.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
    const trRe = new RegExp(g.tr, "iu");
    for (const [id, m] of Object.entries(en)) {
      if (!enRe.test(m) || g.except?.includes(id)) continue;
      const t = other[id];
      if (t !== undefined && !trRe.test(t)) out.push({ locale, id, problem: "glossary", detail: `"${g.en}" → /${g.tr}/: ${t}` });
    }
  }
  return out;
}
