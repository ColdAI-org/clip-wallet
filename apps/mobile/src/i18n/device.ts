/**
 * The phone's preferred languages, best first (expo-localization getLocales(): the user's language list from
 * iOS Settings / Android system languages; https://docs.expo.dev/versions/latest/sdk/localization/).
 */
import { getLocales } from "expo-localization";

export function deviceLanguages(): string[] {
  try {
    return getLocales().map((l) => l.languageTag);
  } catch {
    return [Intl.DateTimeFormat().resolvedOptions().locale];
  }
}
