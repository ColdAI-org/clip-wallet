/**
 * Fuel (testnet): fuels-ts `Fuel` connector manager (the Fuel connector standard, discovery by the "FuelConnector"
 * window event) picking Clip's connector from its connectors list, connect + accounts, Account.signMessage verified
 * with fuels-ts `Signer.recoverAddress(hashMessage(msg), sig)`, and a 1-unit base-asset (ETH) transfer to yourself
 * with `wallet.transfer`, which assembles the transaction on testnet.fuel.network and hands it to the connector.
 */
import type { FuelConnector } from "fuels";
// fuels' own self-contained browser build. The package's "exports" map only offers the Node build, whose
// @fuel-ts/crypto imports pbkdf2Sync/createHmac/randomUUID from node:crypto, which the matrix bundler stubs out.
// @ts-ignore: the browser build has no declaration file; it is typed as the package just below.
import * as fuelsBrowser from "../../../node_modules/fuels/dist/browser.min.mjs";
import { MESSAGE, NeedsFunds, expose } from "../dapp-kit";

const { Fuel, Provider, Signer, hashMessage } = fuelsBrowser as typeof import("fuels");

const TESTNET = "https://testnet.fuel.network/v1/graphql";
const fuel = new Fuel({ storage: null });
let address = "";

type Connector = FuelConnector;
const clipConnector = () => (window as unknown as { clipwallet?: { fuel?: Connector } }).clipwallet?.fuel;

/** Clip's connector from the Fuel connectors list (it announces itself; re-announce if this Fuel came up later). */
async function pickClip(): Promise<Connector> {
  const own = clipConnector();
  if (!own) throw new Error("window.clipwallet.fuel not available");
  for (let i = 0; i < 40; i++) {
    const found = (await fuel.connectors()).find((c) => c === own || c.name === own.name);
    if (found) {
      await fuel.selectConnector(found.name);
      return found;
    }
    // The documented discovery event, with the connector the wallet put on window (a Fuel created after the
    // wallet's own announcements missed them).
    if (i === 10) window.dispatchEvent(new CustomEvent("FuelConnector", { detail: own }));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Clip's connector never showed up in Fuel's connectors list");
}

expose({
  info: {
    dapp: "fuels-ts Fuel connector manager (FuelConnector event discovery) + fuels Provider in a local page, Fuel testnet",
    why: "fuels-ts Fuel is the connector API every Fuel dapp (and @fuels/react) uses; a local page avoids a dapp's own build and its WalletConnect setup",
  },
  steps: {
    connect: async () => {
      const c = await pickClip();
      if (!(await fuel.connect())) throw new Error("connect was declined");
      const accounts = await fuel.accounts();
      address = (await fuel.currentAccount()) ?? accounts[0] ?? "";
      if (!address) throw new Error("no Fuel account");
      const network = await fuel.currentNetwork();
      return { address, connector: c.name, accounts, chainId: network.chainId };
    },
    sign: async () => {
      const wallet = await fuel.getWallet(address, new Provider(TESTNET));
      const signature = await wallet.signMessage(MESSAGE);
      const recovered = Signer.recoverAddress(hashMessage(MESSAGE), signature).toString();
      return { valid: recovered.toLowerCase() === address.toLowerCase(), how: "fuels-ts Signer.recoverAddress(hashMessage(message), signature)", signature };
    },
    send: async () => {
      const provider = new Provider(TESTNET);
      const wallet = await fuel.getWallet(address, provider);
      const balance = await wallet.getBalance(await provider.getBaseAssetId());
      if (balance.isZero()) throw new NeedsFunds("the Fuel testnet account has no ETH (faucet-testnet.fuel.network)");
      const tx = await wallet.transfer(address, 1);
      const result = await tx.waitForResult();
      return { id: tx.id, status: result.status };
    },
  },
});
