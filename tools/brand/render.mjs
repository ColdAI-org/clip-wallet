#!/usr/bin/env node
/**
 * Renders every Clip Wallet icon and store graphic from the SVG sources in brand/.
 *
 *   node tools/brand/render.mjs          (after pnpm install; uses the extension's Playwright Chromium)
 *
 * Outputs are committed, so a normal build never runs this. Re-run it after editing anything in brand/.
 * Sizes: Chrome Web Store image guidelines (https://developer.chrome.com/docs/webstore/images): 128 px store
 * icon with 96 px artwork and 16 px transparent padding, 440x280 small promo tile, 1400x560 marquee;
 * Edge Partner Center: 300x300 logo; Expo app icons (https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/):
 * 1024x1024 icon, Android adaptive foreground/monochrome 1024x1024 with the artwork inside the 66% safe zone,
 * 1024x1024 transparent splash icon.
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(ROOT, "apps/extension/package.json"));
const { chromium } = require("@playwright/test");

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const svgUri = (p) => `data:image/svg+xml;base64,${Buffer.from(read(p)).toString("base64")}`;
// Inter ships with the extension's pages, which live in @clip-wallet/extension-kit.
const kitRequire = createRequire(join(ROOT, "packages/extension-kit/package.json"));
const INTER = `data:font/woff2;base64,${readFileSync(
  join(dirname(kitRequire.resolve("@fontsource-variable/inter/package.json")), "files/inter-latin-wght-normal.woff2"),
).toString("base64")}`;

const MARK = svgUri("brand/clip-mark.svg");
const MARK_SMALL = svgUri("brand/clip-mark-small.svg");
const GLYPH_WHITE = svgUri("brand/clip-glyph-white.svg");
const GLYPH_ORANGE = svgUri("brand/clip-glyph-orange.svg");
const WORD_WHITE = svgUri("brand/clip-wordmark-white.svg");
const ORANGE = "#FF3C00";

const page = (w, h, body, bg = "transparent") => `<!doctype html><html><head><style>
@font-face { font-family: "Inter"; src: url(${INTER}) format("woff2"); font-weight: 100 900; }
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${bg}; font-family: "Inter", sans-serif; }
img { display: block; }
</style></head><body>${body}</body></html>`;

const centered = (src, size, w, h) =>
  `<img src="${src}" width="${size}" height="${size}" style="position:absolute;left:${(w - size) / 2}px;top:${(h - size) / 2}px">`;

/** Promo tile: orange field, white glyph, wordmark and one calm line. */
const promo = (w, h, { glyph, word, line, lineSize, gap }) => `
<div style="position:absolute;inset:0;background:${ORANGE}">
  <div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:${gap}px">
    <div style="display:flex;align-items:center;gap:${Math.round(glyph * 0.18)}px">
      <img src="${GLYPH_WHITE}" width="${glyph}" height="${glyph}">
      <img src="${WORD_WHITE}" height="${word}" style="height:${word}px;width:auto">
    </div>
    <div style="color:#fff;font-weight:500;font-size:${lineSize}px;letter-spacing:-0.01em;opacity:.95">${line}</div>
  </div>
</div>`;

const LINE = "One calm wallet for every CLPR network";

/** [output path, width, height, html body, background] */
const JOBS = [
  // Extension toolbar / management icons (manifest "icons"). 16 and 32 use the small-size drawing.
  ["apps/extension/public/icon/16.png", 16, 16, centered(MARK_SMALL, 16, 16, 16)],
  ["apps/extension/public/icon/32.png", 32, 32, centered(MARK_SMALL, 32, 32, 32)],
  ["apps/extension/public/icon/48.png", 48, 48, centered(MARK, 48, 48, 48)],
  ["apps/extension/public/icon/128.png", 128, 128, centered(MARK, 128, 128, 128)],
  // Store listing graphics.
  ["apps/extension/store/assets/store-icon-128.png", 128, 128, centered(MARK, 96, 128, 128)],
  ["apps/extension/store/assets/edge-logo-300.png", 300, 300, centered(MARK, 300, 300, 300)],
  ["apps/extension/store/assets/promo-small-440x280.png", 440, 280, promo(440, 280, { glyph: 64, word: 40, line: LINE, lineSize: 16, gap: 18 })],
  ["apps/extension/store/assets/promo-marquee-1400x560.png", 1400, 560, promo(1400, 560, { glyph: 168, word: 104, line: LINE, lineSize: 40, gap: 40 })],
  // Mobile (Expo). iOS masks the corners itself and rejects transparency: full-bleed orange square.
  ["apps/mobile/assets/icon.png", 1024, 1024, centered(GLYPH_WHITE, 820, 1024, 1024), ORANGE],
  // iOS 18 dark and tinted variants: transparent background, the system supplies it.
  ["apps/mobile/assets/icon-dark.png", 1024, 1024, centered(GLYPH_ORANGE, 820, 1024, 1024)],
  ["apps/mobile/assets/icon-tinted.png", 1024, 1024, centered(svgUri("brand/clip-glyph-white.svg"), 820, 1024, 1024), "#000"],
  // Android adaptive icon: glyph inside the 66% safe zone (≈ 676 px of 1024), background colour in app.config.ts.
  ["apps/mobile/assets/adaptive-icon.png", 1024, 1024, centered(GLYPH_WHITE, 600, 1024, 1024)],
  ["apps/mobile/assets/adaptive-monochrome.png", 1024, 1024, centered(GLYPH_WHITE, 600, 1024, 1024)],
  // Splash: white glyph on the orange background set in the expo-splash-screen plugin.
  ["apps/mobile/assets/splash-icon.png", 1024, 1024, centered(GLYPH_WHITE, 1024, 1024, 1024)],
  // Clip Desktop (electron-builder). macOS: the mark inside Apple's 824 px icon grid on a transparent 1024 canvas;
  // Windows / Linux: the mark full size. Tray: a black glyph template image on macOS (the menu bar tints it), the
  // small-size mark elsewhere; @2x for HiDPI.
  ["apps/desktop/build/icon-mac.png", 1024, 1024, centered(MARK, 824, 1024, 1024)],
  ["apps/desktop/build/icon.png", 1024, 1024, centered(MARK, 1024, 1024, 1024)],
  ["apps/desktop/src/renderer/public/tray/trayTemplate.png", 16, 16, centered(svgUri("brand/clip-glyph-ink.svg"), 16, 16, 16)],
  ["apps/desktop/src/renderer/public/tray/trayTemplate@2x.png", 32, 32, centered(svgUri("brand/clip-glyph-ink.svg"), 32, 32, 32)],
  ["apps/desktop/src/renderer/public/tray/tray.png", 16, 16, centered(MARK_SMALL, 16, 16, 16)],
  ["apps/desktop/src/renderer/public/tray/tray@2x.png", 32, 32, centered(MARK_SMALL, 32, 32, 32)],
  // Review sheet (not shipped).
  ["brand/preview.png", 1200, 560, `
    <div style="position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;font:500 13px Inter">
      <div style="background:#FAFAF9;padding:32px;display:flex;flex-direction:column;gap:24px;color:#5E5C59">
        <div style="display:flex;align-items:end;gap:20px">
          <img src="${MARK}" width="128"><img src="${MARK}" width="48"><img src="${MARK_SMALL}" width="32"><img src="${MARK_SMALL}" width="16">
        </div>
        <img src="${svgUri("brand/clip-lockup-ink.svg")}" style="width:420px;height:auto">
        <img src="${GLYPH_ORANGE}" width="64">
        <div>Light surface · #FF3C00 mark · ink #141414</div>
      </div>
      <div style="background:#0F0F10;padding:32px;display:flex;flex-direction:column;gap:24px;color:#B4B2AE">
        <div style="display:flex;align-items:end;gap:20px">
          <img src="${MARK}" width="128"><img src="${MARK}" width="48"><img src="${MARK_SMALL}" width="32"><img src="${MARK_SMALL}" width="16">
        </div>
        <img src="${svgUri("brand/clip-lockup-white.svg")}" style="width:420px;height:auto">
        <img src="${GLYPH_WHITE}" width="64">
        <div>Dark surface · white wordmark</div>
      </div>
    </div>`],
];

const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  for (const [out, w, h, body, bg] of JOBS) {
    await tab.setViewportSize({ width: w, height: h });
    await tab.setContent(page(w, h, body, bg));
    await tab.evaluate(() => document.fonts.ready);
    await tab.waitForFunction(() => [...document.images].every((i) => i.complete));
    mkdirSync(dirname(join(ROOT, out)), { recursive: true });
    await tab.screenshot({ path: join(ROOT, out), omitBackground: !bg });
    console.log(`${out} ${w}x${h}`);
  }
} finally {
  await browser.close();
}

// The vector mark is what the wallet announces to dapps (EIP-6963 / Wallet Standard) and what configs point at.
// The desktop and phone apps inline their clip.config icon (these files) as the dapp-facing identity at build time.
for (const dest of ["apps/extension/icon.svg", "apps/mobile/assets/icon.svg", "apps/desktop/icon.svg"]) copyFileSync(join(ROOT, "brand/clip-mark.svg"), join(ROOT, dest));
console.log("icon.svg copied to apps/extension, apps/mobile/assets and apps/desktop");

// The same mark as a data URI wherever code needs it inline (1Mask's default identity, the dApp-side kit modules).
// tools/harness/test/brand.test.mjs checks they stay equal to brand/clip-mark.svg.
const DATA_URI = `data:image/svg+xml;base64,${Buffer.from(read("brand/clip-mark.svg")).toString("base64")}`;
for (const file of ["packages/1mask/src/shared/config.ts", "packages/kit-modules/src/shared.ts"]) {
  const src = read(file);
  const next = src.replace(/"data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+"/, JSON.stringify(DATA_URI));
  if (next === src && !src.includes(DATA_URI)) throw new Error(`${file}: no inline icon found to replace`);
  writeFileSync(join(ROOT, file), next);
}
console.log("inline identity icons updated");
