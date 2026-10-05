/**
 * starknetkit 3 (its stock connect() modal), the documented setup: connect({ modalMode: "alwaysAsk" }) from a button,
 * and connect({ modalMode: "neverAsk" }) on load to restore the last wallet (starknetkit's autoconnect).
 * Stock: starknetkit's default connectors. ?variant=clip: connectors Ready (ArgentX), Braavos and
 * new InjectedConnector({ options: { id: "clipwallet" } }) for window.starknet_clipwallet, with no name or icon, so
 * the modal shows what the injected wallet announces.
 */
import { useEffect, useState } from "react";
import { connect, disconnect } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import { ArgentX } from "starknetkit/argentX";
import { Braavos } from "starknetkit/braavos";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

const connectors = withClip ? [new ArgentX(), new Braavos(), new InjectedConnector({ options: { id: "clipwallet" } })] : undefined;

let set: (a: string) => void = () => undefined;
expose({ library: "starknetkit 3.4.3", config: `${withClip ? "connectors: ArgentX, Braavos, InjectedConnector(clipwallet)" : "default connectors"}; modalMode "alwaysAsk" (button) / "neverAsk" (on load)` }, { disconnect: async () => (await disconnect({ clearLastWallet: true }), set("")) });

async function run(modalMode: "alwaysAsk" | "neverAsk") {
  const r = await connect({ modalMode, dappName: "Picker matrix", ...(connectors ? { connectors } : {}) } as never);
  const data = (r as { connectorData?: { account?: string } }).connectorData;
  set(data?.account ?? "");
}

function App() {
  const [address, setAddress] = useState("");
  set = setAddress;
  useEffect(() => {
    void run("neverAsk").catch(() => undefined);
  }, []);
  return (
    <>
      <button type="button" onClick={() => void run("alwaysAsk")}>
        Connect wallet
      </button>
      <Account address={address} />
    </>
  );
}

mount(<App />);
