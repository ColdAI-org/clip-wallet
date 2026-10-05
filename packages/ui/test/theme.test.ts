import { describe, expect, it } from "vitest";
import { accentInk, contrast } from "../src/theme/tokens";

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
