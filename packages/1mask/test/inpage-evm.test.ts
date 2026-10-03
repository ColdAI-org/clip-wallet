import { describe, expect, it } from "vitest";
import { installOneMask } from "../src/inpage/index.js";
import { DEFAULT_IDENTITY } from "../src/shared/config.js";
import { EVM_ADDR, NETWORKS, makeHarness, newWindow, tick } from "./helpers.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function collectAnnouncements(win: Window) {
  const got: any[] = [];
  win.addEventListener("eip6963:announceProvider", (e: Event) => got.push((e as CustomEvent).detail));
  return got;
}

describe("EIP-6963", () => {
  it("announces on load and on requestProvider with a spec-shaped, stable detail", () => {
    const win = newWindow();
    const got = collectAnnouncements(win);
    const om = installOneMask({ networks: NETWORKS, providers: { solana: false, bitcoin: false } }, win);
    expect(got).toHaveLength(1);
    win.dispatchEvent(new (win as any).Event("eip6963:requestProvider"));
    win.dispatchEvent(new (win as any).Event("eip6963:requestProvider"));
    expect(got).toHaveLength(3);

    const d = got[0];
    expect(Object.keys(d.info).sort()).toEqual(["icon", "name", "rdns", "uuid"]);
    expect(d.info.uuid).toMatch(UUID_V4);
    expect(got.every((x) => x.info.uuid === d.info.uuid)).toBe(true); // stable per session
    expect(d.info.name).toBe("Clip Wallet");
    expect(d.info.rdns).toBe(DEFAULT_IDENTITY.rdns);
    expect(d.info.icon).toMatch(/^data:image\/(svg\+xml|webp|png|gif);base64,/);
    expect(typeof d.provider.request).toBe("function");
    expect(d.provider).toBe(om.evm!.provider);
    expect(Object.isFrozen(d) && Object.isFrozen(d.info)).toBe(true);
    om.destroy();
  });

  it("a new page session gets a new uuid", () => {
    const a = collectAnnouncements(newWindow());
    const w1 = newWindow();
    const g1 = collectAnnouncements(w1);
    installOneMask({ networks: NETWORKS }, w1);
    const w2 = newWindow();
    const g2 = collectAnnouncements(w2);
    installOneMask({ networks: NETWORKS }, w2);
    expect(g1[0].info.uuid).not.toBe(g2[0].info.uuid);
    void a;
  });

  it("announces the kit's own identity", () => {
    const win = newWindow();
    const got = collectAnnouncements(win);
    const icon = "data:image/png;base64,iVBORw0KGgo=" as const;
    installOneMask({ networks: NETWORKS, identity: { name: "Acme Wallet", rdns: "com.acme.wallet", icon } }, win);
    expect(got[0].info).toMatchObject({ name: "Acme Wallet", rdns: "com.acme.wallet", icon });
  });

  it("rejects identities that break the spec", () => {
    expect(() => installOneMask({ networks: NETWORKS, identity: { icon: "https://x/icon.png" as any } }, newWindow())).toThrow(/data URI/);
    expect(() => installOneMask({ networks: NETWORKS, identity: { rdns: "not reverse dns" } }, newWindow())).toThrow(/rdns/);
    expect(() => installOneMask({ networks: NETWORKS, compatibility: { enabled: true } as any }, newWindow())).toThrow(/compatibility/);
  });
});

describe("window.ethereum", () => {
  it("is not touched by default", () => {
    const win = newWindow();
    installOneMask({ networks: NETWORKS }, win);
    expect((win as any).ethereum).toBeUndefined();
  });

  it("is claimed only with claimWindowEthereum and never overwrites another wallet", () => {
    const win = newWindow();
    const om = installOneMask({ networks: NETWORKS, claimWindowEthereum: true }, win);
    expect((win as any).ethereum).toBe(om.evm!.provider);

    const win2 = newWindow();
    const other = { isMetaMask: true };
    (win2 as any).ethereum = other;
    const om2 = installOneMask({ networks: NETWORKS, claimWindowEthereum: true }, win2);
    expect((win2 as any).ethereum).toBe(other);
    expect(om2.evm!.claimedWindowEthereum).toBe(false);
  });
});

describe("EIP-1193 provider end-to-end (page → content → router)", () => {
  function setup() {
    const h = makeHarness({ handleImpl: (r) => (r.method === "personal_sign" ? "0xsig" : r.method === "eth_blockNumber" ? "0x5" : true) });
    const om = installOneMask({ networks: NETWORKS, channel: h.channel, providers: { solana: false, bitcoin: false } }, h.win);
    return { ...h, provider: om.evm!.provider };
  }

  it("connects, reveals accounts only after approval, and emits events", async () => {
    const { provider, handled } = setup();
    const events: any[] = [];
    provider.on("accountsChanged", (a: string[]) => events.push(["accounts", a]));
    provider.on("chainChanged", (c: string) => events.push(["chain", c]));
    await provider.ready;
    expect(provider.isConnected()).toBe(true);
    expect(provider.chainId).toBe("0xaa36a7");
    expect(await provider.request({ method: "eth_accounts" })).toEqual([]);
    expect(await provider.request({ method: "eth_requestAccounts" })).toEqual([EVM_ADDR]);
    expect(handled.map((r) => r.method)).toEqual(["eth_requestAccounts"]);
    expect(await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] })).toBeNull();
    await tick(10);
    expect(provider.chainId).toBe("0x14a34");
    expect(events).toContainEqual(["accounts", [EVM_ADDR]]);
    expect(events).toContainEqual(["chain", "0x14a34"]);
    expect(await provider.request({ method: "personal_sign", params: ["0x68", EVM_ADDR] })).toBe("0xsig");
    expect(handled.at(-1)).toMatchObject({ origin: "https://dapp.example", networkId: "eip155:84532" });
  });

  it("proxies read-only calls and returns EIP-1193 error codes", async () => {
    const { provider } = setup();
    expect(await provider.request({ method: "eth_blockNumber" })).toBe("0x5");
    await expect(provider.request({ method: "eth_sign", params: [EVM_ADDR, "0x00"] })).rejects.toMatchObject({ code: 4200 });
    await expect(provider.request({ method: "personal_sign", params: ["0x68", EVM_ADDR] })).rejects.toMatchObject({ code: 4100 });
    await expect(provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] })).rejects.toMatchObject({ code: 4902 });
    await expect(provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x89" }] })).rejects.toMatchObject({ code: 4001 });
    await expect(provider.request({ method: "foo_bar" })).rejects.toMatchObject({ code: 4200 });
    await expect(provider.request({} as any)).rejects.toMatchObject({ code: -32602 });
  });

  it("emits disconnect (4900) when the wallet disconnects the site", async () => {
    const { provider, router } = setup();
    await provider.ready;
    const seen: any[] = [];
    provider.on("disconnect", (e: any) => seen.push(e.code));
    router.emit("https://dapp.example", "evm", "disconnect");
    await tick(10);
    expect(seen).toEqual([4900]);
    expect(provider.isConnected()).toBe(false);
  });
});
