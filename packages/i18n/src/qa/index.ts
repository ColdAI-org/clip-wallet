/** Test-only translation QA helpers (not for app bundles). */
import type { LocaleCode } from "../locales.js";
import type { GlossaryEntry } from "./lint.js";
import de from "./glossary/de.js";
import fr from "./glossary/fr.js";
import es from "./glossary/es.js";
import pt_BR from "./glossary/pt-BR.js";
import it from "./glossary/it.js";
import tr from "./glossary/tr.js";
import ja from "./glossary/ja.js";
import ko from "./glossary/ko.js";
import zh_Hans from "./glossary/zh-Hans.js";
import ar from "./glossary/ar.js";
import hi from "./glossary/hi.js";

export * from "./lint.js";

/**
 * Per language, the terms whose translation must be identical across the UI, mobile and notification
 * catalogs. Each package's i18n test checks its own catalog against these same tables.
 */
export const GLOSSARIES: Record<Exclude<LocaleCode, "en">, readonly GlossaryEntry[]> = {
  "de": de,
  "fr": fr,
  "es": es,
  "pt-BR": pt_BR,
  "it": it,
  "tr": tr,
  "ja": ja,
  "ko": ko,
  "zh-Hans": zh_Hans,
  "ar": ar,
  "hi": hi,
};
