/**
 * Every code snippet in the docs compiles, and the ones that can run without a wallet or a network run and print
 * what the docs say they print.
 *
 *   1. src/snippets/**: the only TypeScript the pages show (included with `<<< @/snippets/…`). Typechecked against
 *      the real workspace packages, with the repo's strict compiler options.
 *   2. Pages: no inline TypeScript or JavaScript (so nothing escapes step 1); every include points at a real file and
 *      region; JSON blocks parse; `pnpm --filter <package> <script>` commands name a real package and script.
 *   3. packages/*\/README.md: every ts/tsx block typechecks the same way; js blocks parse.
 *   4. Runtime: the runnable snippets run (no keys, no network: fetch is faked where a snippet reads a chain).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(docs, "..", "..");
const src = join(docs, "src");
const snippets = join(src, "snippets");

/** Generated pages (scripts/generate.mjs): their code blocks come from TypeDoc and the source, not from people. */
const GENERATED = [/^reference\/api\//, /^reference\/(config|errors|warnings|dapp-errors|cli)\.md$/, /^testing\/results\//];

function walk(dir: string, keep: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".vitepress" || e === "public") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const pages = () => walk(src, (f) => f.endsWith(".md")).filter((f) => !GENERATED.some((re) => re.test(relative(src, f))));

interface Fence {
  lang: string;
  body: string;
  line: number;
}
function fences(markdown: string): Fence[] {
  const out: Fence[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})(\S*)/.exec(lines[i]!);
    if (!open) continue;
    const [, indent, ticks, info] = open;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !lines[j]!.startsWith(`${indent}${ticks}`); j++) body.push(lines[j]!.slice(indent!.length));
    out.push({ lang: (info ?? "").replace(/[{:].*$/, "").toLowerCase(), body: body.join("\n"), line: i + 1 });
    i = j;
  }
  return out;
}

function typecheck(files: string[], label: string): string[] {
  const configPath = join(snippets, "tsconfig.json");
  const cfg = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined })!;
  const program = ts.createProgram(files, { ...cfg.options, noEmit: true });
  return ts.getPreEmitDiagnostics(program).map((d) => {
    const where = d.file && d.start !== undefined ? `${relative(root, d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : label;
    return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
  });
}

/* ------------------------------------------------------------------ 1. snippets */

describe("snippets typecheck against the real packages", () => {
  it("src/snippets/** has no type errors", () => {
    const files = walk(snippets, (f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(40);
    expect(typecheck(files, "snippets")).toEqual([]);
  }, 180_000);
});

/* ------------------------------------------------------------------ 2. pages */

describe("pages", () => {
  const all = pages();

  it("show TypeScript and JavaScript only through checked includes", () => {
    const inline: string[] = [];
    for (const f of all) {
      for (const block of fences(readFileSync(f, "utf8"))) {
        if (/^(ts|tsx|typescript|js|jsx|javascript|mjs|cjs|vue)$/.test(block.lang)) inline.push(`${relative(src, f)}:${block.line} (${block.lang})`);
      }
    }
    expect(inline).toEqual([]);
  });

  it("include files and regions that exist", () => {
    const broken: string[] = [];
    let count = 0;
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/^<<< @\/(\S+?)(?:#([\w-]+))?(?:\{[^}]*\})?(?:\s.*)?$/gm)) {
        count++;
        const file = join(src, m[1]!);
        if (!existsSync(file)) {
          broken.push(`${relative(src, f)}: ${m[1]} doesn't exist`);
          continue;
        }
        if (m[2] && !readFileSync(file, "utf8").includes(`#region ${m[2]}`)) broken.push(`${relative(src, f)}: ${m[1]} has no region ${m[2]}`);
      }
    }
    expect(broken).toEqual([]);
    expect(count).toBeGreaterThan(40);
  });

  it("every snippet file is shown somewhere", () => {
    const used = new Set<string>();
    for (const f of all) for (const m of readFileSync(f, "utf8").matchAll(/^<<< @\/(\S+?)(?:#[\w-]+)?(?:\{|\s|$)/gm)) used.add(m[1]!);
    const helpers = new Set(["snippets/connect/appkit.ts"]); // re-exports for other snippets
    const unused = walk(snippets, (f) => /\.(ts|tsx|js|json)$/.test(f) && !f.endsWith("tsconfig.json"))
      .map((f) => relative(src, f))
      .filter((f) => !used.has(f) && !helpers.has(f));
    expect(unused).toEqual([]);
  });

  it("JSON blocks parse", () => {
    const bad: string[] = [];
    for (const f of all) for (const b of fences(readFileSync(f, "utf8"))) if (b.lang === "json") {
      try {
        JSON.parse(b.body);
      } catch (e) {
        bad.push(`${relative(src, f)}:${b.line}: ${String(e)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("pnpm --filter commands name real packages and scripts", () => {
    const manifests = new Map<string, Record<string, string>>();
    for (const group of ["packages", "apps", "services"]) {
      for (const d of readdirSync(join(root, group))) {
        const pj = join(root, group, d, "package.json");
        if (!existsSync(pj)) continue;
        const p = JSON.parse(readFileSync(pj, "utf8")) as { name: string; scripts?: Record<string, string> };
        manifests.set(p.name, p.scripts ?? {});
        manifests.set(p.name.replace(/^@clip-wallet\//, ""), p.scripts ?? {});
      }
    }
    const rootScripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    const bad: string[] = [];
    let seen = 0;
    for (const f of all) {
      for (const b of fences(readFileSync(f, "utf8"))) {
        if (!/^(sh|bash|shell|console)$/.test(b.lang)) continue;
        for (const m of b.body.matchAll(/pnpm --filter (\S+) (?:run )?([\w:-]+)/g)) {
          seen++;
          const scripts = manifests.get(m[1]!.replace(/^["']|["']$/g, ""));
          if (!scripts) bad.push(`${relative(src, f)}: no package ${m[1]}`);
          else if (!["exec", "test", "install", "add"].includes(m[2]!) && !(m[2]! in scripts)) bad.push(`${relative(src, f)}: ${m[1]} has no script ${m[2]}`);
        }
        for (const m of b.body.matchAll(/^\s*pnpm ([\w:-]+)(?:\s|$)/gm)) {
          if (["install", "exec", "add", "dlx", "changeset", "--filter", "-r", "run", "i"].includes(m[1]!)) continue;
          if (!(m[1]! in rootScripts) && !/^(ios|android|dapp|prebuild|start|wallet:[\w-]+|extension:[\w:-]+|next:[\w-]+|check-types|verify:provenance|harness|build|lint)$/.test(m[1]!)) {
            bad.push(`${relative(src, f)}: root package.json has no script "${m[1]}"`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThan(10);
  });
});

/* ------------------------------------------------------------------ 3. package READMEs */

describe("package READMEs", () => {
  const out = join(docs, "node_modules", ".cache", "clip-docs", "readme-snippets");
  const extracted: string[] = [];
  const js: { file: string; body: string }[] = [];

  beforeAll(() => {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    for (const d of readdirSync(join(root, "packages"))) {
      const readme = join(root, "packages", d, "README.md");
      if (!existsSync(readme)) continue;
      fences(readFileSync(readme, "utf8")).forEach((b, i) => {
        if (/^(ts|tsx|typescript)$/.test(b.lang)) {
          const file = join(out, `${d}-${i}.${b.lang === "tsx" ? "tsx" : "ts"}`);
          // Each block is its own module, so names don't clash between blocks.
          writeFileSync(file, `${b.body}\nexport {};\n`);
          extracted.push(file);
        } else if (/^(js|javascript)$/.test(b.lang)) js.push({ file: `packages/${d}/README.md:${b.line}`, body: b.body });
      });
    }
  });

  it("ts and tsx blocks typecheck", () => {
    expect(extracted.length).toBeGreaterThan(20);
    expect(typecheck(extracted, "README")).toEqual([]);
  }, 180_000);

  it("js blocks parse", () => {
    const bad = js.flatMap(({ file, body }) => {
      const r = ts.transpileModule(body, { reportDiagnostics: true, compilerOptions: { allowJs: true } });
      return (r.diagnostics ?? []).map((d) => `${file}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    });
    expect(bad).toEqual([]);
  });
});

/* ------------------------------------------------------------------ 4. runtime */

/** Runs a snippet module and returns what it printed. */
async function run(path: string): Promise<unknown[][]> {
  const printed: unknown[][] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void printed.push(args));
  try {
    await import(/* @vite-ignore */ `${pathToFileURL(join(snippets, path)).href}?t=${Date.now()}`);
  } finally {
    spy.mockRestore();
  }
  return printed;
}

describe("runnable snippets print what the docs say", () => {
  afterEach(() => vi.restoreAllMocks());

  it("kit/clip.config.ts is a valid configuration", async () => {
    const mod = (await import(pathToFileURL(join(snippets, "kit/clip.config.ts")).href)) as { default: { name: string; mainnet: unknown; networks: string[] } };
    expect(mod.default.name).toBe("Acme Wallet");
    expect(mod.default.mainnet).toBe(false);
  });

  it("kit/services.ts is a valid configuration", async () => {
    const mod = (await import(pathToFileURL(join(snippets, "kit/services.ts")).href)) as { default: { services: { backupUrl: string } } };
    expect(mod.default.services.backupUrl).toBe("https://backup.acme.example");
  });

  it("kit/networks.ts", async () => {
    expect(await run("kit/networks.ts")).toEqual([[["evm", "hedera", "solana", "cardano"]]]);
  });

  it("kit/validate.ts", async () => {
    const [p1, p2, p3, p4] = await run("kit/validate.ts");
    expect(p1?.[0]).toBe("rdns: use a reverse domain you own, like com.example.wallet (lowercase)");
    expect(String(p2?.[0])).toMatch(/^theme: the accent and its text colour are too close; pick colours with a contrast ratio of at least 3:1/);
    expect(String(p3?.[0])).toMatch(/^networks\.1: use "evm:\*", "evm:<chain id>", "hedera", "solana", /);
    expect(p4?.[0]).toEqual(["name: give your wallet a name"]);
  });

  it("kit/mainnet.ts lists what still blocks a mainnet build", async () => {
    const [[problems]] = (await run("kit/mainnet.ts")) as [[string[]]];
    expect(problems.map((p) => p.split(":")[0])).toEqual(["extension.key", "walletConnect"]);
  });

  it("extend/i18n-qa.ts finds no problems in the example catalog", async () => {
    expect(await run("extend/i18n-qa.ts")).toEqual([[[]], ["5 próśb czeka"]]);
  });

  it("extend/i18n-bidi.ts", async () => {
    expect(await run("extend/i18n-bidi.ts")).toEqual([[["amount", "symbol", "to"]], [[]]]);
  });

  it("extend/check-manifest.ts", async () => {
    expect(await run("extend/check-manifest.ts")).toEqual([
      ['• See the requests you\'re asked to approve and add notes to them. Notes are marked "from Address labels".'],
      ["• It can never sign, move your funds, or see your recovery phrase or keys."],
    ]);
  });

  it("extend/plugin-bundle.js returns output the wallet accepts", async () => {
    const { InsightOutputSchema } = await import("@clip-wallet/plugins");
    const module = { exports: {} as Record<string, (a: unknown) => Promise<unknown>> };
    new Function("module", "exports", readFileSync(join(snippets, "extend/plugin-bundle.js"), "utf8"))(module, module.exports);
    const request = { origin: "https://app.example", title: "Send 1 ETH to 0x0000…dEaD", lines: [{ label: "To", value: "0x000000000000000000000000000000000000dEaD" }], balanceChanges: [], networkId: "eip155:11155111", account: "0x0000000000000000000000000000000000000001" };
    const out = await module.exports.onTransaction!({ request });
    expect(InsightOutputSchema.parse(out)).toEqual({ lines: [{ label: "Address", value: "Burn address" }], warnings: [{ level: "danger", message: "Funds sent to the burn address are gone for good." }] });
  });

  it("extend/plugin-typed.ts agrees with the bundle and the output schemas", async () => {
    const { InsightOutputSchema, NameOutputSchema } = await import("@clip-wallet/plugins");
    const p = await import("../src/snippets/extend/plugin-typed");
    const request = { origin: "https://app.example", title: "Send", lines: [{ label: "To", value: "0x000000000000000000000000000000000000dEaD" }], balanceChanges: [], networkId: "eip155:1", account: "0x1" };
    expect(InsightOutputSchema.parse(await p.onTransaction({ request })).warnings).toHaveLength(1);
    expect(NameOutputSchema.parse(await p.onNameLookup({ name: "burn.label" }))).toEqual({ address: "0x000000000000000000000000000000000000dead", family: "evm" });
    expect(await p.onNameLookup({ name: "alice.label" })).toBeNull();
  });

  it("extend/example-module.ts decodes, prepares, refuses a bad signature and reads balances", async () => {
    const { createExampleModule, EXAMPLE_TESTNET, EXM } = await import("../src/snippets/extend/example-module");
    const { WALLET_ORIGIN } = await import("@clip-wallet/core");
    // A public key only (the ed25519 base point's encoding): no private key exists anywhere in this test.
    const publicKey = "5866666666666666666666666666666666666666666666666666666666666666";
    const calls: string[] = [];
    const fetch = (async (_url: string, init: { body: string }) => {
      const { method } = JSON.parse(init.body) as { method: string };
      calls.push(method);
      const result = method === "example_getBalance" ? { amount: "2500000" } : method === "example_getNonce" ? { nonce: 7 } : undefined;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    }) as unknown as typeof globalThis.fetch;
    const m = createExampleModule();
    const account = { id: "example:0", family: m.family, index: 0, curve: m.curve, derivationPath: m.derivationPath(0), publicKey, address: m.addressFromPublicKey(Buffer.from(publicKey, "hex"), EXAMPLE_TESTNET) };
    const ctx = { network: EXAMPLE_TESTNET, account, fetch };

    expect(m.derivationPath(2)).toBe("m/44'/9999'/2'");
    expect(m.isAddress(account.address)).toBe(true);
    expect(m.networksForAddress("0x12", [EXAMPLE_TESTNET])).toEqual([]);
    expect(await m.getBalances(ctx)).toEqual([{ asset: EXM, amount: "2500000" }]);

    const to = `ex1${"ab".repeat(32)}`;
    const send = await m.buildTransfer({ asset: EXM, to, amount: "1500000" }, ctx);
    expect(send.origin).toBe(WALLET_ORIGIN);
    const decoded = await m.decode(send, ctx);
    expect(decoded.title).toBe("Send 1.5 EXM to ex1abab…abab");
    expect(decoded.balanceChanges[0]!.delta).toBe("-1501000");
    expect(decoded.blind).toBe(false);

    await expect(m.decode({ ...send, params: { to: "nope", amount: "1" } }, ctx)).rejects.toMatchObject({ code: "example/bad-address" });
    expect((await m.decode({ ...send, method: "example_doSomething" }, ctx)).blind).toBe(true);

    const [payload] = await m.prepare(send, ctx, "approval-1");
    expect(payload).toMatchObject({ accountId: "example:0", scheme: "ed25519", approvalId: "approval-1" });
    expect(JSON.parse(new TextDecoder().decode(payload!.bytes))).toMatchObject({ to, amount: "1500000", nonce: 7 });

    const forged = { scheme: "ed25519" as const, bytes: new Uint8Array(64), publicKey };
    await expect(m.finalize(send, [forged], ctx)).rejects.toMatchObject({ code: "example/bad-signature" });
    await expect(m.finalize(send, [forged], ctx)).rejects.toMatchObject({ code: "example/not-prepared" }); // single use
    expect(calls).toEqual(["example_getBalance", "example_getNonce"]); // nothing was submitted
  });

  it("extend/threat-provider.ts matches on the device", async () => {
    const { createExampleListProvider } = await import("../src/snippets/extend/threat-provider");
    const p = createExampleListProvider(async () => ["evil.example"]);
    await p.refresh!(true);
    expect(p.status().entries).toBe(1);
    expect((await p.checkSite!("https://evil.example/claim"))[0]?.code).toBe("phishing-site");
    expect(await p.checkSite!("https://app.example")).toEqual([]);
    const failing = createExampleListProvider(async () => {
      throw new Error("offline");
    });
    await failing.refresh!(true); // keeps working without a list
    expect(failing.status().entries).toBe(0);
  });

  it("arch/merged-balances.ts", async () => {
    expect(await run("arch/merged-balances.ts")).toEqual([
      ["USDC", "412000000", "", "2 network(s)"],
      ["USDC.e", "5000000", "(bridged)", "1 network(s)"],
      [417],
    ]);
  });

  it("arch/display-safe.ts", async () => {
    expect(await run("arch/display-safe.ts")).toEqual([["USDC"], ["Line one\nLine two"]]);
  });

  it("security/security-floor.ts", async () => {
    expect(await run("security/security-floor.ts")).toEqual([
      [["threat.openLists: the open phishing lists can't be switched off on mainnet", "threat.newContractDays: new-contract cautions can't be switched off on mainnet"]],
    ]);
  });

  it("services/media-url.ts", async () => {
    const [[first], [second], [third]] = (await run("services/media-url.ts")) as [[{ kind: string; src: string }], [unknown], [unknown]];
    expect(first.kind).toBe("image");
    expect(first.src).toMatch(/^https:\/\/media\.acme\.example\/v1\/media\?src=ipfs%3A%2F%2Fbafy.+%2F1\.png&kind=image$/);
    expect(second).toBeNull();
    expect(third).toBeNull();
  });
});

describe("runnable snippets (extending)", () => {
  it("extend/evm-network.ts", async () => {
    expect(await run("extend/evm-network.ts")).toEqual([["eip155:999999001", true], [true], [false]]);
  });
});
