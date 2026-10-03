import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig } from "@clip-wallet/config";
import { afterEach, describe, expect, it } from "vitest";
import { main, parseArgs, parseNetworks, renderConfig, scaffold, slugFromDir, titleFromDir } from "../src/index.mjs";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "create-clip-wallet-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Evaluate the object literal passed to defineConfig in a generated clip.config.ts. */
function configObject(source: string): unknown {
  const body = source.slice(source.indexOf("defineConfig(") + "defineConfig(".length, source.lastIndexOf(");"));
  return new Function(`return (${body});`)();
}

const answers = { name: "Acme Wallet", rdns: "com.acme.wallet", accent: "#0B7A3B", networks: ["evm:84532", "hedera"] };

describe("renderConfig", () => {
  it("writes a clip.config.ts that the schema accepts, testnet only", () => {
    const src = renderConfig(answers);
    expect(src).toMatch(/^import \{ defineConfig \} from "@clip-wallet\/config";/);
    const obj = configObject(src) as Record<string, unknown>;
    expect(obj).toMatchObject({ name: "Acme Wallet", rdns: "com.acme.wallet", theme: { accent: "#0B7A3B", accentText: "#FFFFFF" }, networks: ["evm:84532", "hedera"], mainnet: false });
    expect(validateConfig(obj).ok).toBe(true);
  });

  it("escapes names safely", () => {
    const src = renderConfig({ ...answers, name: 'Bob\'s "Best" Wallet' });
    expect((configObject(src) as { name: string }).name).toBe('Bob\'s "Best" Wallet');
  });

  it("refuses answers the schema rejects, in plain words", () => {
    expect(() => renderConfig({ ...answers, accent: "green", networks: ["ethereum"] })).toThrow(
      /theme.accent: use a hex colour like #4F46E5\n {2}- networks.0: use "evm:\*"/,
    );
  });
});

describe("scaffold", () => {
  it("copies the template, renames dotfiles, names the package and writes the config", () => {
    const target = join(tmp(), "acme-wallet");
    const r = scaffold(target, { name: "Acme", accent: "#0B7A3B", networks: ["hedera"] });
    expect(r.slug).toBe("acme-wallet");
    expect(r.rdns).toBe("com.example.acmewallet");
    for (const f of [".gitignore", ".env.example", "clip.config.ts", "package.json", "tsconfig.json", "icon.svg", "src/theme.ts"]) {
      expect(existsSync(join(target, f)), f).toBe(true);
    }
    expect(existsSync(join(target, "gitignore"))).toBe(false);
    expect(readFileSync(join(target, ".gitignore"), "utf8")).toMatch(/^\.env$/m);
    expect(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).name).toBe("acme-wallet");
    expect(configObject(readFileSync(join(target, "clip.config.ts"), "utf8"))).toMatchObject({ name: "Acme", networks: ["hedera"] });
    expect(readFileSync(join(target, "icon.svg"), "utf8")).toContain("#0B7A3B");
    // In the monorepo the harness is copied from tools/harness.
    expect(r.harness).toBe(true);
    expect(existsSync(join(target, "tools/harness/check.mjs"))).toBe(true);
  });

  it("won't overwrite a folder with files in it, and writes nothing on bad answers", () => {
    const target = tmp();
    writeFileSync(join(target, "keep.txt"), "x");
    expect(() => scaffold(target, { name: "A", accent: "#000000", networks: ["hedera"] })).toThrow(/isn't empty/);
    const fresh = join(tmp(), "fresh");
    expect(() => scaffold(fresh, { name: "A", accent: "nope", networks: ["hedera"] })).toThrow(/theme.accent/);
    expect(existsSync(fresh)).toBe(false);
  });
});

describe("CLI", () => {
  it("prompts for name, accent and networks, re-asking after a bad answer, and prints next steps", async () => {
    const target = join(tmp(), "my-wallet");
    const replies = ["", "not-a-colour", "#123456", "evm:*, solana"];
    const asked: string[] = [];
    const out: string[] = [];
    const code = await main([target], {
      question: async (q) => {
        asked.push(q);
        return replies.shift() ?? "";
      },
      log: (s) => out.push(s),
    });
    expect(code).toBe(0);
    expect(asked).toEqual([
      "Wallet name (My Wallet): ",
      "Accent colour (#4F46E5): ",
      "Accent colour (#4F46E5): ",
      "Networks (evm:*, hedera, solana, bitcoin): ",
    ]);
    expect(configObject(readFileSync(join(target, "clip.config.ts"), "utf8"))).toMatchObject({
      name: "My Wallet",
      theme: { accent: "#123456" },
      networks: ["evm:*", "solana"],
    });
    const text = out.join("\n");
    expect(text).toMatch(/pnpm harness/);
    expect(text).toMatch(/test networks by default/);
    expect(text).toMatch(/EXPERIMENTAL/);
  });

  it("takes flags and --yes without prompting", async () => {
    const target = join(tmp(), "flags");
    const code = await main([target, "--name", "Flagged", "--accent", "#000000", "--networks", "hedera,bitcoin", "--yes"], {
      question: async () => {
        throw new Error("should not prompt");
      },
      log: () => {},
    });
    expect(code).toBe(0);
    expect(configObject(readFileSync(join(target, "clip.config.ts"), "utf8"))).toMatchObject({ name: "Flagged", networks: ["hedera", "bitcoin"] });
  });

  it("parses args and names", () => {
    expect(parseArgs(["w", "-y"])).toMatchObject({ dir: "w", yes: true });
    expect(() => parseArgs(["--colour", "x"])).toThrow(/Unknown option --colour/);
    expect(parseNetworks("evm:*,  hedera solana")).toEqual(["evm:*", "hedera", "solana"]);
    expect(titleFromDir("/x/my-cool_wallet")).toBe("My Cool Wallet");
    expect(slugFromDir("/x/My Wallet!")).toBe("my-wallet");
  });
});
