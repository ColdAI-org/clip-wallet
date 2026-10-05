/**
 * Translation QA (docs/i18n/review-2026-10.md): every message parses and renders with every plausible value
 * in its language, glossary terms are translated the same way as in the UI and notification catalogs, and
 * Arabic isolates every interpolated value so right-to-left text can't reorder it.
 */
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, parseMessage } from "@clip-wallet/i18n";
import { GLOSSARIES, checkGlossary, lintCatalog, unisolatedArguments } from "@clip-wallet/i18n/qa";
import { en } from "../src/i18n/en";
import { MOBILE_CATALOGS } from "../src/i18n";

/** Share-sheet text: the link must stay a bare URL so messaging apps can linkify it. */
const NOT_ISOLATED: Record<string, readonly string[]> = { "m.trade.share.android": ["link"] };

describe("mobile translation QA", () => {
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    const cat = MOBILE_CATALOGS[code] as Record<string, string>;
    it(`${code}: every message parses and renders (plurals, selects, values)`, () => {
      for (const [id, m] of Object.entries(cat)) expect(() => parseMessage(m), id).not.toThrow();
      expect(lintCatalog(en, cat, code)).toEqual([]);
    });
    it(`${code}: glossary terms match the shared glossary`, () => {
      expect(checkGlossary(en, cat, code, GLOSSARIES[code])).toEqual([]);
    });
  }
  it("ar: every interpolated value sits in a bidi isolate", () => {
    const ar = MOBILE_CATALOGS.ar as Record<string, string>;
    const bad = Object.entries(ar).flatMap(([id, m]) => unisolatedArguments(m).filter((a) => !NOT_ISOLATED[id]?.includes(a)).map((a) => `${id}: ${a}`));
    expect(bad).toEqual([]);
  });
});
