import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, MAINNET_ACKNOWLEDGEMENT, defineConfig, type ClipConfigInput } from "@clip-wallet/config";
import { SONIC_RPC_URL } from "@clip-wallet/features";
import { clipWallet, sodaxFor } from "../src/wxt";

// The committed list of reviewed fee receivers is empty (features' tests pin it). Here a test can put the fake
// receiver on it; everything else about the list is the real code.
const reviewed = vi.hoisted(() => new Set<string>());
vi.mock("@clip-wallet/features/sodax-fee", async (importOriginal) => {
  const real = await importOriginal<typeof import("@clip-wallet/features/sodax-fee")>();
  return { ...real, isReviewedFeeReceiver: (address: string) => reviewed.has(address.toLowerCase()) };
});

/** Clearly fake: nobody holds this address. */
const FAKE_RECEIVER = "0x00000000000000000000000000000000000fee01";
const SERVER = "https://exclip.example";
const SODAX = { CLIP_SODAX_SERVER_URL: SERVER, CLIP_SODAX_FEE_RECEIVER: FAKE_RECEIVER };
const WC = { CLIP_WALLETCONNECT_PROJECT_ID: "b".repeat(32) };

const dirs: string[] = [];
function project(): string {
  const d = mkdtempSync(join(tmpdir(), "extension-kit-sodax-"));
  dirs.push(d);
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "acme-wallet", version: "1.2.3" }));
  writeFileSync(join(d, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return d;
}
afterEach(() => {
  reviewed.clear();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const mainnet = { enabled: true as const, acknowledged: MAINNET_ACKNOWLEDGEMENT };
// extension.key: a stand-in of the right shape (only a public key ever goes here).
const acme = (extra: Partial<ClipConfigInput> = {}) =>
  defineConfig({ name: "Acme Wallet", rdns: "com.acme.wallet", homepage: "https://acme.example", extension: { key: "A".repeat(392) }, networks: ["evm:*"], ...extra });

type Cfg = { manifest(env: { browser: string; manifestVersion: 3 }): { host_permissions: string[] }; vite(): { define: Record<string, string> } };
const build = (config: ReturnType<typeof acme>, env: Record<string, string>) => clipWallet({ config, root: project(), env, sourceConditions: false }) as unknown as Cfg;
const featuresOf = (cfg: Cfg) => JSON.parse(cfg.vite().define.__CLIP_FEATURES__!) as { testnet: boolean; swap: { sodax?: unknown } };
const hostsOf = (cfg: Cfg) => cfg.manifest({ browser: "chrome", manifestVersion: 3 }).host_permissions;

describe("SODAX swaps in the extension build", () => {
  it("are never in a testnet build, whatever the environment says", () => {
    reviewed.add(FAKE_RECEIVER);
    const cfg = build(acme(), { ...SODAX });
    expect(featuresOf(cfg)).toMatchObject({ testnet: true });
    expect(featuresOf(cfg).swap.sodax).toBeUndefined();
    expect(hostsOf(cfg).filter((h) => h.startsWith(SERVER) || h.includes("soniclabs"))).toEqual([]);
  });

  it("are off in a mainnet build that doesn't set them, and that build needs nothing for them", () => {
    const cfg = build(acme({ mainnet }), { ...WC });
    expect(featuresOf(cfg).swap.sodax).toBeUndefined();
    expect(hostsOf(cfg).some((h) => h.includes("soniclabs"))).toBe(false);
  });

  it("refuse a mainnet build whose settings are half set or whose receiver isn't reviewed", () => {
    const problems = (env: Record<string, string>) => {
      try {
        build(acme({ mainnet }), { ...WC, ...env });
      } catch (e) {
        if (e instanceof ConfigError) return e.problems;
        throw e;
      }
      return [];
    };
    expect(problems({ CLIP_SODAX_FEE_RECEIVER: FAKE_RECEIVER })).toEqual([
      "mainnet checklist: CLIP_SODAX_SERVER_URL: set the https base URL of the ExClip server that quotes SODAX swaps, or unset CLIP_SODAX_FEE_RECEIVER too",
      `mainnet checklist: CLIP_SODAX_FEE_RECEIVER: ${FAKE_RECEIVER} isn't on the reviewed list of fee receivers (@clip-wallet/features src/swap/sodax-fee-receivers.json); add it there in a reviewed commit, or unset both SODAX settings`,
    ]);
    expect(problems({ CLIP_SODAX_SERVER_URL: SERVER })).toEqual([
      "mainnet checklist: CLIP_SODAX_FEE_RECEIVER: set the 0x address the 0.875% Clip fee on SODAX swaps goes to, or unset CLIP_SODAX_SERVER_URL too",
    ]);
    expect(problems({ ...SODAX })).toHaveLength(1);
    reviewed.add(FAKE_RECEIVER);
    expect(problems({ ...SODAX })).toEqual([]);
  });

  it("are on in a mainnet build with both settings and a reviewed receiver, named after the wallet", () => {
    reviewed.add(FAKE_RECEIVER);
    const cfg = build(acme({ mainnet }), { ...WC, ...SODAX });
    expect(featuresOf(cfg).swap.sodax).toEqual({ serverUrl: SERVER, feeReceiver: FAKE_RECEIVER, walletName: "Acme Wallet" });
    // Only these two hosts are added: the server's origin and Sonic, where the swap's hub side is read.
    expect(hostsOf(cfg)).toEqual(expect.arrayContaining([`${SERVER}/*`, `${new URL(SONIC_RPC_URL).origin}/*`]));
    expect(sodaxFor(acme({ mainnet }), { ...SODAX, CLIP_SODAX_SERVER_URL: "" })).toBeUndefined();
  });
});
