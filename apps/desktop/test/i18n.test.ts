/**
 * Desktop strings: every language has every message with the same variables and tags, renders with every value,
 * keeps the shared glossary, and Arabic isolates every interpolated value (same QA as the UI and mobile catalogs).
 */
import { describe, expect, it } from "vitest";
import { LOCALE_CODES, checkTranslation, parseMessage } from "@clip-wallet/i18n";
import { GLOSSARIES, checkGlossary, lintCatalog, unisolatedArguments } from "@clip-wallet/i18n/qa";
import { PROTECTED_TERMS } from "@clip-wallet/ui";
import { DESKTOP_CATALOGS, DESKTOP_EN, desktopT } from "../src/shared/i18n";

describe("desktop translation QA", () => {
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    const cat = DESKTOP_CATALOGS[code] as Record<string, string>;
    it(`${code}: complete, same variables, parses and renders`, () => {
      expect(checkTranslation(DESKTOP_EN, cat, code, PROTECTED_TERMS)).toEqual([]);
      for (const [id, m] of Object.entries(cat)) expect(() => parseMessage(m), id).not.toThrow();
      expect(lintCatalog(DESKTOP_EN, cat, code)).toEqual([]);
    });
    it(`${code}: glossary terms match the shared glossary`, () => {
      expect(checkGlossary(DESKTOP_EN, cat, code, GLOSSARIES[code])).toEqual([]);
    });
  }
  it("ar: every interpolated value sits in a bidi isolate", () => {
    const ar = DESKTOP_CATALOGS.ar as Record<string, string>;
    expect(Object.entries(ar).flatMap(([id, m]) => unisolatedArguments(m).map((a) => `${id}: ${a}`))).toEqual([]);
  });
  it("t() formats with values in the chosen language", () => {
    expect(desktopT("en")("d.menu.quit", { name: "Clip Wallet" })).toBe("Quit Clip Wallet");
    expect(desktopT("de")("d.perm.title", { site: "app.example", permission: "Kamera" })).toBe("app.example möchte Zugriff auf: Kamera");
  });
});
