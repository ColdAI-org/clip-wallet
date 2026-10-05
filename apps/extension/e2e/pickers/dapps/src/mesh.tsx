/**
 * Mesh (stock CardanoWallet button + modal from @meshsdk/react, the current "latest" release), the documented setup:
 * MeshProvider, CardanoWallet with `persist` (Mesh's session persistence, so a reload reconnects), the package's
 * styles.css. It lists every CIP-30 wallet in window.cardano.
 */
import "@meshsdk/react/styles.css";
import { CardanoWallet, MeshProvider, useWallet } from "@meshsdk/react";
import { Account, expose, mount } from "./kit";

let disconnect: () => void = () => undefined;
expose({ library: "@meshsdk/react 2.0.0-beta.2 CardanoWallet", config: "persist" }, { disconnect: () => disconnect() });

function Status() {
  const w = useWallet();
  disconnect = w.disconnect;
  return <Account address={w.connected ? w.address : ""} />;
}

mount(
  <MeshProvider>
    <CardanoWallet persist />
    <Status />
  </MeshProvider>,
);
