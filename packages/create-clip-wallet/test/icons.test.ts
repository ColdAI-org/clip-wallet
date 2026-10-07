import { describe, expect, it } from "vitest";
import { platformIds, defineConfig } from "@clip-wallet/config";
import {
  canvas,
  decodePng,
  encodeIcns,
  encodeIco,
  encodePng,
  fit,
  iconPlan,
  isOpaque,
  readIcns,
  readIco,
  resize,
  silhouette,
  starterRasters,
} from "../src/icons.mjs";
import { pruneScripts, stripParts } from "../src/template.mjs";
import { deflateSync } from "node:zlib";

/** A minimal PNG from raw scanlines (each with its filter byte), for decoder tests. */
function pngOf(w: number, h: number, depth: number, type: number, rows: Buffer[], extra: Record<string, Buffer> = {}): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = type;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    ...Object.entries(extra).map(([t, d]) => chunk(t, d)),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("iconPlan: one logo → every platform's icon files", () => {
  it("lists exactly the files each platform needs", () => {
    const by = (platforms: ("extension" | "desktop" | "mobile")[]) => iconPlan(platforms).map((p) => p.file);
    expect(by(["extension"])).toEqual(["icon.svg", ...[16, 32, 48, 128].map((s) => `packages/extension/public/icon/${s}.png`)]);
    const desktop = by(["desktop"]);
    expect(desktop).toContain("packages/desktop/build/icon.icns");
    expect(desktop).toContain("packages/desktop/build/icon.ico");
    expect(desktop).toContain("packages/desktop/build/icons/1024x1024.png");
    expect(desktop.filter((f) => f.includes("/tray/"))).toEqual(["tray.png", "tray@2x.png", "trayTemplate.png", "trayTemplate@2x.png"].map((f) => `packages/desktop/src/renderer/public/tray/${f}`));
    expect(by(["mobile"]).slice(1)).toEqual(["icon", "adaptive-icon", "adaptive-monochrome", "splash-icon"].map((f) => `packages/mobile/assets/${f}.png`));
    expect(iconPlan(["mobile"], { logoExt: ".png" })[0]!.file).toBe("icon.png");
    expect(iconPlan(["extension", "desktop", "mobile"])).toHaveLength(24);
  });

  it("the icon files are the ones the platform configs point at", async () => {
    const { DESKTOP_ICONS } = await import("../../desktop-kit/src/builder");
    const { MOBILE_ASSETS } = await import("../../mobile-kit/src/expo");
    const files = iconPlan(["desktop", "mobile"]).map((p) => p.file);
    expect(files).toContain(`packages/desktop/${DESKTOP_ICONS.mac}`);
    expect(files).toContain(`packages/desktop/${DESKTOP_ICONS.win}`);
    expect(files).toContain(`packages/desktop/${DESKTOP_ICONS.linux}/512x512.png`);
    for (const f of Object.values(MOBILE_ASSETS)) expect(files).toContain(`packages/mobile/${f.replace(/^\.\//, "")}`);
  });
});

describe("PNG, ICO and ICNS with Node alone", () => {
  it("round-trips RGBA and decodes grey, RGB and palette PNGs", () => {
    const img = canvas(3, 2, [10, 20, 30, 128]);
    img.data.set([255, 0, 0, 255], 4);
    const back = decodePng(encodePng(img));
    expect(back).toMatchObject({ width: 3, height: 2 });
    expect([...back.data]).toEqual([...img.data]);
    // A 2×1 palette PNG (bit depth 1) with a transparent first entry, as image editors write them.
    const pal = pngOf(2, 1, 1, 3, [Buffer.from([0, 0b01000000])], { PLTE: Buffer.from([0, 0, 0, 255, 0, 0]), tRNS: Buffer.from([0]) });
    expect([...decodePng(pal).data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255]);
    // 8-bit grey with alpha, and 16-bit RGB.
    expect([...decodePng(pngOf(1, 1, 8, 4, [Buffer.from([0, 200, 100])])).data]).toEqual([200, 200, 200, 100]);
    expect([...decodePng(pngOf(1, 1, 16, 2, [Buffer.from([0, 1, 2, 3, 4, 5, 6])])).data]).toEqual([1, 3, 5, 255]);
    expect(() => decodePng(Buffer.from("not a png"))).toThrow(/not a PNG/);
  });

  it("writes Windows .ico and macOS .icns containers with PNG entries", () => {
    const png = (s: number) => encodePng(canvas(s, s, [1, 2, 3, 255]));
    const ico = encodeIco([16, 256].map((s) => ({ size: s, png: png(s) })));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(readIco(ico).map((e) => [e.size, decodePng(e.png).width])).toEqual([
      [16, 16],
      [256, 256],
    ]);
    const icns = encodeIcns([
      { type: "ic07", png: png(128) },
      { type: "ic10", png: png(1024) },
    ]);
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(readIcns(icns).map((e) => [e.type, decodePng(e.png).width])).toEqual([
      ["ic07", 128],
      ["ic10", 1024],
    ]);
  });
});

describe("raster operations", () => {
  it("shrinks by area average with premultiplied alpha (no dark fringes)", () => {
    const src = canvas(4, 1);
    src.data.set([255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    const half = resize(src, 2, 1);
    expect([...half.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    const one = resize(src, 1, 1);
    expect([...one.data]).toEqual([255, 255, 255, 128]);
  });

  it("fits a logo into a box on a background, keeping its aspect ratio", () => {
    const logo = canvas(20, 10, [255, 0, 0, 255]);
    const out = fit(logo, 40, 20, "#0000FF");
    expect([...out.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...out.data.subarray((20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 4)]).toEqual([255, 0, 0, 255]);
    expect(isOpaque(out)).toBe(true);
    expect(isOpaque(fit(logo, 40, 20))).toBe(false);
  });

  it("makes a one-colour silhouette from alpha, or from contrast with the background for opaque art", () => {
    const transparent = canvas(2, 1);
    transparent.data.set([9, 9, 9, 255, 9, 9, 9, 0]);
    expect([...silhouette(transparent, "#FFFFFF").data]).toEqual([255, 255, 255, 255, 255, 255, 255, 0]);
    const opaque = canvas(200, 1, [0, 0, 128, 255]);
    opaque.data.set([255, 255, 255, 255], 100 * 4);
    const s = silhouette(opaque, "#000000");
    expect(s.data[3]).toBe(0);
    expect(s.data[100 * 4 + 3]).toBe(255);
  });

  it("draws the starter mark: the whole mark and the white glyph", () => {
    const { full, glyph } = starterRasters("#4F46E5", 128);
    expect([...full.data.subarray((64 * 128 + 5) * 4, (64 * 128 + 5) * 4 + 4)]).toEqual([0x4f, 0x46, 0xe5, 255]);
    expect(full.data[3]).toBe(0);
    expect([...glyph.data.subarray((64 * 128 + 64) * 4, (64 * 128 + 64) * 4 + 4)]).toEqual([255, 255, 255, 255]);
    expect(glyph.data[(64 * 128 + 5) * 4 + 3]).toBe(0);
  });
});

describe("config → platform mappers used by the project", () => {
  it("ids for every platform come from clip.config", () => {
    const ids = platformIds(defineConfig({ name: "Acme Wallet", rdns: "com.acme.wallet", appId: "com.example.mywallet" }));
    expect([ids.desktop.appId, ids.ios.bundleIdentifier, ids.android.package, ids.scheme]).toEqual(["com.example.mywallet.desktop", "com.example.mywallet", "com.example.mywallet", "acmewallet"]);
  });
});

describe("parts of a project", () => {
  it("strips the sections of parts that aren't there and keeps everything else byte for byte", () => {
    const text = [
      "a",
      "<!-- platform:desktop -->",
      "desktop text",
      "<!-- /platform:desktop -->",
      "# platform:mobile",
      "mobile: yes",
      "# /platform:mobile",
      "| row | desktop only <!-- only:desktop --> |",
      "// platform:nextjs",
      "dapp();",
      "// /platform:nextjs",
      "z",
    ].join("\n");
    expect(stripParts(text, new Set(["desktop", "mobile", "nextjs"]))).toBe(text);
    expect(stripParts(text, new Set(["mobile"]))).toBe(["a", "# platform:mobile", "mobile: yes", "# /platform:mobile", "z"].join("\n"));
    expect(() => stripParts("<!-- platform:desktop -->\nx", new Set())).toThrow(/unclosed/);
  });

  it("prunes root scripts of removed packages, including steps of composite scripts", () => {
    const scripts = {
      build: "pnpm extension:build && pnpm desktop:build && pnpm next:build",
      "extension:build": "pnpm --filter @sh/extension build",
      "desktop:build": "pnpm --filter @sh/desktop build",
      "next:build": "pnpm --filter @sh/nextjs build",
      "next:lint": "pnpm --filter @sh/nextjs lint",
      lint: "pnpm next:lint",
      harness: "node tools/harness/check.mjs",
    };
    expect(pruneScripts(scripts, ["extension", "nextjs"])).toEqual({ build: "pnpm desktop:build", "desktop:build": "pnpm --filter @sh/desktop build", harness: "node tools/harness/check.mjs" });
    expect(pruneScripts(scripts, ["extension", "desktop", "nextjs"])).toEqual({ harness: "node tools/harness/check.mjs" });
  });
});
