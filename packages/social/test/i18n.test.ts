import { describe, expect, it } from "vitest";
import { LOCALE_CODES, checkTranslation } from "@clip-wallet/i18n";
import { NOTIFICATION_CATALOGS, notificationText } from "../src/index.js";
import en from "../src/notifications/locales/en.js";

describe("notification text catalogs", () => {
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    it(`${code}: complete, same variables, translated`, () => {
      const cat = NOTIFICATION_CATALOGS[code] as Record<string, string> | undefined;
      expect(cat).toBeDefined();
      expect(checkTranslation(en, cat!, code)).toEqual([]);
      const same = Object.entries(en).filter(([id, m]) => cat![id] === m);
      expect(same.map(([id]) => id)).toEqual([]);
    });
  }
  it("formats in the locale", () => {
    expect(notificationText("en")("incoming.body", { amount: "1.5", symbol: "ETH" })).toBe("You received 1.5 ETH.");
  });
});
