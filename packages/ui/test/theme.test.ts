import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultClipConfig } from "../src/theme/config";
import { accentInk, contrast, tokensFor } from "../src/theme/tokens";

describe("accent ink (accent-coloured small text)", () => {
  it("ColdAI orange is 3.6:1 on white: fine for fills and large text, not for small text", () => {
    expect(contrast("#FF3C00", "#FFFFFF")).toBeCloseTo(3.56, 1);
  });

  it("darkens #FF3C00 to an AA shade in light mode and lightens it in dark mode", () => {
    const light = accentInk("#FF3C00", "light");
    const dark = accentInk("#FF3C00", "dark");
    expect(light).toBe("#C22E00");
    expect(dark).toBe("#FF6738");
    for (const s of ["#FFFFFF", "#FAFAF9", "#F3F3F1", "#FFECE6"]) expect(contrast(light, s)).toBeGreaterThanOrEqual(4.5);
    for (const s of ["#18181A", "#0F0F10", "#222225"]) expect(contrast(dark, s)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an accent that already passes alone", () => {
    expect(accentInk("#1F4FB3", "light")).toBe("#1F4FB3");
  });
});

describe("strong row hints (who gets the Clip fee)", () => {
  it("are --clip-text-2, AA 4.5:1 on every surface in both modes", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8");
    const at = css.indexOf(".clip-row__hint--strong {");
    expect(at).toBeGreaterThan(-1);
    expect(css.slice(at, css.indexOf("}", at))).toMatch(/color:\s*var\(--clip-text-2\)/);
    for (const mode of ["light", "dark"] as const) {
      const t = tokensFor(defaultClipConfig, mode);
      for (const s of ["--clip-bg", "--clip-surface", "--clip-surface-2"] as const) expect(contrast(t["--clip-text-2"]!, t[s]!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
