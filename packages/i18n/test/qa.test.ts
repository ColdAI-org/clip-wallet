import { describe, expect, it } from "vitest";
import { FSI, PDI, checkGlossary, lintMessage, unisolatedArguments } from "../src/qa/index.js";
import { formatMessage } from "../src/index.js";

describe("lintMessage", () => {
  it("accepts a correct translation", () => {
    expect(lintMessage("{n, plural, one {# day} other {# days}}", "{n, plural, one {# Tag} other {# Tage}}", "de")).toEqual([]);
  });
  it("rejects categories the language doesn't have, and Arabic without few/many", () => {
    expect(lintMessage("{n, plural, one {# day} other {# days}}", "{n, plural, one {#日} other {#日}}", "ja")[0]?.problem).toBe("plural");
    const ar = lintMessage("{n, plural, one {# day} other {# days}}", "{n, plural, one {يوم واحد} other {# يوم}}", "ar");
    expect(ar.map((p) => p.detail)).toEqual(["{n} needs few, many"]);
  });
  it("keeps exact matches and select keys English relies on", () => {
    expect(lintMessage("{n, plural, =0 {None} one {#} other {#}}", "{n, plural, one {#} other {#}}", "de")[0]?.detail).toMatch(/dropped =0/);
    expect(lintMessage("{k, select, send {Sent} other {Done}}", "{k, select, other {Fertig}}", "de")[0]?.problem).toBe("select");
  });
  it("flags a literal # outside a plural", () => {
    expect(lintMessage("{n} words", "# {n} Wörter", "de")[0]?.problem).toBe("render");
  });
});

describe("unisolatedArguments", () => {
  it("finds value arguments outside isolates, ignoring plural structure and #", () => {
    expect(unisolatedArguments("أرسل {amount} {symbol}")).toEqual(["amount", "symbol"]);
    expect(unisolatedArguments(`أرسل ${FSI}{amount}${PDI} ${FSI}{symbol}${PDI}`)).toEqual([]);
    expect(unisolatedArguments(`{n, plural, one {# يوم} other {${FSI}{n, number}${PDI} يوم}}`)).toEqual([]);
    expect(unisolatedArguments(`${FSI}{a}`)).toEqual(["(unbalanced isolate)"]);
  });
  it("isolates render as invisible marks around the value", () => {
    expect(formatMessage(`من ${FSI}@{handle}${PDI}`, { handle: "alex" }, "ar")).toBe(`من ${FSI}@alex${PDI}`);
  });
});

describe("checkGlossary", () => {
  it("requires the glossary translation wherever English uses the term", () => {
    const en = { a: "Write down your recovery phrase", b: "Phrase", c: "Your Recovery phrase is safe" };
    const de = { a: "Schreib deine Wiederherstellungsphrase auf", b: "Phrase", c: "Deine Seed-Phrase ist sicher" };
    const p = checkGlossary(en, de, "de", [{ en: "recovery phrase", tr: "Wiederherstellungsphrase" }]);
    expect(p.map((x) => x.id)).toEqual(["c"]);
    expect(checkGlossary(en, de, "de", [{ en: "recovery phrase", tr: "Wiederherstellungsphrase", except: ["c"] }])).toEqual([]);
  });
});

describe("numbers inside messages", () => {
  it("use Latin digits in Arabic, like amounts do", () => {
    expect(formatMessage("{n, plural, few {# أيام} other {# يوم}}", { n: 3 }, "ar")).toBe("3 أيام");
    expect(formatMessage("{n, number}", { n: 1234 }, "ar")).toMatch(/^1.234$/);
  });
});
