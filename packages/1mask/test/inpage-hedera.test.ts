/**
 * Dapp matrix regression (docs/r1/dapp-matrix.md): @hashgraph/hedera-wallet-connect's DAppConnector (HashConnect v3)
 * finds Hedera extension wallets with a "hedera-extension-query" postMessage and hands the chosen one its WalletConnect
 * pairing code with "hedera-extension-connect-<id>". Clip didn't answer, so Hedera dApps never listed it as an
 * extension. These are the exact messages extensionController.ts (hedera-wallet-connect 2.1.3) posts.
 */
import { describe, expect, it, vi } from "vitest";
import { createInpageTransport } from "../src/inpage/transport.js";
import { HEDERA_EXTENSION_EVENTS, installHederaExtensionDiscovery } from "../src/inpage/hedera.js";
import { injectedAllowlist } from "../src/background/methods.js";
import { makeHarness, tick } from "./helpers.js";

const IDENTITY = { name: "Clip Wallet", icon: "data:image/svg+xml;base64,PHN2Zy8+", rdns: "org.coldai.clipwallet" } as const;
const WC = `wc:${"ab".repeat(32)}@2?relay-protocol=irn&symKey=${"cd".repeat(32)}&expiryTimestamp=1999999999`;

function setup(pair?: (origin: string, uri: string) => Promise<void>) {
  const h = makeHarness(pair ? { walletConnectPair: pair } : {});
  const transport = createInpageTransport({ channel: h.channel, win: h.win });
  const found: unknown[] = [];
  h.win.addEventListener("message", (e) => {
    const d = (e as MessageEvent).data as { type?: string; metadata?: unknown };
    if (d?.type === HEDERA_EXTENSION_EVENTS.response) found.push(d.metadata);
  });
  const inst = installHederaExtensionDiscovery(h.win, IDENTITY as never, transport, { extensionId: "ocigbgcllgmmaecjccgiiodahdlngklb" });
  return { ...h, found, inst };
}

describe("Hedera extension discovery (DAppConnector / HashConnect)", () => {
  it("answers hedera-extension-query with the wallet's id, name and icon", async () => {
    const { win, found } = setup();
    win.postMessage({ type: "hedera-extension-query" }, "*");
    await tick(10);
    expect(found).toEqual([{ id: "ocigbgcllgmmaecjccgiiodahdlngklb", name: "Clip Wallet", icon: IDENTITY.icon }]);
  });

  it("passes the pairing code from hedera-extension-connect-<id> to the wallet's WalletConnect pairing", async () => {
    const pair = vi.fn(async () => undefined);
    const { win } = setup(pair);
    win.postMessage({ type: "hedera-extension-connect-ocigbgcllgmmaecjccgiiodahdlngklb", pairingString: WC }, "*");
    await tick(30);
    expect(pair).toHaveBeenCalledWith("https://dapp.example", WC);
  });

  it("ignores other extensions' ids, non-WalletConnect strings and the open ping", async () => {
    const pair = vi.fn(async () => undefined);
    const { win } = setup(pair);
    win.postMessage({ type: "hedera-extension-connect-hashpack", pairingString: WC }, "*");
    win.postMessage({ type: "hedera-extension-connect-ocigbgcllgmmaecjccgiiodahdlngklb", pairingString: "javascript:alert(1)" }, "*");
    win.postMessage({ type: "hedera-extension-open-ocigbgcllgmmaecjccgiiodahdlngklb" }, "*");
    await tick(30);
    expect(pair).not.toHaveBeenCalled();
  });

  it("is the only injected Hedera method, and the router refuses it without a host pairing function", async () => {
    expect([...injectedAllowlist("hedera")]).toEqual(["hedera:walletConnectPair"]);
    const { router } = setup();
    await expect(router.dispatch("https://dapp.example", { family: "hedera", method: "hedera:walletConnectPair", params: { uri: WC } })).rejects.toMatchObject({ code: 4200 });
    const withPair = setup(async () => undefined);
    await expect(withPair.router.dispatch("https://dapp.example", { family: "hedera", method: "hedera:walletConnectPair", params: { uri: "wc:bad" } })).rejects.toMatchObject({ code: -32602 });
  });
});
