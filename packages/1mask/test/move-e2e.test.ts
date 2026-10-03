import type { Network } from "@clip-wallet/core";
import { describe, expect, it } from "vitest";
import { ClipAptosWallet } from "../src/inpage/aptos.js";
import { ClipSuiWallet } from "../src/inpage/sui.js";
import { createInpageTransport } from "../src/inpage/transport.js";
import { resolveIdentity } from "../src/shared/config.js";
import { ACCOUNTS, NETWORKS, makeHarness } from "./helpers.js";

const asset = (key: string, networkId: string) => ({ key, symbol: key.toUpperCase(), name: key, decimals: 9, networkId });
const NETS: Network[] = [
  ...NETWORKS,
  { id: "sui:testnet", family: "sui", name: "Sui Testnet", nativeAsset: asset("sui", "sui:testnet"), testnet: true, rpcUrls: [], explorerUrl: "" },
  { id: "aptos:2", family: "aptos", name: "Aptos Testnet", nativeAsset: asset("apt", "aptos:2"), testnet: true, rpcUrls: [], explorerUrl: "" },
];
const SUI = "0x5e93a736d04fbb25737aa40bee40171ef79f65fae833749e3c089fe7cc2161f1";
const APT = "0xeb663b681209e7087d681c5d3eed12aaa8e1915e7c87794542c3f96e94b3d3bf";
ACCOUNTS.sui = [{ address: SUI, publicKey: "900b4d81eecea3df2f74b14200c4f4cf3f49afaca7a634ffd2cf6ff82bdaecf2" }];
ACCOUNTS.aptos = [{ address: APT, publicKey: "a686f0309ab80312979606cfccc10ea2740147ae6888351488d11c46f08fbf60" }];

describe("Sui and Aptos through the router (integration)", () => {
  it("connects and signs end to end", async () => {
    const h = makeHarness({
      networks: NETS,
      handleImpl: (r) => {
        if (r.method === "sui:signTransaction") return { bytes: "AQID", signature: "AAAA" };
        if (r.method === "aptos:signMessage") return { fullMessage: "APTOS\nmessage: hi\nnonce: 1", message: "hi", nonce: "1", prefix: "APTOS", signature: `0x${"11".repeat(64)}` };
        return true;
      },
    });
    const t = createInpageTransport({ channel: h.channel, win: h.win });
    const id = resolveIdentity();
    const sui = new ClipSuiWallet(id, NETS, t);
    const { accounts } = await (sui.features as any)["standard:connect"].connect();
    expect(accounts[0].address).toBe(SUI);
    await (sui.features as any)["sui:signTransaction"].signTransaction({ transaction: { toJSON: async () => "{}" }, account: accounts[0], chain: "sui:testnet" });
    expect(h.handled.at(-1)).toMatchObject({ family: "sui", networkId: "sui:testnet", method: "sui:signTransaction" });

    const aptos = new ClipAptosWallet(id, NETS, t);
    expect((await aptos.features["aptos:connect"].connect()).status).toBe("Approved");
    expect(await aptos.features["aptos:network"].network()).toEqual({ name: "testnet", chainId: 2 });
    const m = await aptos.features["aptos:signMessage"].signMessage({ message: "hi", nonce: "1" });
    expect(m.status).toBe("Approved");
    expect(h.handled.at(-1)).toMatchObject({ family: "aptos", networkId: "aptos:2", method: "aptos:signMessage" });
    expect(h.handled.map((r) => r.method)).toEqual(["standard:connect", "sui:signTransaction", "aptos:connect", "aptos:signMessage"]);
  });

  it("refuses signing before connect", async () => {
    const h = makeHarness({ networks: NETS });
    await expect(h.router.dispatch("https://x.example", { family: "aptos", method: "aptos:signMessage", params: { inputs: [{ account: APT, message: "m", nonce: "1" }] } })).rejects.toMatchObject({ code: 4100 });
  });
});
