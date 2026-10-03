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
