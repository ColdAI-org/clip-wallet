/** Mobile translations: complete, same variables and tags as English, protected terms kept, nothing left in English. */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_CODES, checkTranslation, parseMessage } from "@clip-wallet/i18n";
import { en } from "../src/i18n/en";
import { MOBILE_CATALOGS } from "../src/i18n";

const PROTECTED = ["Clip Wallet", "WalletConnect", "Face ID", "Touch ID", "USDC", "HBAR", "ETH", "SOL"];

describe("mobile catalogs", () => {
  it("English parses", () => {
    for (const [id, m] of Object.entries(en)) expect(() => parseMessage(m), id).not.toThrow();
  });
  for (const code of LOCALE_CODES.filter((c) => c !== "en")) {
    it(`${code}: complete and translated`, () => {
      const cat = MOBILE_CATALOGS[code] as Record<string, string> | undefined;
      expect(cat).toBeDefined();
      expect(cat).not.toBe(en);
      expect(checkTranslation(en, cat!, code, PROTECTED)).toEqual([]);
      const same = Object.entries(en).filter(([id, m]) => cat![id] === m && /[a-z]{4,} [a-z]{4,}/.test(m));
      expect(same.length, same.map(([id]) => id).join(", ")).toBeLessThanOrEqual(3);
    });
  }
});

describe("no hard-coded English in mobile screens", () => {
  const dir = join(__dirname, "../src/screens");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
    it(f, () => {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const attr = /\b(label|placeholder|accessibilityLabel|title)="([^"]*[A-Za-z]{3,}[^"]*)"/;
      const hits = src.split("\n").filter((l) => {
        if (/^\s+[A-Z][a-zA-Z'’]+([ ,][a-zA-Z'’,]+)*[.!?…:]?\s*$/.test(l)) return true;
        const m = attr.exec(l);
        // Message ids ("m.social.x") and technical examples ("@alex") are fine.
        return !!m && !/^m\.[a-z]+\.[A-Za-z.]+$/.test(m[2]!) && m[2] !== "@alex";
      });
      expect(hits).toEqual([]);
    });
  }
});
