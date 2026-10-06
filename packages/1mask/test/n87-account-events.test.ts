import type { Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { createMemoryPermissionStore, createOneMaskRouter, type RouterPort } from "../src/background/index.js";

/** The public "abandon … about" accounts (chains-stacks / chains-bitcoincash test/signatures.ts), vault spelling. */
const SP = "SPC5KHM41H6WHAST7MWWDD807YSPRQKJ69FSH54J";
const ST = "STC5KHM41H6WHAST7MWWDD807YSPRQKJ68T330BQ";
const BCH_MAIN = "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6";
const BCH_TEST = "bchtest:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnqseeszx8x";
const ORIGIN = "https://dapp.example";

const asset = (key: string, networkId: string) => ({ key, symbol: key, name: key, decimals: 6, networkId });
const net = (id: string, family: Network["family"], testnet = true): Network => ({ id, family, name: id, nativeAsset: asset(family, id), testnet, rpcUrls: [], explorerUrl: "" });
const NETWORKS: Network[] = [
  net("stacks:2147483648", "stacks"),
  net("stacks:1", "stacks", false),
  net("bip122:00000000040ba9641ba98a37b2e5ceea", "bitcoincash"),
  net("bip122:000000000000000000651ef99cb9fcbe", "bitcoincash", false),
];

function setup() {
  const permissions = createMemoryPermissionStore();
  const router = createOneMaskRouter({
    networks: NETWORKS,
    permissions,
    accountsFor: (_o, f) => (f === "stacks" ? [{ address: SP, publicKey: "03d5" }] : f === "bitcoincash" ? [{ address: BCH_MAIN }] : []),
    handle: async () => true,
  });
  const events: { family: string; event: string; data: unknown }[] = [];
  const port: RouterPort = {
    postMessage: (m: unknown) => {
      const e = m as { type: string; family: string; event: string; data: unknown };
      if (e.type === "event") events.push({ family: e.family, event: e.event, data: e.data });
    },
    onMessage: { addListener: () => {} },
    onDisconnect: { addListener: () => {} },
  } as unknown as RouterPort;
  router.attachPort(port, { senderOrigin: ORIGIN });
  return { router, permissions, events };
}

describe("accountsChanged spelling for Stacks and Bitcoin Cash", () => {
  it("connect and notifyAccountsChanged carry the site's network spelling, not the vault's mainnet form", async () => {
    const { router, permissions, events } = setup();
    expect(await router.dispatch(ORIGIN, { family: "stacks", method: "stacks:connect", params: {} })).toEqual([{ address: ST, publicKey: "03d5" }]);
    expect(events.at(-1)).toEqual({ family: "stacks", event: "accountsChanged", data: [{ address: ST, publicKey: "03d5" }] });

    await permissions.grant(ORIGIN, "bitcoincash");
    await router.notifyAccountsChanged();
    expect(events.filter((e) => e.event === "accountsChanged").slice(-2)).toEqual([
      { family: "stacks", event: "accountsChanged", data: [{ address: ST, publicKey: "03d5" }] },
      { family: "bitcoincash", event: "accountsChanged", data: [{ address: BCH_TEST }] },
    ]);
  });

  it("follows the network a site selected (mainnet → SP / bitcoincash:)", async () => {
    const { router, permissions, events } = setup();
    await router.dispatch(ORIGIN, { family: "stacks", method: "stacks:connect", params: {}, chain: "stacks:1" });
    expect(events.at(-1)?.data).toEqual([{ address: SP, publicKey: "03d5" }]);
    await router.notifyAccountsChanged("stacks");
    expect(events.at(-1)?.data).toEqual([{ address: SP, publicKey: "03d5" }]);
    await router.dispatch(ORIGIN, { family: "stacks", method: "stacks:disconnect" });
    await permissions.grant(ORIGIN, "bitcoincash");
    await router.notifyAccountsChanged("bitcoincash");
    expect(events.at(-1)?.data).toEqual([{ address: BCH_TEST }]);

  });
});
