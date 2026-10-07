import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

// Each project copies the template and renders every platform's icons: seconds on a shared CI runner, not milliseconds.
vi.setConfig({ testTimeout: 60_000 });
import {
  applyIdentity,
  copyTemplate,
  decodePng,
  extensionIdFromKey,
  iconPng,
  main,
  mainnetCheck,
  normalizeRootPackageJson,
  parseArgs,
  processTemplateManifest,
  readIcns,
  readIco,
  templateDir,
} from "../src/index.mjs";
import { restoreDotfiles } from "../src/template.mjs";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "create-clip-wallet-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const quiet = { log: () => {}, question: async () => "" };
const read = (f: string) => readFileSync(f, "utf8");
const json = (f: string) => JSON.parse(read(f));
const size = (f: string) => {
  const img = decodePng(readFileSync(f));
  return [img.width, img.height];
};

/** Every file under dir (relative), without .git and the private key. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git" || e.name === ".keys") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

const FLAGS = ["--name", "Acme Wallet", "--rdns", "com.acme.wallet", "--accent", "#0B7A3B", "--networks", "evm:*,hedera,ton,near", "--yes"];

describe("create-clip-wallet <folder>", () => {
  it("makes the extension, the desktop app and the phone app from one clip.config.ts, with the wallet's own identity", async () => {
    const target = join(tmp(), "acme-wallet");
    const out: string[] = [];
    expect(await main([target, ...FLAGS, "--id", "com.acme.app", "--languages", "en,de,ja", "--walletconnect-project-id", "a".repeat(32)], { ...quiet, log: (s) => out.push(s) })).toBe(0);

    // The create-scaffold-hbar copy step: template.json consumed, rename map applied.
    expect(existsSync(join(target, "template.json"))).toBe(false);
    expect(json(join(target, "package.json")).name).toBe("acme-wallet");
    for (const f of ["AGENTS.md", "llms.txt", "clip.config.ts", "wallet.identity.json", "MAINNET.md", "docs/signing.md", "tools/harness/check.mjs"]) {
      expect(existsSync(join(target, f)), f).toBe(true);
    }
    // Every platform; no Scaffold-HBAR dapp unless asked.
    expect(readdirSync(join(target, "packages")).sort()).toEqual(["desktop", "extension", "mobile"]);
    const scripts = json(join(target, "package.json")).scripts;
    expect(Object.keys(scripts).filter((k) => /next|lint|format/.test(k))).toEqual([]);
    expect(scripts.build).toBe("pnpm extension:build && pnpm desktop:build");
    expect(scripts["check-types"]).toBe("pnpm extension:check-types && pnpm desktop:check-types && pnpm mobile:check-types");
    expect(scripts).toMatchObject({ "dev:extension": "pnpm --filter @sh/extension dev", "dev:desktop": "pnpm --filter @sh/desktop dev", "dev:mobile": "pnpm --filter @sh/mobile start" });
    const readme = read(join(target, "README.md"));
    expect(readme).not.toMatch(/packages\/nextjs|platform:nextjs|only:nextjs/);
    expect(readme).toMatch(/platform:desktop/);
    expect(read(join(target, "AGENTS.md"))).not.toMatch(/### Change the dapp/);

    const id = json(join(target, "wallet.identity.json"));
    expect(id).toMatchObject({ name: "Acme Wallet", rdns: "com.acme.wallet", appId: "com.acme.app", icon: "./icon.svg" });
    expect(id.extension.key).toMatch(/^[A-Za-z0-9+/]{300,}={0,2}$/);
    const extId = extensionIdFromKey(id.extension.key);
    expect(extId).toMatch(/^[a-p]{32}$/);

    // The private key: at the root, 0600, never in git, never in the identity file.
    const pem = join(target, ".keys/extension.pem");
    expect(read(pem)).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(statSync(pem).mode & 0o077).toBe(0);
    expect(read(join(target, "wallet.identity.json"))).not.toMatch(/PRIVATE/);
    const tracked = execFileSync("git", ["ls-files"], { cwd: target }).toString();
    expect(tracked).toMatch(/^wallet\.identity\.json$/m);
    expect(tracked).not.toMatch(/\.pem|\.keys|\.env\b(?!\.example)/);

    const config = read(join(target, "clip.config.ts"));
    expect(config).toContain('accent: "#0B7A3B"');
    expect(config).toContain('networks: ["evm:*", "hedera", "ton", "near"]');
    expect(config).toContain('languages: ["en", "de", "ja"]');
    expect(config).toContain("mainnet: false,");
    expect(read(join(target, "icon.svg"))).toContain("#0B7A3B");
    expect(read(join(target, "packages/extension/src/entrypoints/popup/index.html"))).toContain("<title>Acme Wallet</title>");
    expect(read(join(target, ".env"))).toBe(`CLIP_WALLETCONNECT_PROJECT_ID=${"a".repeat(32)}\n`);

    // Icons for every platform, rendered from the one logo.
    for (const s of [16, 32, 48, 128]) expect(size(join(target, `packages/extension/public/icon/${s}.png`))).toEqual([s, s]);
    expect(readIcns(readFileSync(join(target, "packages/desktop/build/icon.icns"))).map((e) => decodePng(e.png).width)).toEqual([16, 32, 128, 256, 512, 1024, 32, 64, 256, 512]);
    expect(readIco(readFileSync(join(target, "packages/desktop/build/icon.ico"))).map((e) => e.size)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) expect(size(join(target, `packages/desktop/build/icons/${s}x${s}.png`))).toEqual([s, s]);
    expect(size(join(target, "packages/desktop/src/renderer/public/tray/trayTemplate@2x.png"))).toEqual([32, 32]);
    for (const f of ["icon", "adaptive-icon", "adaptive-monochrome", "splash-icon"]) expect(size(join(target, `packages/mobile/assets/${f}.png`))).toEqual([1024, 1024]);
    // iOS icons can't be transparent: the starter's mark sits on the accent colour, corner to corner.
    const ios = decodePng(readFileSync(join(target, "packages/mobile/assets/icon.png")));
    expect([...ios.data.subarray(0, 4)]).toEqual([0x0b, 0x7a, 0x3b, 255]);

    // Listing drafts for this identity, only for the families it turns on.
    const listings = readdirSync(join(target, "docs/listings")).sort();
    expect(listings).toEqual(["README.md", "eip-6963.md", "near.md", "ton-connect.md", "walletconnect-explorer.md"]);
    expect(read(join(target, "docs/listings/ton-connect.md"))).toContain('"app_name": "acmewallet"');
    expect(read(join(target, "docs/listings/walletconnect-explorer.md"))).toContain('"injected_id": "com.acme.wallet"');
    expect(read(join(target, "docs/listings/README.md"))).toContain(extId);

    const text = out.join("\n");
    expect(text).toContain(extId);
    expect(text).toContain("com.acme.app.desktop");
    expect(text).toContain("com.acme.app / com.acme.app");
    expect(text).toMatch(/pnpm dev:desktop/);
    expect(text).toMatch(/pnpm --filter mobile start/);
    expect(text).toMatch(/pnpm extension:zip/);
    expect(text).toMatch(/test networks/);
    expect(text).not.toMatch(/next:dev/);
    expect(text).not.toMatch(/PRIVATE KEY/);
  });

  it("--platforms and --scaffold-hbar choose the parts; scripts and docs follow", async () => {
    const target = join(tmp(), "phone-wallet");
    expect(await main([target, "--platforms", "mobile,desktop", "--scaffold-hbar", "--name", "Phone Wallet", "--yes", "--no-git"], quiet)).toBe(0);
    expect(readdirSync(join(target, "packages")).sort()).toEqual(["desktop", "mobile", "nextjs"]);
    const scripts = json(join(target, "package.json")).scripts;
    expect(Object.keys(scripts).filter((k) => k.includes("extension"))).toEqual([]);
    expect(scripts.build).toBe("pnpm desktop:build && pnpm next:build");
    expect(scripts["next:dev"]).toBe("pnpm --filter @sh/nextjs dev");
    expect(read(join(target, "README.md"))).not.toMatch(/packages\/extension|chrome-mv3/);
    expect(read(join(target, ".github/workflows/ci.yaml"))).not.toMatch(/extension:build/);
    expect(read(join(target, ".github/workflows/ci.yaml"))).toMatch(/mobile:export/);
    expect(existsSync(join(target, "packages/extension/public"))).toBe(false);
    // The dapp reads the identity from the root, so it works without the extension package.
    expect(read(join(target, "packages/nextjs/utils/wallet.ts"))).toContain('from "../../../wallet.identity.json"');
    expect(json(join(target, "packages/nextjs/package.json")).dependencies["@sh/extension"]).toBeUndefined();
    await expect(main([join(tmp(), "x"), "--platforms", "tv", "--yes"], quiet)).rejects.toThrow(/--platforms: tv isn't a platform/);
  });

  it("with --scaffold-hbar and every platform, produces the same project as create-scaffold-hbar's copy step followed by pnpm wallet:identity", async () => {
    const base = tmp();
    const viaCli = join(base, "same");
    expect(await main([viaCli, "--scaffold-hbar", ...FLAGS], quiet)).toBe(0);

    // create-scaffold-hbar: copy the tree (CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR path), process template.json, then the
    // project's own `pnpm wallet:identity` with the same answers.
    const other = join(base, "elsewhere");
    mkdirSync(other);
    const viaHbar = join(other, "same");
    mkdirSync(viaHbar);
    copyTemplate(templateDir(), viaHbar);
    normalizeRootPackageJson(viaHbar);
    processTemplateManifest(viaHbar, "same");
    expect(await main(["identity", "--root", viaHbar, ...FLAGS], quiet)).toBe(0);

    expect(tree(viaHbar)).toEqual(tree(viaCli));
    const keyA = json(join(viaCli, "wallet.identity.json")).extension.key;
    const keyB = json(join(viaHbar, "wallet.identity.json")).extension.key;
    const norm = (dir: string, key: string, f: string) => read(join(dir, f)).replaceAll(key, "KEY").replaceAll(extensionIdFromKey(key), "EXTID");
    for (const f of tree(viaCli)) {
      if (/\.(?:png|icns|ico)$/.test(f)) expect(readFileSync(join(viaHbar, f)).equals(readFileSync(join(viaCli, f))), f).toBe(true);
      else expect(norm(viaHbar, keyB, f), f).toBe(norm(viaCli, keyA, f));
    }
  }, 60_000);

  it("refuses Clip Wallet's identity, bad answers and full folders, and writes nothing", async () => {
    const base = tmp();
    await expect(main([join(base, "a"), "--name", "Clip Wallet", "--rdns", "org.coldai.clipwallet", "--yes"], quiet)).rejects.toThrow(
      /rdns: org.coldai.clipwallet belongs to Clip Wallet[\s\S]*name: Clip Wallet is taken/,
    );
    await expect(main([join(base, "b"), "--accent", "green", "--yes"], quiet)).rejects.toThrow(/theme.accent: use a hex colour/);
    await expect(main([join(base, "c"), "--id", "org.coldai.clipwallet", "--yes"], quiet)).rejects.toThrow(/appId: org.coldai.clipwallet belongs to Clip Wallet/);
    await expect(main([join(base, "d"), "--languages", "en,xx", "--yes"], quiet)).rejects.toThrow(/languages\.1: use the languages the wallet ships/);
    await expect(main([join(base, "e"), "--logo", join(base, "nope.png"), "--yes"], quiet)).rejects.toThrow(/logo: .*nope\.png isn't there/);
    for (const d of ["a", "b", "c", "d", "e"]) expect(existsSync(join(base, d))).toBe(false);
    writeFileSync(join(base, "keep.txt"), "x");
    await expect(main([base, "--yes"], quiet)).rejects.toThrow(/isn't empty/);
  });

  it("prompts for what the flags leave out, re-asking after a bad answer", async () => {
    const target = join(tmp(), "my-wallet");
    const replies = ["extension, tv", "mobile, extension", "", "", "com.me.wallet", "", "not-a-colour", "#123456", "", "evm:*, solana", "en, xx", "de, en"];
    const asked: string[] = [];
    await main([target, "--no-git"], {
      log: () => {},
      question: async (q) => {
        asked.push(q);
        return replies.shift() ?? "";
      },
    });
    expect(asked).toEqual([
      "Platforms (extension, desktop, mobile) (extension, desktop, mobile): ",
      "Platforms (extension, desktop, mobile) (extension, desktop, mobile): ",
      "Add the Scaffold-HBAR demo dapp? (y/N) (n): ",
      "Wallet name (My Wallet): ",
      "Reverse domain you own (EIP-6963 rdns) (com.example.mywallet): ",
      "App id for the desktop and phone apps (com.me.wallet): ",
      "Accent colour (#4F46E5): ",
      "Accent colour (#4F46E5): ",
      "Logo (.png or .svg; empty = a starter mark): ",
      "Networks (evm:*, hedera, solana, bitcoin): ",
      "Languages (en, de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi): ",
      "Languages (en, de, fr, es, pt-BR, it, tr, ja, ko, zh-Hans, ar, hi): ",
    ]);
    expect(readdirSync(join(target, "packages")).sort()).toEqual(["extension", "mobile"]);
    expect(json(join(target, "wallet.identity.json"))).toMatchObject({ name: "My Wallet", rdns: "com.me.wallet" });
    expect(json(join(target, "wallet.identity.json")).appId).toBeUndefined();
    expect(read(join(target, "clip.config.ts"))).toContain('networks: ["evm:*", "solana"]');
    expect(read(join(target, "clip.config.ts"))).toContain('languages: ["de", "en"]');
  });

  it("never switches mainnet on", () => {
    expect(() => parseArgs(["w", "--mainnet"])).toThrow(/New wallets start on test networks/);
  });
});

/** A 1024×1024 opaque PNG logo: a dark blue field with a white square in the middle. */
function logoPng(): Buffer {
  const lines: Buffer[] = [];
  for (let y = 0; y < 1024; y++) {
    const row = Buffer.alloc(1 + 1024 * 3);
    for (let x = 0; x < 1024; x++) {
      const inside = x >= 256 && x < 768 && y >= 256 && y < 768;
      row.set(inside ? [255, 255, 255] : [0x12, 0x34, 0x56], 1 + x * 3);
    }
    lines.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
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
  ihdr.writeUInt32BE(1024, 0);
  ihdr.writeUInt32BE(1024, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(lines))), chunk("IEND", Buffer.alloc(0))]);
}

describe("in a project", () => {
  it("identity keeps the extension key (and id) unless --new-key", async () => {
    const target = join(tmp(), "w");
    await main([target, ...FLAGS, "--no-git"], quiet);
    const key = json(join(target, "wallet.identity.json")).extension.key;
    await main(["identity", "--root", target, "--name", "Acme Pro", "--rdns", "com.acme.pro", "--yes"], quiet);
    const id = json(join(target, "wallet.identity.json"));
    expect(id).toMatchObject({ name: "Acme Pro", rdns: "com.acme.pro", extension: { key } });
    // The accent stays what clip.config.ts says.
    expect(read(join(target, "clip.config.ts"))).toContain('accent: "#0B7A3B"');
    await main(["identity", "--root", target, "--name", "Acme Pro", "--rdns", "com.acme.pro", "--new-key", "--yes"], quiet);
    expect(json(join(target, "wallet.identity.json")).extension.key).not.toBe(key);
  });

  it("brand renders every platform's icons from a PNG logo, and a later accent change keeps the logo", async () => {
    const target = join(tmp(), "w");
    await main([target, ...FLAGS, "--no-git"], quiet);
    const logo = join(tmp(), "logo.png");
    writeFileSync(logo, logoPng());
    const out: string[] = [];
    expect(await main(["brand", "--root", target, "--logo", logo], { ...quiet, log: (s) => out.push(s) })).toBe(0);
    expect(out.join("\n")).toMatch(/Rendered 24 icon files for extension, desktop, mobile/);
    expect(existsSync(join(target, "icon.png")) && !existsSync(join(target, "icon.svg"))).toBe(true);
    expect(json(join(target, "wallet.identity.json")).icon).toBe("./icon.png");
    // An opaque logo fills the iOS icon; the extension's 16 px icon is the logo scaled down (blue edge, white middle).
    const ios = decodePng(readFileSync(join(target, "packages/mobile/assets/icon.png")));
    expect([...ios.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 255]);
    const ext16 = decodePng(readFileSync(join(target, "packages/extension/public/icon/16.png")));
    expect([...ext16.data.subarray(0, 3)]).toEqual([0x12, 0x34, 0x56]);
    expect([...ext16.data.subarray((8 * 16 + 8) * 4, (8 * 16 + 8) * 4 + 3)]).toEqual([255, 255, 255]);
    // Android's themed icon and the macOS template: the logo's shape (the white square), not its background.
    const mono = decodePng(readFileSync(join(target, "packages/mobile/assets/adaptive-monochrome.png")));
    expect(mono.data[(512 * 1024 + 512) * 4 + 3]).toBe(255);
    expect(mono.data[(212 * 1024 + 512) * 4 + 3]).toBe(0);
    // A new accent later re-renders with the same logo (never back to the starter mark).
    await main(["identity", "--root", target, "--name", "Acme Wallet", "--rdns", "com.acme.wallet", "--accent", "#7A0B3B", "--yes"], quiet);
    expect(json(join(target, "wallet.identity.json")).icon).toBe("./icon.png");
    expect([...decodePng(readFileSync(join(target, "packages/mobile/assets/icon.png"))).data.subarray(0, 3)]).toEqual([0x12, 0x34, 0x56]);
  }, 60_000);

  it("listings regenerates the drafts from wallet.identity.json", async () => {
    const target = join(tmp(), "w");
    await main([target, ...FLAGS, "--no-git"], quiet);
    rmSync(join(target, "docs/listings/near.md"));
    const out: string[] = [];
    expect(await main(["listings", "--root", target], { ...quiet, log: (s) => out.push(s) })).toBe(0);
    expect(existsSync(join(target, "docs/listings/near.md"))).toBe(true);
    expect(read(join(target, "docs/listings/near.md"))).toContain('setupClipWallet({ globalKey: "acmewallet" })');
  });

  it("mainnet-check lists everything between the wallet and mainnet", async () => {
    const target = join(tmp(), "w");
    await main([target, "--name", "Acme", "--yes", "--no-git"], quiet);
    const { enabled, problems } = mainnetCheck(target);
    expect(enabled).toBe(false);
    expect(problems).toEqual(
      expect.arrayContaining([
        "rdns: com.example.acme is a placeholder; use a reverse domain you own",
        expect.stringMatching(/^homepage: /),
        expect.stringMatching(/^walletConnect: /),
        expect.stringMatching(/^clip.config.ts: mainnet needs/),
        expect.stringMatching(/^MAINNET.md: /),
      ]),
    );
    expect(await main(["mainnet-check", "--root", target], quiet)).toBe(2);
  });

  it("refuses to run outside a project", async () => {
    await expect(main(["identity", "--root", tmp(), "--yes"], quiet)).rejects.toThrow(/isn't a Clip Wallet project/);
    await expect(main(["brand", "--root", tmp()], quiet)).rejects.toThrow(/isn't a Clip Wallet project/);
  });
});

describe("pieces", () => {
  it("parses commands and options", () => {
    expect(parseArgs(["identity", "--name", "X", "-y"])).toMatchObject({ command: "identity", name: "X", yes: true });
    expect(parseArgs(["./identity"])).toMatchObject({ dir: "./identity" });
    expect(parseArgs(["w", "--platforms", "mobile, extension", "--scaffold-hbar", "--id", "com.x.y", "--logo", "l.png", "--languages", "en,de"])).toMatchObject({
      platforms: ["extension", "mobile"],
      scaffoldHbar: true,
      id: "com.x.y",
      logo: "l.png",
      languages: ["en", "de"],
    });
    expect(parseArgs(["w", "--icon", "l.svg"]).logo).toBe("l.svg");
    expect(() => parseArgs(["--colour", "x"])).toThrow(/Unknown option --colour/);
  });

  it("restores dotfiles npm won't pack", () => {
    const d = tmp();
    mkdirSync(join(d, "a"));
    writeFileSync(join(d, "_gitignore"), "x");
    writeFileSync(join(d, "a", "_npmrc"), "y");
    restoreDotfiles(d);
    expect(read(join(d, ".gitignore"))).toBe("x");
    expect(read(join(d, "a", ".npmrc"))).toBe("y");
  });

  it("draws PNG icons", () => {
    const png = iconPng("#FF3C00", 48);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(48);
  });

  it("applyIdentity validates before writing", () => {
    const d = tmp();
    expect(() => applyIdentity(d, { name: "A", rdns: "nope" })).toThrow(/rdns: use a reverse domain/);
    expect(readdirSync(d)).toEqual([]);
  });
});
