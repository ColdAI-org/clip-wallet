/**
 * Translation QA (docs/i18n/review-2026-10.md): every message parses and renders with every plausible value
 * in its language, glossary terms are translated the same way as in the mobile and notification catalogs,
 * and Arabic isolates every interpolated value so right-to-left text can't reorder it.
 */
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, loadCatalog, parseMessage } from "@clip-wallet/i18n";
import { GLOSSARIES, checkGlossary, lintCatalog, unisolatedArguments } from "@clip-wallet/i18n/qa";
import { UI_CATALOGS } from "../src/i18n";
import { en } from "../src/i18n/en";

describe("UI translation QA", () => {
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    it(`${code}: every message parses and renders (plurals, selects, values)`, async () => {
      const cat = (await loadCatalog(UI_CATALOGS, code)) as Record<string, string>;
      for (const [id, m] of Object.entries(cat)) expect(() => parseMessage(m), id).not.toThrow();
      expect(lintCatalog(en, cat, code)).toEqual([]);
    });
    it(`${code}: glossary terms match the shared glossary`, async () => {
      const cat = (await loadCatalog(UI_CATALOGS, code)) as Record<string, string>;
      expect(checkGlossary(en, cat, code, GLOSSARIES[code])).toEqual([]);
    });
  }
  it("ar: every interpolated value sits in a bidi isolate", async () => {
    const ar = (await loadCatalog(UI_CATALOGS, "ar")) as Record<string, string>;
    const bad = Object.entries(ar).flatMap(([id, m]) => unisolatedArguments(m).map((a) => `${id}: ${a}`));
    expect(bad).toEqual([]);
  });
});
