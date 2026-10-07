// Every platform's icons from one logo, with Node built-ins only:
//   PNG decode/encode (zlib), area-average resampling with premultiplied alpha, ICO (PNG entries, Windows Vista+) and
//   ICNS (PNG entries, macOS 10.7+) containers.
// A .png logo needs nothing else. A .svg logo is rasterised once at 1024 px by the first tool found:
//   @resvg/resvg-js (if installed in the project), rsvg-convert (librsvg), sips (macOS, built in), magick (ImageMagick).
// Without a logo, the starter mark (icon.mjs) is drawn directly at 1024 px.
//
// What gets written (iconPlan() lists it; paths relative to the project root):
//   icon.svg | icon.png                                   the logo clip.config.ts points at (EIP-6963 identity)
//   packages/extension/public/icon/{16,32,48,128}.png     the extension manifest's icons
//   packages/desktop/build/icon.icns                       macOS (16…1024, Retina pairs)
//   packages/desktop/build/icon.ico                        Windows (16…256)
//   packages/desktop/build/icons/<n>x<n>.png               Linux (16…1024)
//   packages/desktop/build/icon.png                        1024 px (window icon on Linux)
//   packages/desktop/src/renderer/public/tray/*.png        tray / menu bar (macOS template image in black)
//   packages/mobile/assets/icon.png                        iOS / Expo icon: 1024 px, opaque (logo on the accent)
//   packages/mobile/assets/adaptive-icon.png               Android adaptive foreground (logo in the 66% safe zone)
//   packages/mobile/assets/adaptive-monochrome.png         Android 13+ themed icon (white silhouette)
//   packages/mobile/assets/splash-icon.png                 splash screen image (on the accent colour)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { iconSvg, rgb } from "./icon.mjs";

/** @typedef {{ width: number, height: number, data: Uint8Array }} Raster RGBA, straight (not premultiplied) alpha */
/** @typedef {"extension" | "desktop" | "mobile"} Platform */

export const PLATFORMS = /** @type {const} */ (["extension", "desktop", "mobile"]);
export const EXTENSION_ICON_SIZES = [16, 32, 48, 128];
export const LINUX_ICON_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** ICNS entry types with PNG payloads: [type, pixel size]. */
export const ICNS_TYPES = /** @type {const} */ ([
  ["icp4", 16],
  ["icp5", 32],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
]);

/* ------------------------------------------------------------------ PNG */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = /** @type {number} */ (CRC_TABLE[(c ^ b) & 0xff]) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA PNG (8-bit, filter 0 rows). @param {Raster} img */
export function encodePng(img) {
  const { width, height, data } = img;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * Decode a PNG to RGBA: grey, grey+alpha, RGB, RGBA (8 or 16 bit) and palette (1/2/4/8 bit, with tRNS);
 * non-interlaced. @param {Buffer} buf @returns {Raster}
 */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG file");
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  /** @type {Buffer | undefined} */
  let palette;
  /** @type {Buffer | undefined} */
  let trns;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const t = buf.toString("ascii", o + 4, o + 8);
    const d = buf.subarray(o + 8, o + 8 + len);
    if (t === "IHDR") {
      width = d.readUInt32BE(0);
      height = d.readUInt32BE(4);
      depth = /** @type {number} */ (d[8]);
      type = /** @type {number} */ (d[9]);
      interlace = /** @type {number} */ (d[12]);
    } else if (t === "PLTE") palette = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    else if (t === "IEND") break;
    o += 12 + len;
  }
  if (!width || !height) throw new Error("PNG has no image header");
  if (interlace) throw new Error("interlaced PNGs aren't supported: export the logo again without interlacing");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`PNG colour type ${type} isn't supported`);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const lines = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = /** @type {number} */ (raw[y * (stride + 1)]);
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? /** @type {number} */ (line[i - bpp]) : 0;
      const b = /** @type {number} */ (prev[i]);
      const c = i >= bpp ? /** @type {number} */ (prev[i - bpp]) : 0;
      const x = /** @type {number} */ (line[i]);
      if (f === 1) line[i] = (x + a) & 255;
      else if (f === 2) line[i] = (x + b) & 255;
      else if (f === 3) line[i] = (x + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      } else if (f !== 0) throw new Error(`PNG filter ${f} isn't valid`);
    }
    line.copy(lines, y * stride);
    prev = line;
  }
  const max = (1 << depth) - 1;
  /** sample n of row y (0..max for depth < 8, 0..255 for 8, high byte for 16) */
  const sample = (/** @type {number} */ y, /** @type {number} */ n) => {
    if (depth === 8) return /** @type {number} */ (lines[y * stride + n]);
    if (depth === 16) return /** @type {number} */ (lines[y * stride + n * 2]);
    const bit = n * depth;
    return (/** @type {number} */ (lines[y * stride + (bit >> 3)]) >> (8 - depth - (bit & 7))) & max;
  };
  const scale = depth < 8 ? 255 / max : 1;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const i = sample(y, x);
        if (!palette || i * 3 + 2 >= palette.length) throw new Error("PNG palette index out of range");
        out[o] = /** @type {number} */ (palette[i * 3]);
        out[o + 1] = /** @type {number} */ (palette[i * 3 + 1]);
        out[o + 2] = /** @type {number} */ (palette[i * 3 + 2]);
        out[o + 3] = trns && i < trns.length ? /** @type {number} */ (trns[i]) : 255;
      } else if (type === 0 || type === 4) {
        const g = Math.round(sample(y, x * channels) * scale);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = type === 4 ? sample(y, x * 2 + 1) : trns && depth <= 8 && trns.readUInt16BE(0) === sample(y, x) ? 0 : 255;
      } else {
        out[o] = sample(y, x * channels);
        out[o + 1] = sample(y, x * channels + 1);
        out[o + 2] = sample(y, x * channels + 2);
        out[o + 3] = type === 6 ? sample(y, x * 4 + 3) : 255;
      }
    }
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------------------ raster operations */

/** @param {number} w @param {number} h @param {[number, number, number, number]} [fill] @returns {Raster} */
export function canvas(w, h, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width: w, height: h, data };
}

/**
 * Resize with premultiplied alpha: an area average when shrinking (every source pixel counts by the area it covers),
 * bilinear when growing. Separable: rows, then columns. @param {Raster} img @param {number} w @param {number} h
 */
export function resize(img, w, h) {
  if (img.width === w && img.height === h) return { width: w, height: h, data: img.data.slice() };
  const pre = new Float64Array(img.width * img.height * 4);
  for (let i = 0; i < img.width * img.height; i++) {
    const a = /** @type {number} */ (img.data[i * 4 + 3]) / 255;
    pre[i * 4] = /** @type {number} */ (img.data[i * 4]) * a;
    pre[i * 4 + 1] = /** @type {number} */ (img.data[i * 4 + 1]) * a;
    pre[i * 4 + 2] = /** @type {number} */ (img.data[i * 4 + 2]) * a;
    pre[i * 4 + 3] = a * 255;
  }
  const horiz = pass(pre, img.width, img.height, w, true);
  const both = pass(horiz, w, img.height, h, false);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = /** @type {number} */ (both[i * 4 + 3]);
    data[i * 4 + 3] = clamp(a);
    const k = a > 0 ? 255 / a : 0;
    data[i * 4] = clamp(/** @type {number} */ (both[i * 4]) * k);
    data[i * 4 + 1] = clamp(/** @type {number} */ (both[i * 4 + 1]) * k);
    data[i * 4 + 2] = clamp(/** @type {number} */ (both[i * 4 + 2]) * k);
  }
  return { width: w, height: h, data };
}

/** @param {number} v */
function clamp(v) {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}

/**
 * One resampling pass along x (horizontal) or y. @param {Float64Array} src @param {number} sw @param {number} sh
 * @param {number} n target length along the pass @param {boolean} horizontal
 */
function pass(src, sw, sh, n, horizontal) {
  const len = horizontal ? sw : sh;
  const lines = horizontal ? sh : sw;
  const out = new Float64Array((horizontal ? n * sh : sw * n) * 4);
  const at = (/** @type {number} */ line, /** @type {number} */ i) => (horizontal ? line * sw + i : i * sw + line) * 4;
  const to = (/** @type {number} */ line, /** @type {number} */ i) => (horizontal ? line * n + i : i * sw + line) * 4;
  const ratio = len / n;
  for (let line = 0; line < lines; line++) {
    for (let i = 0; i < n; i++) {
      const acc = [0, 0, 0, 0];
      if (ratio >= 1) {
        const s0 = i * ratio;
        const s1 = s0 + ratio;
        for (let s = Math.floor(s0); s < Math.ceil(s1); s++) {
          const wgt = Math.min(s + 1, s1) - Math.max(s, s0);
          const p = at(line, Math.min(s, len - 1));
          for (let c = 0; c < 4; c++) acc[c] = /** @type {number} */ (acc[c]) + /** @type {number} */ (src[p + c]) * wgt;
        }
        for (let c = 0; c < 4; c++) acc[c] = /** @type {number} */ (acc[c]) / ratio;
      } else {
        const x = Math.max(0, Math.min(len - 1, (i + 0.5) * ratio - 0.5));
        const x0 = Math.floor(x);
        const x1 = Math.min(len - 1, x0 + 1);
        const f = x - x0;
        for (let c = 0; c < 4; c++) acc[c] = /** @type {number} */ (src[at(line, x0) + c]) * (1 - f) + /** @type {number} */ (src[at(line, x1) + c]) * f;
      }
      out.set(acc, to(line, i));
    }
  }
  return out;
}

/** Draw `top` over `base` at (x, y) (source-over). Mutates base. @param {Raster} base @param {Raster} top @param {number} x @param {number} y */
export function over(base, top, x, y) {
  for (let ty = 0; ty < top.height; ty++) {
    const by = ty + y;
    if (by < 0 || by >= base.height) continue;
    for (let tx = 0; tx < top.width; tx++) {
      const bx = tx + x;
      if (bx < 0 || bx >= base.width) continue;
      const t = (ty * top.width + tx) * 4;
      const b = (by * base.width + bx) * 4;
      const ta = /** @type {number} */ (top.data[t + 3]) / 255;
      const ba = /** @type {number} */ (base.data[b + 3]) / 255;
      const oa = ta + ba * (1 - ta);
      for (let c = 0; c < 3; c++) {
        base.data[b + c] = oa ? clamp((/** @type {number} */ (top.data[t + c]) * ta + /** @type {number} */ (base.data[b + c]) * ba * (1 - ta)) / oa) : 0;
      }
      base.data[b + 3] = clamp(oa * 255);
    }
  }
  return base;
}

/**
 * The logo scaled to fit a `box`-pixel square (keeping its aspect ratio), centred on a size×size canvas, over an optional
 * opaque background. @param {Raster} logo @param {number} size @param {number} box @param {string} [background]
 */
export function fit(logo, size, box, background) {
  const k = Math.min(box / logo.width, box / logo.height);
  const w = Math.max(1, Math.round(logo.width * k));
  const h = Math.max(1, Math.round(logo.height * k));
  const base = canvas(size, size, background ? [...rgb(background), 255] : [0, 0, 0, 0]);
  return over(base, resize(logo, w, h), Math.round((size - w) / 2), Math.round((size - h) / 2));
}

/** Does the image have no meaningful transparency (fewer than 1% of pixels below alpha 250)? @param {Raster} img */
export function isOpaque(img) {
  let clear = 0;
  for (let i = 3; i < img.data.length; i += 4) if (/** @type {number} */ (img.data[i]) < 250) clear++;
  return clear < (img.width * img.height) / 100;
}

/**
 * A one-colour silhouette of the logo, for Android's themed icon and the macOS menu-bar template. The shape is the
 * logo's alpha; an opaque logo (artwork on a solid background) uses its difference from the corner colour instead.
 * @param {Raster} img @param {string} color
 */
export function silhouette(img, color) {
  const [r, g, b] = rgb(color);
  const out = canvas(img.width, img.height);
  const opaque = isOpaque(img);
  const bg = [img.data[0], img.data[1], img.data[2]].map(Number);
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4;
    let a = /** @type {number} */ (img.data[o + 3]) / 255;
    if (opaque) {
      const d = Math.max(...[0, 1, 2].map((c) => Math.abs(/** @type {number} */ (img.data[o + c]) - /** @type {number} */ (bg[c])))) / 255;
      a = Math.min(1, Math.max(0, (d - 0.08) / 0.25));
    }
    out.data.set([r, g, b, clamp(a * 255)], o);
  }
  return out;
}

/* ------------------------------------------------------------------ containers */

/** Windows .ico with PNG entries. @param {{ size: number, png: Buffer }[]} entries */
export function encodeIco(entries) {
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    head[o] = e.size >= 256 ? 0 : e.size;
    head[o + 1] = e.size >= 256 ? 0 : e.size;
    head[o + 2] = 0;
    head[o + 3] = 0;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(e.png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += e.png.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.png)]);
}

/** Read an .ico's directory (tests). @param {Buffer} buf */
export function readIco(buf) {
  const n = buf.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const o = 6 + i * 16;
    const size = buf[o] || 256;
    const len = buf.readUInt32LE(o + 8);
    const at = buf.readUInt32LE(o + 12);
    return { size, png: buf.subarray(at, at + len) };
  });
}

/** macOS .icns with PNG entries. @param {{ type: string, png: Buffer }[]} entries */
export function encodeIcns(entries) {
  const parts = entries.map((e) => {
    const h = Buffer.alloc(8);
    h.write(e.type, 0, "ascii");
    h.writeUInt32BE(e.png.length + 8, 4);
    return Buffer.concat([h, e.png]);
  });
  const total = 8 + parts.reduce((s, p) => s + p.length, 0);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(total, 4);
  return Buffer.concat([h, ...parts]);
}

/** Read an .icns's entries (tests). @param {Buffer} buf */
export function readIcns(buf) {
  if (buf.toString("ascii", 0, 4) !== "icns") throw new Error("not an icns file");
  const out = [];
  for (let o = 8; o < buf.readUInt32BE(4); ) {
    const len = buf.readUInt32BE(o + 4);
    out.push({ type: buf.toString("ascii", o, o + 4), png: buf.subarray(o + 8, o + len) });
    o += len;
  }
  return out;
}

/* ------------------------------------------------------------------ sources */

/**
 * Rasterise an SVG at `size` px with the first tool available. Returns the PNG bytes.
 * @param {string} file @param {number} size @param {{ cwd?: string }} [opts]
 */
export function rasterizeSvg(file, size, opts = {}) {
  const svg = readFileSync(file);
  // 1. @resvg/resvg-js, if the project (or this CLI) has it installed. Optional; never a dependency.
  for (const from of [opts.cwd, process.cwd(), dirname(new URL(import.meta.url).pathname)].filter(Boolean)) {
    try {
      const req = createRequire(join(/** @type {string} */ (from), "package.json"));
      const { Resvg } = req("@resvg/resvg-js");
      return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());
    } catch {
      /* not installed here */
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), "clip-logo-"));
  const out = join(tmp, "logo.png");
  const tools = [
    ["rsvg-convert", ["-w", String(size), "-h", String(size), "-a", "-o", out, file]],
    ["sips", ["-s", "format", "png", "-Z", String(size), file, "--out", out]],
    ["magick", ["-background", "none", "-density", "384", file, "-resize", `${size}x${size}`, out]],
  ];
  try {
    for (const [cmd, args] of tools) {
      try {
        execFileSync(/** @type {string} */ (cmd), /** @type {string[]} */ (args), { stdio: "ignore" });
        if (existsSync(out)) return readFileSync(out);
      } catch {
        /* next tool */
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  throw new Error(
    `Can't turn ${file} into PNG icons here: export your logo as a 1024×1024 PNG and pass that (--logo logo.png), or install one of ` +
      "@resvg/resvg-js (pnpm add -D @resvg/resvg-js), rsvg-convert (librsvg) or ImageMagick.",
  );
}

/**
 * The starter mark at `size` px: the whole mark, and just the white ring and dot (for adaptive / splash / template).
 * @param {string} accent @param {number} [size]
 */
export function starterRasters(accent, size = 1024) {
  const full = canvas(size, size);
  const glyph = canvas(size, size);
  const [ar, ag, ab] = rgb(accent);
  const S = 2;
  const R = 28;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sq = 0;
      let mk = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) * 128) / size;
          const y = ((py + (sy + 0.5) / S) * 128) / size;
          const cx = Math.min(Math.max(x, R), 128 - R);
          const cy = Math.min(Math.max(y, R), 128 - R);
          const inSq = (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
          const d = Math.hypot(x - 64, y - 64);
          const inMark = (d <= 40 && d >= 27) || d <= 10;
          if (inSq) sq++;
          if (inMark) mk++;
        }
      }
      const o = (py * size + px) * 4;
      const a = sq / (S * S);
      const m = mk / (S * S);
      const mixed = sq ? Math.min(1, mk / sq) : 0;
      full.data.set([clamp(ar + (255 - ar) * mixed), clamp(ag + (255 - ag) * mixed), clamp(ab + (255 - ab) * mixed), clamp(a * 255)], o);
      glyph.data.set([255, 255, 255, clamp(m * 255)], o);
    }
  }
  return { full, glyph };
}

/**
 * The logo as rasters: `full` (the logo itself) and `glyph` (what sits on a coloured background: the starter's white
 * mark, or the logo again). @param {{ logo?: string, accent: string, cwd?: string }} o
 */
export function logoRasters(o) {
  if (!o.logo) return { ...starterRasters(o.accent), starter: true, warnings: /** @type {string[]} */ ([]) };
  const ext = extname(o.logo).toLowerCase();
  const png = ext === ".svg" ? rasterizeSvg(o.logo, 1024, { cwd: o.cwd }) : readFileSync(o.logo);
  const full = decodePng(png);
  const warnings = [];
  if (Math.min(full.width, full.height) < 1024) warnings.push(`${o.logo} is ${full.width}×${full.height}: icons above that size are scaled up; a 1024×1024 logo looks sharper`);
  if (full.width !== full.height) warnings.push(`${o.logo} isn't square (${full.width}×${full.height}): it is centred on a square`);
  return { full, glyph: full, starter: false, warnings };
}

/* ------------------------------------------------------------------ the plan */

/**
 * Every icon file for the chosen platforms: [path, description] (paths relative to the project root). Pure.
 * @param {readonly Platform[]} platforms @param {{ logoExt?: ".svg" | ".png" }} [o]
 */
export function iconPlan(platforms, o = {}) {
  /** @type {{ file: string, platform: Platform | "wallet", what: string }[]} */
  const plan = [{ file: `icon${o.logoExt ?? ".svg"}`, platform: "wallet", what: "the logo clip.config.ts points at" }];
  if (platforms.includes("extension")) {
    for (const s of EXTENSION_ICON_SIZES) plan.push({ file: `packages/extension/public/icon/${s}.png`, platform: "extension", what: `${s}×${s} manifest icon` });
  }
  if (platforms.includes("desktop")) {
    plan.push({ file: "packages/desktop/build/icon.icns", platform: "desktop", what: "macOS app icon (16–1024 px)" });
    plan.push({ file: "packages/desktop/build/icon.ico", platform: "desktop", what: "Windows app icon (16–256 px)" });
    plan.push({ file: "packages/desktop/build/icon.png", platform: "desktop", what: "1024×1024 window icon" });
    for (const s of LINUX_ICON_SIZES) plan.push({ file: `packages/desktop/build/icons/${s}x${s}.png`, platform: "desktop", what: `Linux ${s}×${s}` });
    for (const [f, s] of [["tray.png", 16], ["tray@2x.png", 32], ["trayTemplate.png", 16], ["trayTemplate@2x.png", 32]]) {
      plan.push({ file: `packages/desktop/src/renderer/public/tray/${f}`, platform: "desktop", what: `${s}×${s} ${String(f).startsWith("trayTemplate") ? "macOS menu-bar template" : "tray"} icon` });
    }
  }
  if (platforms.includes("mobile")) {
    plan.push({ file: "packages/mobile/assets/icon.png", platform: "mobile", what: "1024×1024 iOS / Expo icon (opaque)" });
    plan.push({ file: "packages/mobile/assets/adaptive-icon.png", platform: "mobile", what: "1024×1024 Android adaptive foreground" });
    plan.push({ file: "packages/mobile/assets/adaptive-monochrome.png", platform: "mobile", what: "1024×1024 Android themed (monochrome) icon" });
    plan.push({ file: "packages/mobile/assets/splash-icon.png", platform: "mobile", what: "1024×1024 splash image" });
  }
  return plan;
}

/**
 * Write every icon for the chosen platforms into the project at `root`, from one logo (or the starter mark in the
 * accent colour). Returns the files written and any warnings about the logo.
 * @param {string} root @param {{ logo?: string, accent: string, platforms: readonly Platform[] }} o
 */
export function renderIcons(root, o) {
  const logoExt = o.logo ? /** @type {".svg" | ".png"} */ (extname(o.logo).toLowerCase()) : ".svg";
  const src = logoRasters({ logo: o.logo ? resolve(o.logo) : undefined, accent: o.accent, cwd: root });
  /** @type {string[]} */
  const written = [];
  const put = (/** @type {string} */ rel, /** @type {Buffer | string} */ data) => {
    const f = join(root, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, data);
    written.push(rel);
  };
  const png = (/** @type {Raster} */ img, /** @type {number} */ s) => encodePng(img.width === s && img.height === s ? img : fit(img, s, s));

  mkdirSync(root, { recursive: true });
  // The logo itself, next to clip.config.ts (the other icon file name is removed so only one is in use).
  const other = join(root, logoExt === ".svg" ? "icon.png" : "icon.svg");
  if (existsSync(other)) rmSync(other);
  if (o.logo) {
    if (resolve(o.logo) !== resolve(root, `icon${logoExt}`)) copyFileSync(resolve(o.logo), join(root, `icon${logoExt}`));
    written.push(`icon${logoExt}`);
  } else put("icon.svg", iconSvg(o.accent));

  const full = src.full;
  // Downscale once from 1024, then from the nearest larger size (sharper small sizes, faster).
  const sized = new Map();
  const at = (/** @type {number} */ s) => {
    if (!sized.has(s)) sized.set(s, fit(full, s, s));
    return sized.get(s);
  };

  if (o.platforms.includes("extension")) for (const s of EXTENSION_ICON_SIZES) put(`packages/extension/public/icon/${s}.png`, png(at(s), s));

  if (o.platforms.includes("desktop")) {
    // macOS: the artwork on Apple's 824 px grid inside the 1024 canvas (the system adds no padding of its own).
    const mac = fit(full, 1024, 824);
    const macAt = new Map();
    const macPng = (/** @type {number} */ s) => {
      if (!macAt.has(s)) macAt.set(s, encodePng(resize(mac, s, s)));
      return macAt.get(s);
    };
    put("packages/desktop/build/icon.icns", encodeIcns(ICNS_TYPES.map(([type, s]) => ({ type, png: macPng(s) }))));
    put("packages/desktop/build/icon.ico", encodeIco(ICO_SIZES.map((s) => ({ size: s, png: encodePng(at(s)) }))));
    put("packages/desktop/build/icon.png", encodePng(at(1024)));
    for (const s of LINUX_ICON_SIZES) put(`packages/desktop/build/icons/${s}x${s}.png`, encodePng(at(s)));
    put("packages/desktop/src/renderer/public/tray/tray.png", encodePng(at(16)));
    put("packages/desktop/src/renderer/public/tray/tray@2x.png", encodePng(at(32)));
    const template = silhouette(src.starter ? src.glyph : full, "#000000");
    put("packages/desktop/src/renderer/public/tray/trayTemplate.png", encodePng(fit(template, 16, 16)));
    put("packages/desktop/src/renderer/public/tray/trayTemplate@2x.png", encodePng(fit(template, 32, 32)));
  }

  if (o.platforms.includes("mobile")) {
    // iOS rejects transparency and masks the corners itself: an opaque logo fills the square; otherwise the logo (the
    // starter's white mark) sits on the accent colour.
    const ios = !src.starter && isOpaque(full) ? fit(full, 1024, 1024) : fit(src.glyph, 1024, src.starter ? 1024 : 820, o.accent);
    put("packages/mobile/assets/icon.png", encodePng(ios));
    // Android adaptive icons: the artwork inside the 66% safe zone (≈ 676 of 1024 px); the background is the accent.
    put("packages/mobile/assets/adaptive-icon.png", encodePng(fit(src.glyph, 1024, 600)));
    put("packages/mobile/assets/adaptive-monochrome.png", encodePng(fit(silhouette(src.glyph, "#FFFFFF"), 1024, 600)));
    put("packages/mobile/assets/splash-icon.png", encodePng(fit(src.glyph, 1024, 1024)));
  }
  return { written, warnings: src.warnings };
}
