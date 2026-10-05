import { DEFAULT_LOCALE, LOCALE_CODES, type LocaleCode } from "./locales.js";
import { formatMessage, messageArguments, messageTags, type MessageValues } from "./message.js";

/** A flat map of message id → ICU-lite message. Ids are namespaced: "send.title", "settings.language". */
export type Messages = Record<string, string>;

/** A translation of an English catalog: every id, nothing extra (typecheck catches a missing string). */
export type Translation<M extends Messages> = { readonly [K in keyof M]: string };

/** A locale's messages, either bundled or loaded on demand (`() => import("./de")`). */
export type CatalogSource<M extends Messages> = Translation<M> | (() => Promise<Translation<M> | { default: Translation<M> }>);

export type Catalogs<M extends Messages> = { en: M } & Partial<Record<Exclude<LocaleCode, "en">, CatalogSource<M>>>;

export type TFunction<M extends Messages> = (id: keyof M & string, values?: MessageValues) => string;

/**
 * Builds `t` for one locale. Lookup: the locale's message, else English, else the id itself (visible in
 * tests and screenshots, never a crash).
 */
export function createTranslator<M extends Messages>(en: M, messages: Partial<Translation<M>> | undefined, locale: LocaleCode): TFunction<M> {
  return (id, values) => {
    const msg = (messages as Record<string, string> | undefined)?.[id] ?? en[id];
    if (msg === undefined) return id;
    try {
      return formatMessage(msg, values, locale);
    } catch {
      // A broken translation must never hide the English meaning.
      return en[id] !== undefined && msg !== en[id] ? formatMessage(en[id]!, values, locale) : id;
    }
  };
}

/** Resolves a locale's catalog (bundled or lazy). English and unknown locales resolve to English. */
export async function loadCatalog<M extends Messages>(catalogs: Catalogs<M>, locale: LocaleCode): Promise<Translation<M>> {
  if (locale === DEFAULT_LOCALE) return catalogs.en;
  const src = catalogs[locale as Exclude<LocaleCode, "en">];
  if (!src) return catalogs.en;
  if (typeof src !== "function") return src;
  const mod = await src();
  return ("default" in mod && typeof mod.default === "object" ? mod.default : mod) as Translation<M>;
}

/** Synchronous catalog when bundled, else undefined (the provider then loads it). */
export function catalogNow<M extends Messages>(catalogs: Catalogs<M>, locale: LocaleCode): Translation<M> | undefined {
  if (locale === DEFAULT_LOCALE) return catalogs.en;
  const src = catalogs[locale as Exclude<LocaleCode, "en">];
  return src && typeof src !== "function" ? src : undefined;
}

export interface CatalogProblem {
  locale: string;
  id: string;
  problem: "missing" | "extra" | "arguments" | "tags" | "syntax" | "term-dropped" | "empty" | "plural" | "select" | "render" | "glossary";
  detail?: string;
}

/**
 * Structural checks a translation must pass: same ids, same variables, same rich-text tags, parseable, and
 * protected terms (brand, asset symbols) kept verbatim when English has them.
 */
export function checkTranslation(en: Messages, other: Messages, locale: string, protectedTerms: readonly string[] = []): CatalogProblem[] {
  const out: CatalogProblem[] = [];
  for (const id of Object.keys(en)) {
    const m = other[id];
    if (m === undefined) {
      out.push({ locale, id, problem: "missing" });
      continue;
    }
    if (!m.trim() && en[id]!.trim()) out.push({ locale, id, problem: "empty" });
    let a: string[];
    let b: string[];
    try {
      a = messageArguments(en[id]!);
      b = messageArguments(m);
    } catch (e) {
      out.push({ locale, id, problem: "syntax", detail: String(e) });
      continue;
    }
    if (a.join() !== b.join()) out.push({ locale, id, problem: "arguments", detail: `en: ${a.join()} / ${locale}: ${b.join()}` });
    if (messageTags(en[id]!).join() !== messageTags(m).join()) out.push({ locale, id, problem: "tags" });
    for (const term of protectedTerms) if (en[id]!.includes(term) && !m.includes(term)) out.push({ locale, id, problem: "term-dropped", detail: term });
  }
  for (const id of Object.keys(other)) if (!(id in en)) out.push({ locale, id, problem: "extra" });
  return out;
}

export const SHIPPED_LOCALES = LOCALE_CODES;
