import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import {
  amountInputFromUnits,
  canonicalAmountInput,
  checkTranslation,
  createTranslator,
  dirOf,
  formatAmount,
  formatFiat,
  formatMessage,
  formatPercent,
  messageArguments,
  negotiateLocale,
  parseAmountInput,
  resolveLocale,
  separators,
  type Catalogs,
} from "../src/index.js";
import { LocaleProvider, rich, useFormat, useT } from "../src/react.js";

describe("locales", () => {
  it("negotiates the device language list onto shipped locales", () => {
    expect(negotiateLocale(["de-AT", "en"])).toBe("de");
    expect(negotiateLocale(["pt-PT"])).toBe("pt-BR");
    expect(negotiateLocale(["zh-CN"])).toBe("zh-Hans");
    expect(negotiateLocale(["zh-Hant-TW"])).toBe("zh-Hans");
    expect(negotiateLocale(["nl", "fr-CA"])).toBe("fr");
    expect(negotiateLocale(["sw"])).toBe("en");
    expect(negotiateLocale(["ar_EG"])).toBe("ar");
  });
  it("an explicit choice beats the device", () => {
    expect(resolveLocale("ja", ["de"])).toBe("ja");
    expect(resolveLocale("system", ["ko-KR"])).toBe("ko");
    expect(resolveLocale("klingon", ["it"])).toBe("it");
  });
  it("knows right-to-left scripts", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("he-IL")).toBe("rtl");
    expect(dirOf("az-Arab")).toBe("rtl");
    expect(dirOf("hi")).toBe("ltr");
  });
});

describe("messages", () => {
  it("interpolates, pluralises and selects", () => {
    expect(formatMessage("Send to {name}", { name: "Alex" })).toBe("Send to Alex");
    const m = "{count, plural, =0 {No apps} one {# app} other {# apps}} connected";
    expect(formatMessage(m, { count: 0 })).toBe("No apps connected");
    expect(formatMessage(m, { count: 1 })).toBe("1 app connected");
    expect(formatMessage(m, { count: 1200 })).toBe("1,200 apps connected");
    expect(formatMessage(m, { count: 1200 }, "de")).toBe("1.200 apps connected");
    expect(formatMessage("{kind, select, send {Sent} other {Done}}", { kind: "send" })).toBe("Sent");
    expect(formatMessage("You'll get {n, number}", { n: 1234.5 }, "fr")).toBe("You'll get 1 234,5");
  });
  it("uses the locale's plural categories (Arabic has six)", () => {
    const m = "{n, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}";
    expect([0, 1, 2, 3, 11, 100].map((n) => formatMessage(m, { n }, "ar"))).toEqual(["zero", "one", "two", "few", "many", "other"]);
  });
  it("leaves a missing variable visible", () => {
    expect(formatMessage("Hi {name}")).toBe("Hi {name}");
  });
  it("lists arguments for translation checks", () => {
    expect(messageArguments("{a} {b, plural, one {# {c}} other {#}}")).toEqual(["a", "b", "c"]);
  });
  it("falls back to English, then to the id", () => {
    const en = { "a.title": "Send", "a.to": "To {name}" };
    const t = createTranslator(en, { "a.title": "Senden" } as never, "de");
    expect(t("a.title")).toBe("Senden");
    expect(t("a.to", { name: "Alex" })).toBe("To Alex");
    expect(t("nope" as never)).toBe("nope");
  });
  it("a broken translation shows English instead of crashing", () => {
    const t = createTranslator({ x: "Hi {name}" }, { x: "Hallo {name" }, "de");
    expect(t("x", { name: "A" })).toBe("Hi A");
  });
  it("checks translations structurally", () => {
    const en = { a: "Send {amount} {symbol}", b: "<b>Clip Wallet</b> is locked", c: "x" };
    const problems = checkTranslation(en, { a: "Envoyer {montant}", b: "Clip Wallet est verrouillé", d: "y" }, "fr", ["Clip Wallet"]);
    expect(problems.map((p) => `${p.id}:${p.problem}`).sort()).toEqual(["a:arguments", "b:tags", "c:missing", "d:extra"]);
  });
});

describe("numbers", () => {
  it("formats fiat per locale", () => {
    expect(formatFiat(1234.5, "USD", "en")).toBe("$1,234.50");
    expect(formatFiat(1234.5, "EUR", "de")).toBe("1.234,50 €");
    expect(formatFiat(-3, "USD", "en")).toBe("−$3.00");
    expect(formatFiat(0.0042, "USD", "en")).toBe("$0.0042");
    expect(formatFiat(1234, "JPY", "ja")).toBe("￥1,234");
    expect(formatFiat(5, "USD", "ar")).toMatch(/5\.00/); // Latin digits in Arabic
    expect(formatFiat(undefined, "USD")).toBe("—");
  });
  it("formats token amounts exactly, grouped for the locale", () => {
    expect(formatAmount("123456789000000000000000", 18, 6, "en")).toBe("123,456.789");
    expect(formatAmount("123456789000000000000000", 18, 6, "de")).toBe("123.456,789");
    expect(formatAmount("1000000000", 8, 6, "hi")).toBe("10");
    expect(formatAmount(10_000_000_00000000n, 8, 2, "hi")).toBe("1,00,00,000");
    expect(formatAmount("-25000000", 6, 6, "en")).toBe("−25");
  });
  it("percent", () => {
    expect(formatPercent(12.5, "en", { signed: true })).toBe("+12.5%");
    expect(formatPercent(-3.25, "fr")).toBe("−3,25 %");
  });
  it("reads typed amounts safely: a lone separator is a decimal, never a thousands mark", () => {
    expect(canonicalAmountInput("0,5", "en")).toBe("0.5");
    expect(canonicalAmountInput("0,5", "de")).toBe("0.5");
    expect(canonicalAmountInput("0.5", "de")).toBe("0.5");
    expect(canonicalAmountInput("1,234.5", "en")).toBe("1234.5");
    expect(canonicalAmountInput("1.234,5", "de")).toBe("1234.5");
    expect(canonicalAmountInput("1 234,5", "fr")).toBe("1234.5");
    expect(canonicalAmountInput("1,234", "en")).toBe("1234");
    expect(canonicalAmountInput("1.234", "de")).toBe("1234");
    expect(canonicalAmountInput("١٢٫٥", "ar")).toBe("12.5");
    expect(canonicalAmountInput("１２．５", "ja")).toBe("12.5");
    expect(canonicalAmountInput("1,2,3", "en")).toBeNull();
    expect(canonicalAmountInput("1.2.3", "de")).toBeNull();
    expect(canonicalAmountInput("12,34.5", "en")).toBeNull();
    expect(canonicalAmountInput("-1", "en")).toBeNull();
    expect(canonicalAmountInput(".", "en")).toBeNull();
    expect(canonicalAmountInput("abc", "en")).toBeNull();
    expect(canonicalAmountInput(".5", "en")).toBe("0.5");
    expect(canonicalAmountInput("007", "en")).toBe("7");
  });
  it("parses to base units and round-trips Max", () => {
    expect(parseAmountInput("0,000001", 6, "de")).toBe(1n);
    expect(parseAmountInput("0.0000001", 6, "en")).toBeNull();
    const units = 1234567890123456789n;
    for (const l of ["en", "de", "fr", "ar", "hi", "ja"]) expect(parseAmountInput(amountInputFromUnits(units, 18, l), 18, l)).toBe(units);
    expect(amountInputFromUnits(1234500000n, 6, "de")).toBe("1234,5");
  });
  it("separators", () => {
    expect(separators("de")).toEqual({ decimal: ",", group: "." });
    expect(separators("en")).toEqual({ decimal: ".", group: "," });
  });
});

describe("react", () => {
  const catalogs: Catalogs<{ "x.hi": string; "x.count": string }> = {
    en: { "x.hi": "Hello {name}", "x.count": "{n, plural, one {# day} other {# days}}" },
    de: { "x.hi": "Hallo {name}", "x.count": "{n, plural, one {# Tag} other {# Tage}}" },
    ja: async () => ({ default: { "x.hi": "こんにちは、{name}", "x.count": "{n}日" } }),
  };
  function Hello() {
    const t = useT(catalogs);
    const f = useFormat();
    return (
      <p>
        {t("x.hi", { name: "Alex" })} · {t("x.count", { n: 2 })} · {f.fiat(1.5, "EUR")}
      </p>
    );
  }
  it("renders bundled locales synchronously", () => {
    render(
      <LocaleProvider locale="de">
        <Hello />
      </LocaleProvider>,
    );
    expect(screen.getByText("Hallo Alex · 2 Tage · 1,50 €")).toBeTruthy();
  });
  it("loads lazy locales, showing English meanwhile", async () => {
    render(
      <LocaleProvider locale="ja">
        <Hello />
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByText(/こんにちは、Alex · 2日/)).toBeTruthy());
  });
  it("rich text", () => {
    render(<p data-testid="r">{rich("Send to <b>Alex</b> now", { b: (c) => <strong>{c}</strong> })}</p>);
    expect(screen.getByTestId("r").innerHTML).toBe("Send to <strong>Alex</strong> now");
  });
});
