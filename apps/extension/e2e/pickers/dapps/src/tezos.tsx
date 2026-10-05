/**
 * Beacon (stock pairing modal of @airgap/beacon-dapp's DAppClient), shadownet: requestPermissions() from a button
 * opens Beacon's wallet modal. Default configuration otherwise.
 */
import { DAppClient, NetworkType } from "@airgap/beacon-dapp";
import { useState } from "react";
import { Account, expose, mount } from "./kit";

const client = new DAppClient({ name: "Clip picker matrix", network: { type: NetworkType.SHADOWNET } } as never);
let set: (a: string) => void = () => undefined;
expose({ library: "@airgap/beacon-dapp 4.8.1 (beacon-ui)", config: "shadownet" }, { disconnect: async () => (await client.clearActiveAccount(), set("")) });

function App() {
  const [address, setAddress] = useState("");
  set = setAddress;
  return (
    <>
      <button type="button" onClick={() => void client.requestPermissions().then((r) => setAddress(r.address)).catch(() => undefined)}>
        Connect wallet
      </button>
      <Account address={address} />
    </>
  );
}

void client.getActiveAccount().then((a) => a && set(a.address));
mount(<App />);
