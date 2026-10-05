// A starter icon for a new wallet: a rounded square in the wallet's accent colour with a white ring and dot, as SVG
// (icon.svg, used for EIP-6963 and the pages) and PNG at 16/32/48/128 (the manifest needs PNG). Node built-ins only:
// the PNGs are drawn here with 4×4 supersampling and written with zlib. Replace both with your own artwork.
import { deflateSync } from "node:zlib";

export const ICON_SIZES = [16, 32, 48, 128];

/** "#4F46E5" or "#45E" -> [r, g, b] @param {string} hex @returns {[number, number, number]} */
export function rgb(hex) {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** The mark in a 128-unit box: rounded square r=28, ring centre (64,64) radii 26..40, dot r=9 at (64,64). */
const MARK = { radius: 28, ringOuter: 40, ringInner: 27, dot: 10 };

/** @param {string} accent @param {string} [mark] text colour, default white */
export function iconSvg(accent, mark = "#FFFFFF") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="${MARK.radius}" fill="${accent}"/><circle cx="64" cy="64" r="${(MARK.ringOuter + MARK.ringInner) / 2}" fill="none" stroke="${mark}" stroke-width="${MARK.ringOuter - MARK.ringInner}"/><circle cx="64" cy="64" r="${MARK.dot}" fill="${mark}"/></svg>\n`;
}

/** Coverage of the background square and of the white mark at a point in 128-unit space. @param {number} x @param {number} y */
function sample(x, y) {
  const r = MARK.radius;
  const cx = Math.min(Math.max(x, r), 128 - r);
  const cy = Math.min(Math.max(y, r), 128 - r);
  const inSquare = x >= 0 && y >= 0 && x <= 128 && y <= 128 && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const d = Math.hypot(x - 64, y - 64);
  const inMark = (d <= MARK.ringOuter && d >= MARK.ringInner) || d <= MARK.dot;
  return { inSquare, inMark: inSquare && inMark };
}

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

/** RGBA PNG of the mark at `size` pixels. @param {string} accent @param {number} size @param {string} [mark] */
export function iconPng(accent, size, mark = "#FFFFFF") {
  const [ar, ag, ab] = rgb(accent);
  const [mr, mg, mb] = rgb(mark);
  const S = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let sq = 0;
      let mk = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const s = sample(((px + (sx + 0.5) / S) * 128) / size, ((py + (sy + 0.5) / S) * 128) / size);
          if (s.inSquare) sq++;
          if (s.inMark) mk++;
        }
      }
      const a = sq / (S * S);
      const m = sq ? mk / sq : 0;
      const o = 1 + px * 4;
      row[o] = Math.round(ar + (mr - ar) * m);
      row[o + 1] = Math.round(ag + (mg - ag) * m);
      row[o + 2] = Math.round(ab + (mb - ab) * m);
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
