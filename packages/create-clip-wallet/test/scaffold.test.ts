import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyIdentity,
  copyTemplate,
  extensionIdFromKey,
  iconPng,
  main,
  mainnetCheck,
  normalizeRootPackageJson,
  parseArgs,
  processTemplateManifest,
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
  it("copies the Scaffold-HBAR template and gives the wallet its own identity", async () => {
    const target = join(tmp(), "acme-wallet");
    const out: string[] = [];
    expect(await main([target, ...FLAGS, "--walletconnect-project-id", "a".repeat(32)], { ...quiet, log: (s) => out.push(s) })).toBe(0);

    // The create-scaffold-hbar copy step: template.json consumed, rename map applied.
    expect(existsSync(join(target, "template.json"))).toBe(false);
    expect(json(join(target, "package.json")).name).toBe("acme-wallet");
    for (const f of ["AGENTS.md", "llms.txt", ".harness/spec.yaml", ".github/workflows/ci.yaml", ".github/workflows/fresh-scaffold.yaml", "packages/nextjs/app/debug/page.tsx", "packages/extension/MAINNET.md", "tools/harness/check.mjs"]) {
      expect(existsSync(join(target, f)), f).toBe(true);
    }

    const id = json(join(target, "packages/extension/wallet.identity.json"));
    expect(id).toMatchObject({ name: "Acme Wallet", rdns: "com.acme.wallet", icon: "./icon.svg" });
    expect(id.extension.key).toMatch(/^[A-Za-z0-9+/]{300,}={0,2}$/);
    const extId = extensionIdFromKey(id.extension.key);
    expect(extId).toMatch(/^[a-p]{32}$/);

    // The private key: next to the extension, 0600, never in git, never in the identity file.
    const pem = join(target, "packages/extension/.keys/extension.pem");
    expect(read(pem)).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(statSync(pem).mode & 0o077).toBe(0);
    expect(read(join(target, "packages/extension/wallet.identity.json"))).not.toMatch(/PRIVATE/);
    const tracked = execFileSync("git", ["ls-files"], { cwd: target }).toString();
    expect(tracked).toMatch(/packages\/extension\/wallet\.identity\.json/);
    expect(tracked).not.toMatch(/\.pem|\.keys|\.env\b(?!\.example)/);

    const config = read(join(target, "packages/extension/clip.config.ts"));
    expect(config).toContain('accent: "#0B7A3B"');
    expect(config).toContain('networks: ["evm:*", "hedera", "ton", "near"]');
    expect(config).toContain("mainnet: false,");
    expect(read(join(target, "packages/extension/icon.svg"))).toContain("#0B7A3B");
    expect(read(join(target, "packages/extension/public/icon/128.png")).length).toBeGreaterThan(100);
    expect(read(join(target, "packages/extension/src/entrypoints/popup/index.html"))).toContain("<title>Acme Wallet</title>");
    expect(read(join(target, "packages/extension/.env"))).toBe(`CLIP_WALLETCONNECT_PROJECT_ID=${"a".repeat(32)}\n`);
    expect(read(join(target, "packages/nextjs/.env.local"))).toBe(`NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID=${"a".repeat(32)}\n`);

    // Listing drafts for this identity, only for the families it turns on.
    const listings = readdirSync(join(target, "docs/listings")).sort();
    expect(listings).toEqual(["README.md", "eip-6963.md", "near.md", "ton-connect.md", "walletconnect-explorer.md"]);
    expect(read(join(target, "docs/listings/ton-connect.md"))).toContain('"app_name": "acmewallet"');
    expect(read(join(target, "docs/listings/walletconnect-explorer.md"))).toContain('"injected_id": "com.acme.wallet"');
    expect(read(join(target, "docs/listings/README.md"))).toContain(extId);
    expect(read(join(target, "docs/listings/README.md"))).toMatch(/Stellar Wallets Kit \| not drafted: Stellar is off/);

    const text = out.join("\n");
    expect(text).toContain(extId);
    expect(text).toMatch(/pnpm install/);
    expect(text).toMatch(/test networks/);
    expect(text).not.toMatch(/PRIVATE KEY/);
  });

  it("produces the same project as create-scaffold-hbar's copy step followed by pnpm wallet:identity", async () => {
    const base = tmp();
    const viaCli = join(base, "same");
    expect(await main([viaCli, ...FLAGS], quiet)).toBe(0);

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
    const keyA = json(join(viaCli, "packages/extension/wallet.identity.json")).extension.key;
    const keyB = json(join(viaHbar, "packages/extension/wallet.identity.json")).extension.key;
    const norm = (dir: string, key: string, f: string) => read(join(dir, f)).replaceAll(key, "KEY").replaceAll(extensionIdFromKey(key), "EXTID");
    for (const f of tree(viaCli)) {
      if (f.endsWith(".png")) expect(readFileSync(join(viaHbar, f)).equals(readFileSync(join(viaCli, f))), f).toBe(true);
      else expect(norm(viaHbar, keyB, f), f).toBe(norm(viaCli, keyA, f));
    }
  });

  it("refuses Clip Wallet's identity, bad answers and full folders, and writes nothing", async () => {
    const base = tmp();
    await expect(main([join(base, "a"), "--name", "Clip Wallet", "--rdns", "org.coldai.clipwallet", "--yes"], quiet)).rejects.toThrow(
      /rdns: org.coldai.clipwallet belongs to Clip Wallet[\s\S]*name: Clip Wallet is taken/,
    );
    await expect(main([join(base, "b"), "--accent", "green", "--yes"], quiet)).rejects.toThrow(/theme.accent: use a hex colour/);
    expect(existsSync(join(base, "a"))).toBe(false);
    expect(existsSync(join(base, "b"))).toBe(false);
    writeFileSync(join(base, "keep.txt"), "x");
    await expect(main([base, "--yes"], quiet)).rejects.toThrow(/isn't empty/);
  });

  it("prompts for what the flags leave out, re-asking after a bad answer", async () => {
    const target = join(tmp(), "my-wallet");
    const replies = ["", "com.me.wallet", "not-a-colour", "#123456", "evm:*, solana"];
    const asked: string[] = [];
    await main([target], {
      log: () => {},
      question: async (q) => {
        asked.push(q);
        return replies.shift() ?? "";
      },
    });
    expect(asked).toEqual([
      "Wallet name (My Wallet): ",
      "Reverse domain you own (EIP-6963 rdns) (com.example.mywallet): ",
      "Accent colour (#4F46E5): ",
      "Accent colour (#4F46E5): ",
      "Networks (evm:*, hedera, solana, bitcoin): ",
    ]);
    expect(json(join(target, "packages/extension/wallet.identity.json"))).toMatchObject({ name: "My Wallet", rdns: "com.me.wallet" });
    expect(read(join(target, "packages/extension/clip.config.ts"))).toContain('networks: ["evm:*", "solana"]');
  });

  it("never switches mainnet on", () => {
    expect(() => parseArgs(["w", "--mainnet"])).toThrow(/New wallets start on test networks/);
  });
});

describe("in a project", () => {
  it("identity keeps the extension key (and id) unless --new-key", async () => {
    const target = join(tmp(), "w");
    await main([target, ...FLAGS, "--no-git"], quiet);
    const key = json(join(target, "packages/extension/wallet.identity.json")).extension.key;
    await main(["identity", "--root", target, "--name", "Acme Pro", "--rdns", "com.acme.pro", "--yes"], quiet);
    const id = json(join(target, "packages/extension/wallet.identity.json"));
    expect(id).toMatchObject({ name: "Acme Pro", rdns: "com.acme.pro", extension: { key } });
    // The accent stays what clip.config.ts says.
    expect(read(join(target, "packages/extension/clip.config.ts"))).toContain('accent: "#0B7A3B"');
    await main(["identity", "--root", target, "--name", "Acme Pro", "--rdns", "com.acme.pro", "--new-key", "--yes"], quiet);
    expect(json(join(target, "packages/extension/wallet.identity.json")).extension.key).not.toBe(key);
  });

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
  });
});

describe("pieces", () => {
  it("parses commands and options", () => {
    expect(parseArgs(["identity", "--name", "X", "-y"])).toMatchObject({ command: "identity", name: "X", yes: true });
    expect(parseArgs(["./identity"])).toMatchObject({ dir: "./identity" });
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
