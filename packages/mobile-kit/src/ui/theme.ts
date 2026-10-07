/**
 * The extension's design tokens (@clip-wallet/ui tokensFor, from clip.config's theme) as React Native values.
 * Screens never hard-code a colour or the product name: they read this.
 */
import { tokensFor, type ColorMode } from "@clip-wallet/ui";
import type { ClipConfig } from "@clip-wallet/config";

export interface Theme {
  mode: ColorMode;
  c: {
    bg: string;
    surface: string;
    surface2: string;
    border: string;
    text: string;
    text2: string;
    text3: string;
    accent: string;
    accentText: string;
    /** The accent as small text: AA 4.5:1 on every surface (tokensFor "--clip-accent-ink"). */
    accentInk: string;
    accentSoft: string;
    positive: string;
    infoBg: string;
    infoFg: string;
    cautionBg: string;
    cautionFg: string;
    dangerBg: string;
    dangerFg: string;
  };
  r: { sm: number; md: number; lg: number };
  s: (n: 1 | 2 | 3 | 4 | 5 | 6 | 8) => number;
  mono: string;
}

const px = (v: string | undefined, d: number) => (v ? Number.parseFloat(v) : d);

export function themeFor(config: ClipConfig, mode: ColorMode): Theme {
  const t = tokensFor(config, mode);
  const v = (k: string) => t[`--clip-${k}` as const] ?? "#000";
  return {
    mode,
    c: {
      bg: v("bg"),
      surface: v("surface"),
      surface2: v("surface-2"),
      border: v("border"),
      text: v("text"),
      text2: v("text-2"),
      text3: v("text-3"),
      accent: v("accent"),
      accentText: v("accent-text"),
      accentInk: v("accent-ink"),
      accentSoft: v("accent-soft"),
      positive: v("positive"),
      infoBg: v("info-bg"),
      infoFg: v("info-fg"),
      cautionBg: v("caution-bg"),
      cautionFg: v("caution-fg"),
      dangerBg: v("danger-bg"),
      dangerFg: v("danger-fg"),
    },
    r: { sm: px(t["--clip-radius-sm"], 10), md: px(t["--clip-radius-md"], 14), lg: px(t["--clip-radius-lg"], 20) },
    s: (n) => px(t[`--clip-space-${n}` as const], n * 4),
    mono: "Menlo",
  };
}
