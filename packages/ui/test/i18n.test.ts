/**
 * Translation guards: every shipped language translates exactly the English ids, with the same variables and
 * rich-text tags, keeps protected terms (brand, symbols) verbatim, and no UI source hard-codes English.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_CODES, checkTranslation, loadCatalog, parseMessage } from "@clip-wallet/i18n";
import { PROTECTED_TERMS, UI_CATALOGS } from "../src/i18n";
import { en } from "../src/i18n/en";

const SRC = join(__dirname, "../src");

describe("UI catalogs", () => {
  it("English parses and ids are namespaced", () => {
    for (const [id, msg] of Object.entries(en)) {
      expect(id).toMatch(/^[a-z]+\.[A-Za-z0-9.]+$/);
      expect(() => parseMessage(msg), id).not.toThrow();
    }
  });

  it("every shipped language is registered", () => {
    expect(Object.keys(UI_CATALOGS).sort()).toEqual([...LOCALE_CODES].sort());
  });

  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    it(`${code}: complete, same variables and tags, protected terms kept`, async () => {
      const cat = await loadCatalog(UI_CATALOGS, code);
      expect(cat).not.toBe(UI_CATALOGS.en);
      const problems = checkTranslation(en, cat as Record<string, string>, code, PROTECTED_TERMS);
      expect(problems).toEqual([]);
      // Untranslated copies of English (beyond short shared words like "OK") would be a missed translation.
      const same = Object.entries(en).filter(([id, m]) => (cat as Record<string, string>)[id] === m && /[a-z]{4,} [a-z]{4,}/.test(m));
      expect(same.length, `${code} has ${same.length} untranslated sentences: ${same.slice(0, 5).map(([id]) => id).join(", ")}`).toBeLessThanOrEqual(3);
    });
  }
});

/** Text a user could read, written straight into JSX or a UI attribute. */
function hardCoded(file: string): string[] {
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/<[A-Za-z]+<[^>]*>>/g, "");
  const out: string[] = [];
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/>([^<>{}=]*[A-Za-z]{2,}[^<>{}]*)</g)) {
      const t = m[1]!.trim();
      if (t && !ALLOWED_TEXT.has(t) && !/^(Promise|[A-Z][A-Za-z]+Props)$/.test(t) && !/&&/.test(t)) out.push(`${i + 1}: ${t}`);
    }
    for (const m of line.matchAll(/\b(label|placeholder|aria-label|title|alt|description|hint)="([^"]*[A-Za-z]{2,}[^"]*)"/g)) {
      if (!ALLOWED_ATTR.has(m[2]!) && !/^[a-z]+\.[a-zA-Z.]+$/.test(m[2]!)) out.push(`${i + 1}: ${m[1]}="${m[2]}"`);
    }
    // A line that is only words (multi-line JSX text).
    if (/^\s+[A-Z][a-zA-Z'’]+([ ,][a-zA-Z'’,]+)*[.!?…:]?\s*$/.test(line) && !ALLOWED_TEXT.has(line.trim())) out.push(`${i + 1}: ${line.trim()}`);
  });
  return out;
}

/** Brand and device names, technical placeholders: never translated. */
const ALLOWED_TEXT = new Set(["Ledger", "Keystone"]);
const ALLOWED_ATTR = new Set(["wc:…", "@alex", "https://", "0x…"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "i18n" ? [] : tsxFiles(p);
    return p.endsWith(".tsx") ? [p] : [];
  });
}

describe("no hard-coded English in UI sources", () => {
  for (const file of tsxFiles(SRC)) {
    it(file.slice(SRC.length + 1), () => {
      expect(hardCoded(file)).toEqual([]);
    });
  }
});
