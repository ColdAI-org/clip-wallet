import type { Wallet } from "@wallet-standard/base";
import { describe, expect, it } from "vitest";
import { ClipBitcoinWallet } from "../src/inpage/bitcoin.js";
import { BITCOIN_FEATURES, SOLANA_FEATURES, installOneMask } from "../src/inpage/index.js";
import { ClipSolanaWallet } from "../src/inpage/solana.js";
import { createInpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { BTC_ADDR, NETWORKS, SOL_ADDR, makeHarness } from "./helpers.js";

/** Collect wallets registered through the Wallet Standard window events (what an app does). */
function captureRegistrations(): Wallet[] {
  const wallets: Wallet[] = [];
  window.addEventListener("wallet-standard:register-wallet", (e: Event) => {
    (e as unknown as { detail: (api: { register(w: Wallet): void }) => void }).detail({ register: (w) => void wallets.push(w) });
  });
  return wallets;
}

describe("Wallet Standard registration", () => {
  it("registers Solana and Bitcoin wallets exposing their features and registry chains", () => {
    const wallets = captureRegistrations();
    const om = installOneMask({ networks: NETWORKS });
    const sol = wallets.find((w) => w === om.solana)!;
    const btc = wallets.find((w) => w === om.bitcoin)!;
    expect(sol && btc).toBeTruthy();

    for (const w of [sol, btc]) {
      expect(w.version).toBe("1.0.0");
      expect(w.name).toBe("Clip Wallet");
      expect(w.icon).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(w.accounts).toEqual([]);
    }
    expect(Object.keys(sol.features).sort()).toEqual([...SOLANA_FEATURES].sort());
    expect(sol.features).toHaveProperty(["solana:signTransaction", "supportedTransactionVersions"], ["legacy", 0]);
    expect(sol.chains).toEqual(["solana:devnet"]);

    expect(Object.keys(btc.features).sort()).toEqual([...BITCOIN_FEATURES].sort());
    for (const f of ["bitcoin:connect", "bitcoin:signTransaction", "bitcoin:signAndSendTransaction", "bitcoin:signMessage"]) {
      expect((btc.features as any)[f].version).toBe("1.0.0");
    }
    expect(typeof (btc.features as any)["sats-connect:"].provider.request).toBe("function");
    expect(btc.chains).toEqual(["bitcoin:testnet"]);
    om.destroy();
  });

  it("does not register a family the registry lacks", () => {
    const wallets = captureRegistrations();
    installOneMask({ networks: NETWORKS.filter((n) => n.family === "evm") });
    expect(wallets.filter((w) => w.name === "Clip Wallet")).toEqual([]);
  });
});

function wire() {
  const h = makeHarness({
    handleImpl: (r) => {
      switch (r.method) {
        case "solana:signTransaction":
          return [{ signedTransaction: btoa("signed-tx") }];
        case "solana:signMessage":
          return [{ signedMessage: btoa("hi"), signature: btoa("sig") }];
        case "bitcoin:signTransaction":
          return [{ psbt: btoa("signed-psbt") }];
        case "bitcoin:signMessage":
          return [{ signature: btoa("btc-sig") }];
        default:
          return true;
      }
    },
  });
  const transport = createInpageTransport({ channel: h.channel, win: h.win });
  const id = resolveIdentity();
  return { ...h, sol: new ClipSolanaWallet(id, NETWORKS, transport), btc: new ClipBitcoinWallet(id, NETWORKS, transport) };
}

describe("Solana wallet end-to-end", () => {
  it("silent connect reveals nothing; connect then sign with bytes round-tripping as base64", async () => {
    const { sol, handled } = wire();
    const f = sol.features as any;
    const changes: any[] = [];
    f["standard:events"].on("change", (p: any) => changes.push(p));
    expect((await f["standard:connect"].connect({ silent: true })).accounts).toEqual([]);
    const { accounts } = await f["standard:connect"].connect();
    expect(accounts.map((a: any) => a.address)).toEqual([SOL_ADDR]);
    expect(accounts[0].publicKey).toHaveLength(32);
    expect(changes.length).toBeGreaterThan(0);

    const [out] = await f["solana:signTransaction"].signTransaction({ account: accounts[0], transaction: new Uint8Array([1, 2, 3]), chain: "solana:devnet" });
    expect(new TextDecoder().decode(out.signedTransaction)).toBe("signed-tx");
    expect(handled.at(-1)).toMatchObject({ method: "solana:signTransaction", params: { inputs: [{ account: SOL_ADDR, transaction: "AQID", chain: "solana:devnet" }] } });

    const [msg] = await f["solana:signMessage"].signMessage({ account: accounts[0], message: new TextEncoder().encode("hi") });
    expect(new TextDecoder().decode(msg.signature)).toBe("sig");
  });

  it("refuses accounts it did not connect and unknown chains before asking the wallet", async () => {
    const { sol, handled } = wire();
    const f = sol.features as any;
    const foreign = { address: "x", publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: [] };
    await expect(f["solana:signMessage"].signMessage({ account: foreign, message: new Uint8Array([1]) })).rejects.toMatchObject({ code: 4100 });
    const { accounts } = await f["standard:connect"].connect();
    await expect(
      f["solana:signTransaction"].signTransaction({ account: accounts[0], transaction: new Uint8Array([1]), chain: "solana:mainnet" }),
    ).rejects.toMatchObject({ code: 4901 });
    expect(handled.map((r) => r.method)).toEqual(["standard:connect"]);
  });
});

describe("Bitcoin wallet end-to-end", () => {
  it("bitcoin:connect, signTransaction (PSBT) and signMessage", async () => {
    const { btc, handled } = wire();
    const f = btc.features as any;
    const { accounts } = await f["bitcoin:connect"].connect({ purposes: ["payment"] });
    expect(accounts.map((a: any) => a.address)).toEqual([BTC_ADDR]);
    expect(accounts[0].publicKey).toHaveLength(33);
    const [signed] = await f["bitcoin:signTransaction"].signTransaction({
      psbt: new Uint8Array([0x70, 0x73, 0x62, 0x74]),
      inputsToSign: [{ account: accounts[0], signingIndexes: [0] }],
      chain: "bitcoin:testnet",
    });
    expect(new TextDecoder().decode(signed.signedPsbt)).toBe("signed-psbt");
    expect(handled.at(-1)).toMatchObject({
      method: "bitcoin:signTransaction",
      networkId: "bip122:000000000933ea01ad0ee984209779ba",
      params: { inputs: [{ psbt: "cHNidA==", inputsToSign: [{ address: BTC_ADDR, signingIndexes: [0] }] }] },
    });
    const [m] = await f["bitcoin:signMessage"].signMessage({ account: accounts[0], message: new TextEncoder().encode("hello") });
    expect(new TextDecoder().decode(m.signature)).toBe("btc-sig");
  });

  it("sats-connect request(): getAddresses and signPsbt map onto the canonical methods", async () => {
    const { btc, handled } = wire();
    const provider = (btc.features as any)["sats-connect:"].provider;
    const info = await provider.request("getInfo");
    expect(info.result.methods).toContain("signPsbt");
    const addrs = await provider.request("getAddresses", { purposes: ["payment"] });
    expect(addrs.result.addresses[0]).toMatchObject({ address: BTC_ADDR, purpose: "payment" });
    const signed = await provider.request("signPsbt", { psbt: "cHNidA==", signInputs: { [BTC_ADDR]: [0] } });
    expect(signed.result).toEqual({ psbt: btoa("signed-psbt") });
    expect(handled.at(-1)!.method).toBe("bitcoin:signTransaction");
    const bad = await provider.request("signPsbt", { psbt: "cHNidA==", signInputs: { tb1qnotmine: [0] } });
    expect(bad.error.code).toBe(4100);
    const unknown = await provider.request("runes_mint", {});
    expect(unknown.error.code).toBe(4200);
  });
});
