#!/usr/bin/env node
/**
 * Prints the dapp matrix wallet's testnet balance per family, read with the wallet's own chain modules
 * (apps/extension/e2e/matrix/chain.ts), so you can see when faucet funding has landed.
 *
 *   node scripts/dapp-matrix-balances.mjs            table
 *   node scripts/dapp-matrix-balances.mjs --json     machine-readable
 *   node scripts/dapp-matrix-balances.mjs --watch    re-check every 30 s until every account is funded
 *
 * Public addresses only (apps/extension/e2e/matrix/addresses.json); it never reads the phrase. Testnets only: every
 * network it queries is the matrix's testnet for that family.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "apps/extension");
const { build } = createRequire(path.join(ext, "package.json"))("esbuild");

const outDir = path.join(ext, "node_modules/.cache/clip-matrix-dapps");
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, "chain-node.mjs");
await build({
  entryPoints: [path.join(ext, "e2e/matrix/chain.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile,
  conditions: ["development"],
  logLevel: "error",
  // CJS dependencies inside an ESM bundle still call require().
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const chain = await import(pathToFileURL(outfile).href);

const args = new Set(process.argv.slice(2));
/** The chain module re-derives the address from the vault's public key; EVM-style aliases compare case-insensitively. */
function derived(r) {
  const m = chain.moduleAddress(r.target);
  return m && m.toLowerCase() === r.address.toLowerCase() ? "ok" : `MISMATCH ${m}`;
}

async function once() {
  const rows = await Promise.all(chain.TARGET_ORDER.map((t) => chain.balanceOf(t)));
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(rows.map((r) => ({ ...r, amount: r.amount?.toString() ?? null, minimum: r.minimum.toString(), moduleAddress: chain.moduleAddress(r.target), derived: derived(r) })), null, 2)}\n`);
    return rows;
  }
  const dec = (t) => chain.TARGETS[t].network.nativeAsset.decimals;
  const table = rows.map((r) => ({
    target: r.target,
    network: chain.TARGETS[r.target].network.name,
    address: r.address,
    balance: r.error ? `error: ${r.error}` : `${chain.formatAmount(r.amount, dec(r.target))} ${r.native}`,
    needs: `${chain.formatAmount(r.minimum, dec(r.target))} ${r.native}`,
    funded: r.funded ? "yes" : "no",
    derived: derived(r),
  }));
  const cols = Object.keys(table[0]);
  const w = Object.fromEntries(cols.map((c) => [c, Math.max(c.length, ...table.map((r) => String(r[c]).length))]));
  const line = (r) => cols.map((c) => String(r[c]).padEnd(w[c])).join("  ");
  process.stdout.write(`${line(Object.fromEntries(cols.map((c) => [c, c])))}\n${table.map(line).join("\n")}\n`);
  return rows;
}

if (args.has("--watch")) {
  for (;;) {
    const rows = await once();
    if (rows.every((r) => r.funded)) break;
    process.stdout.write(`\n${new Date().toISOString()}: ${rows.filter((r) => !r.funded).length} not funded yet; checking again in 30 s\n\n`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
} else await once();
