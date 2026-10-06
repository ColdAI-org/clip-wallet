/**
 * 1Mask's Fuel connector (packages/1mask/src/inpage/fuel.ts, imported by path: it is dependency-free and 1Mask has no
 * fuels-ts dev dependency) against the real fuels-ts `Fuel` connector manager, with this module standing in for the
 * wallet behind it: discovery by the FuelConnector event, connect, accounts, Account.signMessage, and a fuels-ts
 * TransactionRequest instance crossing as JSON to the same transaction id.
 */
import { Fuel, Signer, hashMessage, transactionRequestify } from "fuels";
import { describe, expect, it } from "vitest";
import { installFuelConnector } from "../../1mask/src/inpage/fuel.js";
import type { InpageTransport } from "../../1mask/src/inpage/transport.js";
import { DEFAULT_IDENTITY } from "../../1mask/src/shared/config.js";
import { FUEL_TESTNET, createFuelModule } from "../src/index.js";
import { ACCOUNT0, SIG, TEXT_MESSAGE, TRANSFER_ID, TRANSFER_TX } from "./fixtures.js";
import { ctxFor, fakeNode, sig } from "./helpers.js";

const mod = createFuelModule();

/** The wallet side, minus the router: connect grants, signing goes decode → prepare → (fixture signature) → finalize. */
function walletTransport() {
  let connected = false;
  const node = fakeNode({}, [{ data: { submitAndAwaitStatus: { type: "SuccessStatus", transactionId: TRANSFER_ID } } }]);
  const ctx = ctxFor(node.fetch);
  const decoded: string[] = [];
  const t: InpageTransport = {
    async request(family, method, params) {
      expect(family).toBe("fuel");
      const p = JSON.parse(JSON.stringify(params ?? null));
      switch (method) {
        case "1mask_getAccounts":
          return connected ? [{ address: ACCOUNT0.address }] : [];
        case "fuel:connect":
          connected = true;
          return [{ address: ACCOUNT0.address }];
        case "fuel:currentNetwork":
          return { url: FUEL_TESTNET.rpcUrls[0], chainId: 0 };
        case "fuel:networks":
          return [{ url: FUEL_TESTNET.rpcUrls[0], chainId: 0 }];
      }
      const req = { id: "r", origin: "https://app.example", via: "injected" as const, family: "fuel" as const, networkId: "fuel:0", method, params: p };
      decoded.push((await mod.decode(req, ctx)).title);
      const [payload] = await mod.prepare(req, ctx, "a");
      const digest = Buffer.from(payload!.bytes).toString("hex");
      const s = Object.values(SIG).find((x) => x.digest === digest);
      if (!s) throw new Error(`no fixture signature for ${digest}`);
      return mod.finalize(req, [sig(s)], ctx);
    },
    onEvent: () => () => {},
    destroy: () => {},
  };
  return { t, decoded };
}

describe("1Mask Fuel connector with fuels-ts Fuel", () => {
  it("is found through the FuelConnector event and works as a connector", async () => {
    const target = Object.assign(new EventTarget(), { CustomEvent }) as unknown as Window;
    const fuel = new Fuel({ targetObject: target as never, storage: null });
    const { t, decoded } = walletTransport();
    const { connector } = installFuelConnector(target, DEFAULT_IDENTITY, t, { reannounce: false });

    expect(await fuel.hasConnector()).toBe(true);
    expect(fuel.currentConnector()?.name).toBe("Clip Wallet");
    expect((await fuel.connectors()).map((c) => [c.name, c.installed])).toEqual([["Clip Wallet", true]]);
    expect(await fuel.isConnected()).toBe(false);
    expect(await fuel.connect()).toBe(true);
    expect(await fuel.accounts()).toEqual([ACCOUNT0.address]);
    expect(await fuel.currentNetwork()).toEqual({ url: FUEL_TESTNET.rpcUrls[0], chainId: 0 });

    const wallet = await fuel.getWallet(ACCOUNT0.address);
    const signature = await wallet.signMessage(TEXT_MESSAGE);
    expect(Signer.recoverAddress(hashMessage(TEXT_MESSAGE), signature).toString()).toBe(ACCOUNT0.address);

    const id = await connector.sendTransaction(ACCOUNT0.address, transactionRequestify(TRANSFER_TX as never), { provider: { url: FUEL_TESTNET.rpcUrls[0]! } });
    expect(id).toBe(TRANSFER_ID);
    expect(decoded).toEqual(["Sign a message for app.example", "Send 0.000000001 ETH to 0x033d…5e17"]);
    fuel.unsubscribe();
  });
});
