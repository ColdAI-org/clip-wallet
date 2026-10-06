/**
 * networks87: which of the 87 CLPR networks Clip Wallet supports, computed from the code (the catalogue every host
 * uses), and the supported-mainnets count by the landing page's rule. docs/r1/networks87.md is the human version.
 *
 * Source of the 87: coldai-clpr-landing artifacts/coldai-web/src/data/clpr-data.ts NETWORKS (2026-10-06), copied
 * here as slugs and names so this test runs inside the wallet repo.
 *
 *   pnpm --filter @clip-wallet/engine exec vitest run test/networks87.test.ts   (prints the table)
 */
import { describe, expect, it } from "vitest";
import type { Network } from "@clip-wallet/core";
import { NETWORK_FAMILIES } from "@clip-wallet/config";
import { walletNetworks } from "../src/catalog.js";

/** Every family, mainnet on: the full catalogue. */
const ALL: Network[] = walletNetworks({
  networks: ["evm:*", ...NETWORK_FAMILIES.filter((f) => f !== "evm")],
  mainnet: { enabled: true } as never,
});
const MAINNETS = ALL.filter((n) => !n.testnet);

type Match = (n: Network) => boolean;
const evm = (chainId: number): Match => (n) => n.family === "evm" && n.chainId === chainId;
const fam = (family: string, name?: RegExp): Match => (n) => n.family === family && (!name || name.test(n.name));

/** Not supportable with a self-custodial key wallet: why, in one line (details in docs/r1/networks87.md). */
const UNSUPPORTED: Record<string, string> = {
  canton:
    "Canton parties are hosted by a participant (validator) node: every read and every submission goes through that node's authenticated Ledger API, and there is no public endpoint a wallet can use on its own.",
  mixin:
    "The Mixin kernel's public RPC has no address index (no balance or UTXO lookup by key), and user accounts live behind Mixin's registered-account API, so a phrase-derived key alone can neither see nor spend funds.",
};

/** CLPR network (slug, name) → how Clip covers it. */
const CLPR: [slug: string, name: string, match: Match | null][] = [
  ["abstract", "Abstract", evm(2741)],
  ["algorand", "Algorand", fam("algorand")],
  ["anubis", "Anubis", evm(6714)],
  ["arbitrum-nova", "Arbitrum Nova", evm(42170)],
  ["arbitrum-one", "Arbitrum One", evm(42161)],
  ["arc", "Arc", evm(5042)],
  ["aurora", "Aurora", evm(1313161554)],
  ["avalanche-c-chain", "Avalanche C-Chain", evm(43114)],
  ["bnb-smart-chain", "BNB Smart Chain", evm(56)],
  ["bob", "BOB", evm(60808)],
  ["bot-chain", "BOT Chain", evm(677)],
  ["base", "Base", evm(8453)],
  ["bifrost-network", "Bifrost Network", evm(3068)],
  ["bitcoin", "Bitcoin", fam("bitcoin")],
  ["bitcoin-cash", "Bitcoin Cash", fam("bitcoincash")],
  ["bittensor", "Bittensor", evm(964)],
  ["blast", "Blast", evm(81457)],
  ["canton", "Canton", null],
  ["cardano", "Cardano", fam("cardano")],
  ["celo", "Celo", evm(42220)],
  ["chainflip", "Chainflip", fam("substrate", /^Chainflip$/)],
  ["conflux", "Conflux", evm(1030)],
  ["core", "Core", evm(1116)],
  ["cronos", "Cronos", evm(25)],
  ["ethereum", "Ethereum", evm(1)],
  ["flare", "Flare", evm(14)],
  ["fraxtal", "Fraxtal", evm(252)],
  ["grx-chain", "GRX Chain", evm(1110)],
  ["gnosis-chain", "Gnosis Chain", evm(100)],
  ["hydration", "Hydration", evm(222222)],
  ["hyperliquid", "Hyperliquid", evm(999)],
  ["immutable-zkevm", "Immutable zkEVM", evm(13371)],
  ["injective", "Injective", evm(1776)],
  ["ink", "Ink", evm(57073)],
  ["kub-chain", "KUB Chain", evm(96)],
  ["kaia", "Kaia", evm(8217)],
  ["katana", "Katana", evm(747474)],
  ["kava", "Kava", evm(2222)],
  ["mantra", "MANTRA", evm(5888)],
  ["mantle", "Mantle", evm(5000)],
  ["megaeth", "MegaETH", evm(4326)],
  ["mezo", "Mezo", evm(31612)],
  ["mixin", "Mixin", null],
  ["monad", "Monad", evm(143)],
  ["near", "NEAR", fam("near")],
  ["op-mainnet", "OP Mainnet", evm(10)],
  ["osmosis", "Osmosis", fam("cosmos", /^Osmosis$/)],
  ["plasma", "Plasma", evm(9745)],
  ["plume", "Plume", evm(98866)],
  ["polygon-pos", "Polygon PoS", evm(137)],
  ["provenance", "Provenance", fam("provenance")],
  ["pulsechain", "PulseChain", evm(369)],
  ["rise", "RISE", evm(4153)],
  ["reya", "Reya", evm(1729)],
  ["robinhood-chain", "Robinhood Chain", evm(4663)],
  ["ronin", "Ronin", evm(2020)],
  ["rootstock", "Rootstock", evm(30)],
  ["strato", "STRATO", evm(123354377739506)],
  ["sei", "Sei", evm(1329)],
  ["solana", "Solana", fam("solana")],
  ["soneium", "Soneium", evm(1868)],
  ["stable", "Stable", evm(988)],
  ["stacks", "Stacks", fam("stacks")],
  ["starknet", "Starknet", fam("starknet")],
  ["stellar", "Stellar", fam("stellar")],
  ["thorchain", "THORChain", fam("thorchain")],
  ["ton", "TON", fam("ton")],
  ["tron", "TRON", fam("tron")],
  ["telos", "Telos", evm(40)],
  ["unichain", "Unichain", evm(130)],
  ["vaulta", "Vaulta", fam("antelope", /Vaulta/)],
  ["world-chain", "World Chain", evm(480)],
  ["x-layer", "X Layer", evm(196)],
  ["xpr-network", "XPR Network", fam("antelope", /XPR/)],
  ["xrp-ledger", "XRP Ledger", fam("xrpl")],
  ["zigchain", "ZIGChain", fam("cosmos", /^ZIGChain$/)],
  ["zksync-era", "ZKsync Era", evm(324)],
  ["dydx", "dYdX", fam("cosmos", /^dYdX$/)],
  ["linea", "Linea", evm(59144)],
  ["scroll", "Scroll", evm(534352)],
  ["morph", "Morph", evm(2818)],
  ["icp", "ICP", fam("icp")],
  ["multiversx", "MultiversX", fam("multiversx")],
  ["initia", "Initia", fam("initia")],
  ["fuel", "Fuel", fam("fuel")],
  ["tezos", "Tezos", fam("tezos")],
  ["etherlink", "Etherlink", evm(42793)],
];

const covered = CLPR.map(([slug, name, match]) => ({ slug, name, nets: match ? MAINNETS.filter(match) : [] }));

describe("networks87: CLPR coverage from code", () => {
  it("lists the 87 CLPR networks once each", () => {
    expect(CLPR).toHaveLength(87);
    expect(new Set(CLPR.map(([slug]) => slug)).size).toBe(87);
  });

  it("supports every CLPR network on mainnet except the ones with no self-custodial key model", () => {
    const table = covered.map((c) => `${c.slug.padEnd(18)} ${c.nets.length ? c.nets.map((n) => `${n.id} (${n.name})`).join(", ") : `UNSUPPORTED: ${UNSUPPORTED[c.slug] ?? "?"}`}`);
    console.log(`\nCLPR coverage (mainnets in the catalogue):\n${table.join("\n")}`);
    const missing = covered.filter((c) => c.nets.length === 0).map((c) => c.slug);
    expect(missing.sort()).toEqual(Object.keys(UNSUPPORTED).sort());
    expect(covered.filter((c) => c.nets.length > 0)).toHaveLength(85);
  });

  it("supported mainnets by the landing page's rule (EVM mainnets without Hedera's EVM, plus every other family's mainnets)", () => {
    const evmMainnets = MAINNETS.filter((n) => n.family === "evm" && n.chainId !== 295);
    const others = MAINNETS.filter((n) => n.family !== "evm");
    const byFamily = Object.fromEntries(NETWORK_FAMILIES.map((f) => [f, MAINNETS.filter((n) => n.family === f).length]));
    console.log(`\nSupported mainnets: ${evmMainnets.length} EVM + ${others.length} others = ${evmMainnets.length + others.length}`, byFamily);
    expect(MAINNETS.some((n) => n.chainId === 295)).toBe(false); // Hedera's EVM is request-only, never listed
    expect(evmMainnets).toHaveLength(60);
    expect(evmMainnets.length + others.length).toBe(93);
  });
});
