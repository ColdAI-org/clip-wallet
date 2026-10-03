import config from "../clip.config.js";

/** CSS variables for the UI, derived from clip.config.ts. */
export const themeVars = {
  "--clip-accent": config.theme.accent,
  "--clip-accent-text": config.theme.accentText,
  "--clip-font": config.theme.font,
  "--clip-radius": `${config.theme.radius}px`,
};
