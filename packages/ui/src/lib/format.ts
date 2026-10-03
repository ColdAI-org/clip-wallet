/**
 * Formatting helpers. Locale-aware through @clip-wallet/i18n: ClipProvider (and the mobile WalletProvider)
 * set the display locale with setFormatLocale, so existing call sites format for the user's language without
 * threading a locale through every component. Pass `locale` explicitly where it matters (tests, background).
 */
import {
  amountInputFromUnits,
  canonicalAmountInput,
  formatAmount,
  formatFiat as fiatFor,
  formatRelativeTime,
  parseAmountInput,
  type LocaleCode,
} from "@clip-wallet/i18n";

let current: LocaleCode = "en";

/** Sets the locale the helpers below use by default. Called by the providers when the language changes. */
export function setFormatLocale(locale: LocaleCode): void {
  current = locale;
}

export function formatLocale(): LocaleCode {
  return current;
}

/** Base units (decimal string) → human string, grouped for the locale, trimmed. */
export function formatUnits(amount: string | bigint, decimals: number, maxFraction = 6, locale: string = current): string {
  return formatAmount(amount, decimals, maxFraction, locale).replace("−", "-");
}

/**
 * Typed amount → base units. Accepts the locale's decimal mark ("0,5" in German) and valid grouping; returns
 * null when the input is not a plain positive decimal or is more precise than the asset.
 */
export function parseUnits(value: string, decimals: number, locale: string = current): bigint | null {
  return parseAmountInput(value, decimals, locale);
}

/** Typed amount → the canonical "1234.5" the background expects, or null. Always send this, never the raw input. */
export function canonicalAmount(value: string, locale: string = current): string | null {
  return canonicalAmountInput(value, locale);
}

/** What "Max" puts in an amount field: no grouping, the locale's decimal mark, exact. */
export function amountInput(amount: string | bigint, decimals: number, locale: string = current): string {
  return amountInputFromUnits(amount, decimals, locale);
}

export function formatFiat(value: number | undefined, currency: string, opts?: { signed?: boolean; locale?: string }): string {
  return fiatFor(value, currency, opts?.locale ?? current, opts);
}

export function shortAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars + (address.startsWith("0x") ? 2 : 0))}…${address.slice(-chars)}`;
}

/** "5 minutes ago", "vor 5 Minuten", "yesterday" (Intl.RelativeTimeFormat). */
export function relativeTime(ts: number, now = Date.now(), locale: string = current): string {
  return formatRelativeTime(ts, locale, now);
}

/** Message ids for readyIn, in the "common" namespace of the UI catalog. */
export type ReadyIn = { id: "common.readyIn.moment" } | { id: "common.readyIn.seconds"; n: number } | { id: "common.readyIn.minutes"; n: number };

/** How soon something is ready, as a catalog message: t(r.id, r). */
export function readyInMessage(seconds: number): ReadyIn {
  if (seconds <= 3) return { id: "common.readyIn.moment" };
  if (seconds < 60) return { id: "common.readyIn.seconds", n: Math.max(5, Math.round(seconds / 5) * 5) };
  return { id: "common.readyIn.minutes", n: Math.round(seconds / 60) };
}

/** English wording of readyInMessage (background text and older call sites). */
export function readyIn(seconds: number): string {
  const r = readyInMessage(seconds);
  if (r.id === "common.readyIn.moment") return "in a moment";
  if (r.id === "common.readyIn.seconds") return `in about ${r.n} seconds`;
  return `in about ${r.n} minute${r.n === 1 ? "" : "s"}`;
}

/** Hostname of an origin, without "www.". */
export function domainOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return origin;
  }
}
