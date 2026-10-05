/**
 * Background text (approval titles, line labels, warnings, errors, activity, step titles) in the person's
 * language. The background sends English plus a structured Msg (@clip-wallet/core); this renders the Msg
 * through the background catalog (@clip-wallet/core BG_LOCALE_LOADERS, lazily loaded per language). English,
 * a language still loading, or an id without a translation show the module's exact English.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { errorMsg, lineLabelMsg, lineValueMsg, loadBgMessages, titleMsgOf, warningMsg, type BgTranslation, type Msg, type Warning } from "@clip-wallet/core";
import { formatMsg } from "@clip-wallet/i18n";
import { useLocale } from "@clip-wallet/i18n/react";

export interface BgText {
  locale: string;
  /** A Msg in the current language (its English when there is none). */
  msg(m: Msg | undefined, fallback?: string): string;
  /** True when `m` would render as a translation (not its English fallback). */
  translates(m: Msg | undefined): boolean;
  title(d: { title: string; titleMsg?: Msg }): string;
  label(line: { label: string; labelMsg?: Msg }): string;
  value(line: { value: string; valueMsg?: Msg }): string;
  /** A warning's text, and the module's English when the text is only the code's general message. */
  warning(w: Warning): { text: string; detail?: string };
  /** An error's text (thrown ClipError or a bus error with userMessage/code/msg), or undefined. */
  error(err: unknown): string | undefined;
}

function makeBgText(messages: BgTranslation | undefined, locale: string): BgText {
  const msgs = messages as Readonly<Record<string, string>> | undefined;
  const translates = (m: Msg | undefined) => !!m && locale !== "en" && !!msgs && msgs[m.id] !== undefined;
  const msg = (m: Msg | undefined, fallback = "") => (m ? formatMsg(m, msgs, locale) : fallback);
  return {
    locale,
    msg,
    translates,
    title: (d) => msg(titleMsgOf(d), d.title),
    label: (l) => msg(lineLabelMsg(l), l.label),
    value: (l) => msg(lineValueMsg(l), l.value),
    warning: (w) => {
      const m = warningMsg(w);
      if (!translates(m)) return { text: w.message };
      return m.approx ? { text: msg(m), detail: w.message } : { text: msg(m) };
    },
    error: (err) => {
      const m = errorMsg(err);
      return m ? msg(m) : undefined;
    },
  };
}

/* Errors are turned into text in event handlers all over the UI (userMessageOf), outside React: the provider
   keeps the current renderer here. */
let current: BgText = makeBgText(undefined, "en");
export function currentBgText(): BgText {
  return current;
}

const BgTextContext = createContext<BgText>(current);

/** Loads the background catalog for the current locale. Sits inside LocaleProvider (ClipProvider does it). */
export function BgTextProvider(props: { children: ReactNode }) {
  const { locale } = useLocale();
  const [loaded, setLoaded] = useState<{ locale: string; messages: BgTranslation | undefined }>({ locale: "en", messages: undefined });
  useEffect(() => {
    if (locale === "en") return;
    let live = true;
    void loadBgMessages(locale).then(
      (messages) => live && setLoaded({ locale, messages }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [locale]);
  const value = useMemo(() => makeBgText(loaded.locale === locale ? loaded.messages : undefined, locale), [loaded, locale]);
  current = value;
  return <BgTextContext.Provider value={value}>{props.children}</BgTextContext.Provider>;
}

export function useBgText(): BgText {
  return useContext(BgTextContext);
}
