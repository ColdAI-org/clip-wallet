#!/usr/bin/env node
/**
 * Turns a README media run (apps/extension e2e/readme-media.spec.ts, `pnpm --filter @clip-wallet/extension media`)
 * plus the committed e2e and desktop screenshots into docs/media:
 *
 *   stills     <name>-{light,dark}.webp       from <run>/stills (720 px wide, cwebp)
 *   desktop    desktop-browser-{light,dark}.webp, desktop-home-{light,dark}.webp
 *   settle     settle-{offer,progress,arrived}-fixture.webp (committed fixture-build e2e screenshots)
 *   mosaics    pickers.webp (stock wallet pickers), approvals.webp (one approval per family, dapp matrix)
 *   animations onboarding.gif, send.gif (600 px), connect-sign.gif (900 px; dapp and approval window side by side),
 *              each sped up to about 10 s
 *
 *   node tools/media/build.mjs [--run apps/extension/.media] [--desktop-dark <dir>]
 *
 * Needs ffmpeg, gifski and cwebp (brew install ffmpeg gifski webp). Every frame and still that ends up in docs/media
 * is OCRed (macOS Vision through swiftc, when available) and the build fails if one reads like a recovery phrase:
 * six or more BIP-39 words in a row, or four or more words of the dapp matrix phrase.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const RUN = resolve(arg("--run", join(root, "apps/extension/.media")));
const DESKTOP_DARK = arg("--desktop-dark");
const OUT = join(root, "docs/media");
const TMP = join(tmpdir(), `clip-media-${process.pid}`);
const FPS = 15;
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).toString();
const webp = (src, dst, width, q = 84) => run("cwebp", ["-quiet", "-q", String(q), "-m", "6", ...(width ? ["-resize", String(width), "0"] : []), src, "-o", dst]);
const kept = []; // every image written to docs/media, for the OCR guard

/* ---------------------------------------------------------------- stills */
const stills = join(RUN, "stills");
for (const f of readdirSync(stills).filter((f) => f.endsWith(".png"))) {
  const dst = join(OUT, f.replace(/\.png$/, ".webp"));
  webp(join(stills, f), dst, f.startsWith("dapp-connected") ? 480 : 540);
  kept.push(join(stills, f));
}

/* ---------------------------------------------------------------- desktop (apps/desktop e2e screenshots) */
const desk = join(root, "apps/desktop/screenshots");
webp(join(desk, "browser-dapp-approval.png"), join(OUT, "desktop-browser-light.webp"), 1400);
webp(join(desk, "wallet-home.png"), join(OUT, "desktop-home-light.webp"), 520);
kept.push(join(desk, "browser-dapp-approval.png"), join(desk, "wallet-home.png"));
if (DESKTOP_DARK && existsSync(join(DESKTOP_DARK, "browser-dapp-approval.png"))) {
  webp(join(DESKTOP_DARK, "browser-dapp-approval.png"), join(OUT, "desktop-browser-dark.webp"), 1400);
  webp(join(DESKTOP_DARK, "wallet-home.png"), join(OUT, "desktop-home-dark.webp"), 520);
  kept.push(join(DESKTOP_DARK, "browser-dapp-approval.png"), join(DESKTOP_DARK, "wallet-home.png"));
}

/* ---------------------------------------------------------------- settle on Hedera (fixture-build e2e screenshots) */
const extShots = join(root, "apps/extension/screenshots");
for (const n of ["settle-offer", "settle-progress", "settle-arrived"]) {
  webp(join(extShots, `${n}.png`), join(OUT, `${n}-fixture.webp`), undefined, 86);
  kept.push(join(extShots, `${n}.png`));
}

/* ---------------------------------------------------------------- mosaics of committed e2e shots */
function mosaic(files, tile, cols, dst, { pad = 12, bg = "0xF2F1EE", crop } = {}) {
  const [w, h] = tile;
  const inputs = files.flatMap((f) => ["-i", f]);
  const each = files
    .map((_, i) => `[${i}]format=rgb24,${crop ? `crop=${crop},` : ""}scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1[t${i}]`)
    .join(";");
  const rows = Math.ceil(files.length / cols);
  const png = join(TMP, "mosaic.png");
  const filter = `${each};${files.map((_, i) => `[t${i}]`).join("")}concat=n=${files.length}:v=1:a=0,tile=${cols}x${rows}:padding=${pad}:margin=${pad}:color=${bg}[out]`;
  run("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", png]);
  webp(png, dst, undefined, 84);
  kept.push(...files);
}
const shots = join(root, "apps/extension/e2e/shots");
mosaic(
  ["rainbowkit", "appkit", "connectkit", "solana", "sui", "ton-clip", "near-clip", "stellar-clip", "talisman-clip"].map((n) => join(shots, "pickers", `${n}.png`)),
  [440, 330],
  3,
  join(OUT, "pickers.webp"),
  { crop: "880:660:110:70" }, // the picker modal, without most of the empty page around it
);
const FAMILIES = ["evm", "hedera-evm", "solana", "bitcoin", "sui", "aptos", "cardano", "substrate", "starknet", "ton", "near", "stellar", "tezos", "algorand"];
// Unfunded matrix accounts (Bitcoin, Aptos, NEAR) block their send approval with a reason; show their sign request.
const SIGN_INSTEAD = new Set(["bitcoin", "aptos", "near"]);
mosaic(
  FAMILIES.map((f) => join(shots, "matrix", `${f}-${SIGN_INSTEAD.has(f) ? "sign" : "approval"}.png`)),
  [240, 480],
  7,
  join(OUT, "approvals.webp"),
  { pad: 10 },
);

/* ---------------------------------------------------------------- animations */
/** concat-demuxer list for one recorded page: each frame lasts until the next; a privacy cut collapses to a short hold. */
function frameList(dir, { from, to, hold = 450, speed = 1 } = {}) {
  const { frames, cuts, closedAt } = JSON.parse(readFileSync(join(dir, "frames.json"), "utf8"));
  const end = to ?? closedAt;
  const items = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const next = i + 1 < frames.length ? frames[i + 1].t : end;
    let d = Math.min(next, end) - Math.max(f.t, from ?? f.t);
    const cut = cuts.find((c) => c >= f.t && c < next);
    if (cut !== undefined) d = Math.max(0, cut - f.t) + hold;
    if (d > 0) items.push({ file: f.file, ms: d / speed });
  }
  return { items, first: frames[0]?.t, end };
}
const listFile = (items, name) => {
  const p = join(TMP, `${name}.txt`);
  const lines = items.flatMap((x) => [`file '${x.file}'`, `duration ${(x.ms / 1000).toFixed(3)}`]);
  lines.push(`file '${items.at(-1).file}'`); // the concat demuxer ignores the last duration otherwise
  writeFileSync(p, `${lines.join("\n")}\n`);
  return p;
};
const total = (items) => items.reduce((s, x) => s + x.ms, 0);

function gif(name, filter, inputs, width) {
  const dir = join(TMP, `${name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  run("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", filter, "-map", "[out]", join(dir, "%05d.png")]);
  const frames = readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => join(dir, f));
  kept.push(...frames);
  const out = join(OUT, `${name}.gif`);
  run("gifski", ["--quiet", "--fps", String(FPS), "--quality", "80", "--motion-quality", "80", "--width", String(width), "-o", out, ...frames]);
  return { out, seconds: frames.length / FPS };
}

/** A popup flow, sped up to fit the target length. */
function popupGif(name, maxSeconds) {
  const dir = join(RUN, "rec", name);
  const raw = frameList(dir);
  const speed = Math.max(1, total(raw.items) / 1000 / maxSeconds);
  const { items } = frameList(dir, { speed });
  return gif(name, `[0]fps=${FPS},scale=600:-2:flags=lanczos[out]`, ["-f", "concat", "-safe", "0", "-i", listFile(items, name)], 600);
}

/** The dapp page and the approval windows on one stage, on the dapp recording's clock. */
function connectGif(maxSeconds) {
  const dapp = frameList(join(RUN, "rec", "connect-dapp"));
  const t0 = dapp.first;
  const approvals = readdirSync(join(RUN, "rec")).filter((d) => d.startsWith("connect-approval-")).sort().map((d) => frameList(join(RUN, "rec", d)));
  const idle = join(RUN, "rec", "idle.png");
  const right = [];
  let at = t0;
  for (const a of approvals) {
    if (a.first > at) right.push({ file: idle, ms: a.first - at });
    right.push(...a.items);
    at = a.end;
  }
  if (dapp.end > at) right.push({ file: idle, ms: dapp.end - at });
  const speed = Math.max(1, total(dapp.items) / 1000 / maxSeconds);
  const scale = (xs) => xs.map((x) => ({ ...x, ms: x.ms / speed }));
  const filter = [
    `color=c=0xE2E0DA:s=1800x1280:r=${FPS}[bg]`,
    `[0]fps=${FPS},scale=960:1200[a]`,
    `[1]fps=${FPS},scale=720:1200[b]`,
    "[bg][a]overlay=40:40:shortest=1[x]",
    "[x][b]overlay=1040:40:shortest=1,scale=900:-2:flags=lanczos[out]",
  ].join(";");
  return gif("connect-sign", filter, ["-f", "concat", "-safe", "0", "-i", listFile(scale(dapp.items), "dapp"), "-f", "concat", "-safe", "0", "-i", listFile(scale(right), "right")], 900);
}

const anims = [popupGif("onboarding", 10), popupGif("send", 10), connectGif(10.5)];

/* ---------------------------------------------------------------- OCR guard */
async function ocrGuard(files) {
  let swiftc;
  try {
    swiftc = run("which", ["swiftc"]).trim();
  } catch {
    process.stderr.write("media: no swiftc (macOS Vision); skipping the OCR phrase guard. Check the frames by eye.\n");
    return;
  }
  const src = join(TMP, "ocr.swift");
  writeFileSync(
    src,
    `import Foundation\nimport Vision\nimport AppKit\nfor p in CommandLine.arguments.dropFirst() {\n  guard let i = NSImage(contentsOfFile: p), let c = i.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }\n  let r = VNRecognizeTextRequest(); r.recognitionLevel = .accurate; r.usesLanguageCorrection = false\n  try? VNImageRequestHandler(cgImage: c).perform([r])\n  print(p + "\\t" + (r.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ").replacingOccurrences(of: "\\n", with: " "))\n}\n`,
  );
  const bin = join(TMP, "ocr");
  run(swiftc, ["-O", src, "-o", bin]);
  const req = createRequire(join(root, "packages/vault/package.json"));
  const { wordlist } = await import(pathToFileURL(req.resolve("@scure/bip39/wordlists/english.js")).href);
  const wl = new Set(wordlist);
  const env = [join(root, ".env.dapp-matrix")].find(existsSync);
  const secret = env ? new Set((readFileSync(env, "utf8").match(/^DAPP_MATRIX_MNEMONIC\s*=\s*["']?([^"'\n]+)/m)?.[1] ?? "").toLowerCase().split(/\s+/).filter(Boolean)) : new Set();
  const bad = [];
  for (let i = 0; i < files.length; i += 200) {
    for (const line of run(bin, files.slice(i, i + 200)).split("\n").filter(Boolean)) {
      const [file, text = ""] = line.split("\t");
      const toks = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      let runLen = 0;
      let best = 0;
      for (const t of toks) best = Math.max(best, (runLen = wl.has(t) ? runLen + 1 : 0));
      const hits = new Set(toks.filter((t) => secret.has(t))).size;
      if (best >= 6 || hits >= 4) bad.push(`${file} (BIP-39 run ${best}, matrix-phrase words ${hits})`);
    }
  }
  if (bad.length) {
    for (const f of [...anims.map((a) => a.out)]) rmSync(f, { force: true });
    throw new Error(`media: these frames read like a recovery phrase; nothing animated was kept:\n${bad.join("\n")}`);
  }
  process.stdout.write(`media: OCR guard checked ${files.length} images, none reads like a recovery phrase\n`);
}
await ocrGuard(kept);

/* ---------------------------------------------------------------- report */
let sum = 0;
for (const f of readdirSync(OUT).sort()) {
  const kb = statSync(join(OUT, f)).size / 1024;
  sum += kb;
  const a = anims.find((x) => x.out === join(OUT, f));
  process.stdout.write(`${f.padEnd(36)} ${kb.toFixed(0).padStart(6)} KB${a ? `  ${a.seconds.toFixed(1)} s` : ""}\n`);
}
process.stdout.write(`total ${(sum / 1024).toFixed(2)} MB\n`);
rmSync(TMP, { recursive: true, force: true });
