/**
 * React bindings (web and React Native: no DOM APIs here).
 *
 *   <LocaleProvider locale="de">…</LocaleProvider>
 *   const t = useT(UI_CATALOGS);          t("send.title")
 *   const f = useFormat();                f.fiat(12.5, "EUR"), f.amount(units, 18), f.parseAmount("0,5", 18)
 *   rich(t("x"), { b: (c) => <strong>{c}</strong> })
 *
 * @module
 */
import { Fragment, createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, dirOf, type LocaleCode } from "./locales.js";
import { catalogNow, createTranslator, loadCatalog, type Catalogs, type Messages, type TFunction, type Translation } from "./translator.js";
import { amountInputFromUnits, canonicalAmountInput, formatAmount, formatFiat, formatNumber, formatPercent, formatRelativeTime, parseAmountInput } from "./numbers.js";

interface LocaleValue {
  locale: LocaleCode;
  dir: "ltr" | "rtl";
}

const LocaleContext = createContext<LocaleValue>({ locale: DEFAULT_LOCALE, dir: "ltr" });

export function LocaleProvider(props: { locale: LocaleCode; children: ReactNode }) {
  const value = useMemo<LocaleValue>(() => ({ locale: props.locale, dir: dirOf(props.locale) }), [props.locale]);
  return <LocaleContext.Provider value={value}>{props.children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

/** `t` for a catalog set in the current locale. Shows English until a lazily loaded locale arrives. */
export function useT<M extends Messages>(catalogs: Catalogs<M>): TFunction<M> {
  const { locale } = useLocale();
  const [loaded, setLoaded] = useState<{ locale: LocaleCode; messages: Translation<M> } | null>(null);
  const now = catalogNow(catalogs, locale);
  useEffect(() => {
    if (now) return;
    let live = true;
    void loadCatalog(catalogs, locale).then(
      (messages) => live && setLoaded({ locale, messages }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [catalogs, locale, now]);
  const messages = now ?? (loaded?.locale === locale ? loaded.messages : undefined);
  return useMemo(() => createTranslator(catalogs.en, messages, locale), [catalogs.en, messages, locale]);
}

export interface Formatters {
  locale: LocaleCode;
  fiat(value: number | undefined, currency: string, opts?: { signed?: boolean }): string;
  amount(units: string | bigint, decimals: number, maxFraction?: number): string;
  number(value: number, opts?: Intl.NumberFormatOptions): string;
  percent(pct: number, opts?: { signed?: boolean; maxFraction?: number }): string;
  relative(ts: number, now?: number): string;
  /** Typed amount → base units (null when invalid). */
  parseAmount(input: string, decimals: number): bigint | null;
  /** Typed amount → "1234.5" for the background, or null. */
  canonicalAmount(input: string): string | null;
  /** Balance → what "Max" puts in the field. */
  amountInput(units: string | bigint, decimals: number): string;
}

export function formattersFor(locale: LocaleCode): Formatters {
  return {
    locale,
    fiat: (v, c, o) => formatFiat(v, c, locale, o),
    amount: (u, d, m) => formatAmount(u, d, m, locale),
    number: (v, o) => formatNumber(v, locale, o),
    percent: (p, o) => formatPercent(p, locale, o),
    relative: (ts, now) => formatRelativeTime(ts, locale, now),
    parseAmount: (i, d) => parseAmountInput(i, d, locale),
    canonicalAmount: (i) => canonicalAmountInput(i, locale),
    amountInput: (u, d) => amountInputFromUnits(u, d, locale),
  };
}

export function useFormat(): Formatters {
  const { locale } = useLocale();
  return useMemo(() => formattersFor(locale), [locale]);
}

/**
 * Turns "<b>Alex</b> gets 10 USDC" into elements. Tags are flat (no nesting) and come from the message,
 * never from user data: values are interpolated by `t` before this runs, so escape-free text is safe as
 * React text nodes.
 */
export function rich(text: string, tags: Record<string, (children: string) => ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /<([a-z][a-z0-9]*)>([\s\S]*?)<\/\1>/gi;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const render = tags[m[1]!];
    out.push(<Fragment key={k++}>{render ? render(m[2]!) : m[2]}</Fragment>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
