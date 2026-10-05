import type { ClipConfig } from "./config";

export type ColorMode = "light" | "dark";

/** Design tokens as CSS custom properties. Every colour in styles.css is one of these. */
export type Tokens = Record<`--${string}`, string>;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function luminance(hex: string): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.2 contrast ratio (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Composite `fg` at `alpha` over the opaque `bg` (for the accent-soft tint). */
function over(fg: string, alpha: number, bg: string): string {
  const [a, b] = [hexToRgb(fg), hexToRgb(bg)];
  return `#${a.map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
}

function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, s, l];
}

/**
 * The accent as small text ("ink"): the same hue, darkened (light mode) or lightened (dark mode) just enough to
 * reach WCAG AA 4.5:1 on every surface it sits on, accent-soft chips included. A bright brand accent such as
 * ColdAI orange #FF3C00 is only 3.6:1 on white, which is fine for large text, icons and button fills (3:1) but
 * not for 14 px links and labels. The accent itself stays as configured for fills, focus rings and the brand.
 */
export function accentInk(accent: string, mode: ColorMode): string {
  const surfaces = mode === "light" ? ["#FFFFFF", "#FAFAF9", "#F3F3F1"] : ["#18181A", "#0F0F10", "#222225"];
  const soft = surfaces.map((s) => over(accent, mode === "light" ? 0.1 : 0.18, s));
  const ok = (c: string) => [...surfaces, ...soft].every((s) => contrast(c, s) >= 4.5);
  if (ok(accent)) return accent.toUpperCase();
  const [h, s, l0] = toHsl(accent);
  for (let i = 1; i <= 100; i++) {
    const l = mode === "light" ? l0 - i * 0.005 : l0 + i * 0.005;
    if (l <= 0 || l >= 1) break;
    const c = hslHex(h, s, l);
    if (ok(c)) return c;
  }
  return mode === "light" ? "#141414" : "#F4F4F2";
}

/** "Inter" → a stack that prefers the bundled variable font, then the system UI font. */
export function fontStack(font: string): string {
  const name = font.replace(/["\\]/g, "");
  return `"${name} Variable", "${name}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
}

export function tokensFor(config: ClipConfig, mode: ColorMode): Tokens {
  const { accent, accentText, font, radius } = config.theme;
  // One font and one radius in the config; the scale is derived from them.
  const shared: Tokens = {
    "--clip-accent": accent,
    "--clip-accent-text": accentText,
    // Accent-coloured text (links, active tabs, chips): AA 4.5:1 on every surface. See accentInk().
    "--clip-accent-ink": accentInk(accent, mode),
    "--clip-accent-soft": rgba(accent, mode === "light" ? 0.1 : 0.18),
    "--clip-focus": rgba(accent, 0.55),
    "--clip-font": fontStack(font),
    "--clip-mono": 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    "--clip-radius": `${radius}px`,
    "--clip-radius-sm": `${Math.round(radius * 0.7)}px`,
    "--clip-radius-md": `${radius}px`,
    "--clip-radius-lg": `${Math.round(radius * 1.4)}px`,
    "--clip-space-1": "4px",
    "--clip-space-2": "8px",
    "--clip-space-3": "12px",
    "--clip-space-4": "16px",
    "--clip-space-5": "20px",
    "--clip-space-6": "24px",
    "--clip-space-8": "32px",
  };
  const light: Tokens = {
    "--clip-bg": "#FAFAF9",
    "--clip-surface": "#FFFFFF",
    "--clip-surface-2": "#F3F3F1",
    "--clip-border": "#E7E5E2",
    "--clip-text": "#141414",
    "--clip-text-2": "#5E5C59",
    "--clip-text-3": "#8C8A86",
    "--clip-positive": "#127A43",
    "--clip-info-bg": "#EEF4FF",
    "--clip-info-fg": "#1F4FB3",
    "--clip-caution-bg": "#FFF6E0",
    "--clip-caution-fg": "#8A5A00",
    "--clip-danger-bg": "#FDECEC",
    "--clip-danger-fg": "#B42318",
    "--clip-shadow": "0 1px 2px rgba(20,20,20,.04), 0 4px 16px rgba(20,20,20,.06)",
  };
  const dark: Tokens = {
    "--clip-bg": "#0F0F10",
    "--clip-surface": "#18181A",
    "--clip-surface-2": "#222225",
    "--clip-border": "#2E2E32",
    "--clip-text": "#F4F4F2",
    "--clip-text-2": "#B4B2AE",
    "--clip-text-3": "#86847F",
    "--clip-positive": "#4ADE80",
    "--clip-info-bg": "#162238",
    "--clip-info-fg": "#9CC0FF",
    "--clip-caution-bg": "#2D2310",
    "--clip-caution-fg": "#F5C266",
    "--clip-danger-bg": "#341615",
    "--clip-danger-fg": "#FF8A80",
    "--clip-shadow": "0 1px 2px rgba(0,0,0,.4), 0 4px 16px rgba(0,0,0,.35)",
  };
  return { ...shared, ...(mode === "light" ? light : dark) };
}
