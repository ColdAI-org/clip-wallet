/**
 * Notification translation QA (docs/i18n/review-2026-10.md): plurals and values render in every language,
 * glossary terms match the UI and mobile catalogs, and Arabic isolates interpolated values.
 */
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, parseMessage } from "@clip-wallet/i18n";
import { GLOSSARIES, checkGlossary, lintCatalog, unisolatedArguments } from "@clip-wallet/i18n/qa";
import { NOTIFICATION_CATALOGS } from "../src/index.js";
import en from "../src/notifications/locales/en.js";

describe("notification translation QA", () => {
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    const cat = NOTIFICATION_CATALOGS[code] as Record<string, string>;
    it(`${code}: parses, renders, follows the glossary`, () => {
      for (const [id, m] of Object.entries(cat)) expect(() => parseMessage(m), id).not.toThrow();
      expect(lintCatalog(en, cat, code)).toEqual([]);
      expect(checkGlossary(en, cat, code, GLOSSARIES[code])).toEqual([]);
    });
  }
  it("ar: every interpolated value sits in a bidi isolate", () => {
    const ar = NOTIFICATION_CATALOGS.ar as Record<string, string>;
    expect(Object.entries(ar).flatMap(([id, m]) => unisolatedArguments(m).map((a) => `${id}: ${a}`))).toEqual([]);
  });
});
