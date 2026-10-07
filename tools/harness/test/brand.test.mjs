/**
 * The Clip Wallet mark has one source (brand/clip-mark.svg). Every copy the wallet ships, the inline data URIs
 * that dapps see (EIP-6963 / Wallet Standard) and the rendered PNGs must come from it (tools/brand/render.mjs).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(join(repo, p));
const mark = read("brand/clip-mark.svg");
const dataUri = `data:image/svg+xml;base64,${mark.toString("base64")}`;

test("icon.svg copies match brand/clip-mark.svg", () => {
  // The desktop and phone apps inline their clip.config icon (these files) as the EIP-6963 identity at build time.
  for (const p of ["apps/extension/icon.svg", "apps/mobile/assets/icon.svg", "apps/desktop/icon.svg"]) assert.ok(read(p).equals(mark), `${p}: run node tools/brand/render.mjs`);
});

test("inline identity icons are the brand mark, not a placeholder", () => {
  for (const p of ["packages/1mask/src/shared/config.ts", "packages/kit-modules/src/shared.ts"]) {
    assert.ok(read(p).toString().includes(JSON.stringify(dataUri)), `${p}: run node tools/brand/render.mjs`);
  }
});

/** PNG width/height from the IHDR chunk. */
function size(p) {
  const b = read(p);
  assert.equal(b.subarray(1, 4).toString(), "PNG", `${p} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("rendered icons and store graphics have the sizes the stores ask for", () => {
  const want = {
    "apps/extension/public/icon/16.png": [16, 16],
    "apps/extension/public/icon/32.png": [32, 32],
    "apps/extension/public/icon/48.png": [48, 48],
    "apps/extension/public/icon/128.png": [128, 128],
    "apps/extension/store/assets/store-icon-128.png": [128, 128],
    "apps/extension/store/assets/promo-small-440x280.png": [440, 280],
    "apps/extension/store/assets/promo-marquee-1400x560.png": [1400, 560],
    "apps/extension/store/assets/edge-logo-300.png": [300, 300],
    "apps/mobile/assets/icon.png": [1024, 1024],
    "apps/mobile/assets/adaptive-icon.png": [1024, 1024],
    "apps/mobile/assets/adaptive-monochrome.png": [1024, 1024],
    "apps/mobile/assets/splash-icon.png": [1024, 1024],
    "apps/desktop/build/icon.png": [1024, 1024],
    "apps/desktop/build/icon-mac.png": [1024, 1024],
    "apps/desktop/src/renderer/public/tray/trayTemplate.png": [16, 16],
    "apps/desktop/src/renderer/public/tray/trayTemplate@2x.png": [32, 32],
    "apps/desktop/src/renderer/public/tray/tray.png": [16, 16],
    "apps/desktop/src/renderer/public/tray/tray@2x.png": [32, 32],
  };
  for (const [p, wh] of Object.entries(want)) assert.deepEqual(size(p), wh, p);
});
