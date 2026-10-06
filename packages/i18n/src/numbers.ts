/**
 * Locale-aware numbers for money. Amounts stay exact: token amounts are bigint base units end to end, and
 * only the presentation (grouping, decimal mark, currency placement) follows the locale.
 *
 * Arabic uses Latin digits ("ar-u-nu-latn"): addresses, amounts and fees then read the same way across the
 * app and on block explorers; typing Arabic-Indic digits is still accepted.
 */

/** The Intl locale for numbers: Latin digits everywhere. */
export function numberLocale(locale: string): string {
  const ext = locale.indexOf("-u-");
  if (ext >= 0 && locale.indexOf("nu-", ext + 3) >= 0) return locale; // a numbering system is already chosen
  return locale.split("-")[0] === "ar" ? `${locale}-u-nu-latn` : locale;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(numberLocale(locale), opts);
    } catch {
      f = new Intl.NumberFormat("en-US", opts);
    }
    nfCache.set(key, f);
  }
  return f;
}

export interface Separators {
  decimal: string;
  group: string;
}

export function separators(locale: string): Separators {
  const parts = nf(locale, { minimumFractionDigits: 1, useGrouping: true }).formatToParts(12345.6);
  return {
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    group: parts.find((p) => p.type === "group")?.value ?? ",",
  };
}

/** Fiat value in a currency, e.g. "$1,234.50", "1.234,50 €", "¥1,235". Negative values use a true minus. */
export function formatFiat(value: number | undefined, currency: string, locale = "en", opts?: { signed?: boolean }): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  let digits: number;
  try {
    digits = nf(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  const s = nf(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    // Tiny values keep 4 decimals so "$0.0042" doesn't round to "$0.00".
    maximumFractionDigits: abs > 0 && abs < 0.01 ? Math.max(4, digits) : digits,
  }).format(abs);
  if (opts?.signed) return `${value < 0 ? "−" : "+"}${s}`;
  return value < 0 ? `−${s}` : s;
}

/** A plain number ("1,234.5", "1.234,5", "1 234,5"). */
export function formatNumber(value: number, locale = "en", opts: Intl.NumberFormatOptions = {}): string {
  return nf(locale, opts).format(value);
}

/** "12.5 %" style percent from a percentage number (12.5 → "12.5%"). */
export function formatPercent(pct: number, locale = "en", opts: { signed?: boolean; maxFraction?: number } = {}): string {
  const s = nf(locale, { style: "percent", maximumFractionDigits: opts.maxFraction ?? 2, signDisplay: opts.signed ? "exceptZero" : "auto" }).format(pct / 100);
  return s.replace("-", "−");
}

/** Base units (decimal string or bigint) → human amount, grouped for the locale, trailing zeros trimmed. */
export function formatAmount(amount: string | bigint, decimals: number, maxFraction = 6, locale = "en"): string {
  let v = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = (v % base).toString().padStart(decimals, "0").slice(0, Math.min(decimals, maxFraction)).replace(/0+$/, "");
  const sep = separators(locale);
  const wholeStr = nf(locale, { useGrouping: true, maximumFractionDigits: 0 }).format(whole);
  return `${neg ? "−" : ""}${wholeStr}${frac ? `${sep.decimal}${frac}` : ""}`;
}

/**
 * What an amount field should hold for a balance ("Max"): no grouping, the locale's decimal mark, every
 * significant digit. `parseAmountInput` reads it back exactly.
 */
export function amountInputFromUnits(amount: string | bigint, decimals: number, locale = "en"): string {
  const v = typeof amount === "bigint" ? amount : BigInt(amount || "0");
  const base = 10n ** BigInt(decimals);
  const frac = (v % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? `${separators(locale).decimal}${frac}` : ""}`;
}

const DIGITS: Record<string, string> = {};
for (let d = 0; d < 10; d++) {
  DIGITS[String.fromCharCode(0x0660 + d)] = String(d); // Arabic-Indic
  DIGITS[String.fromCharCode(0x06f0 + d)] = String(d); // Extended Arabic-Indic (Persian/Urdu keyboards)
  DIGITS[String.fromCharCode(0x0966 + d)] = String(d); // Devanagari
  DIGITS[String.fromCharCode(0xff10 + d)] = String(d); // Full-width (Japanese/Chinese IMEs)
}

/**
 * The canonical form of a typed amount ("1234.5"), or null if it isn't a plain positive number.
 *
 * Money rule: a separator is only ever read as grouping when it sits in valid grouping positions
 * (1,234,567 / 1.234.567), so "0,5" is half in every locale and never 5. When the locale's own decimal mark
 * is present, the other mark must be valid grouping or the input is rejected (no guessing).
 */
export function canonicalAmountInput(input: string, locale = "en"): string | null {
  let s = input
    .trim()
    .replace(/[٠-٩۰-۹०-९０-９]/g, (c) => DIGITS[c] ?? c)
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/．/g, ".")
    .replace(/[٬，]/g, ",") // Arabic thousands separator, full-width comma
    .replace(/[\s  '’]/g, ""); // space-like and apostrophe group marks (fr, de-CH)
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const dec = separators(locale).decimal === "," ? "," : ".";
  const other = dec === "," ? "." : ",";
  const groupedOk = (x: string, mark: string) => new RegExp(`^\\d{1,3}(\\${mark}\\d{3})+(\\${dec === mark ? other : dec}\\d*)?$`).test(x);

  const decCount = s.split(dec).length - 1;
  const otherCount = s.split(other).length - 1;
  if (decCount > 1) {
    // "1.234.567" in a "."-decimal locale is still grouping if positions are valid and no other mark is used.
    if (otherCount === 0 && groupedOk(s, dec)) return stripZeros(s.split(dec).join(""));
    return null;
  }
  if (otherCount > 0) {
    if (groupedOk(s, other)) s = s.split(other).join("");
    else if (decCount === 0 && otherCount === 1) s = s.replace(other, dec); // "0.5" typed in a ","-decimal locale
    else return null;
  }
  const [w = "", f] = s.split(dec);
  if (f === undefined) return stripZeros(w);
  if (w === "" && f === "") return null;
  return `${stripZeros(w || "0")}${f ? `.${f}` : ""}`;
}

function stripZeros(w: string): string {
  return w.replace(/^0+(?=\d)/, "");
}

/** Typed amount → base units, or null when invalid or more precise than the asset allows. */
export function parseAmountInput(input: string, decimals: number, locale = "en"): bigint | null {
  const c = canonicalAmountInput(input, locale);
  if (c === null) return null;
  const [w = "0", f = ""] = c.split(".");
  if (f.length > decimals) return null;
  return BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Relative time in words ("2 minutes ago", "vor 2 Minuten"), via Intl.RelativeTimeFormat. */
export function formatRelativeTime(ts: number, locale = "en", now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(numberLocale(locale), { numeric: "auto" });
  } catch {
    rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.trunc(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.trunc(s / 3600), "hour");
  return rtf.format(Math.trunc(s / 86400), "day");
}
