// starknetkit's modal: add Clip Wallet as an injected connector next to the defaults.
import { connect } from "starknetkit";
import { InjectedConnector } from "starknetkit/injected";
import { ArgentX } from "starknetkit/argentX";
import { Braavos } from "starknetkit/braavos";

export async function openStarknetModal() {
  const { connectorData } = await connect({
    modalMode: "alwaysAsk",
    dappName: "Example app",
    connectors: [new ArgentX(), new Braavos(), new InjectedConnector({ options: { id: "clipwallet" } })],
  });
  return connectorData?.account;
}
