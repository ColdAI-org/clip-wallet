/**
 * sats-connect 4 (its stock wallet selector, @sats-connect/ui), the documented flow: Wallet.request("getAccounts")
 * from a button opens the selector when no wallet was picked before. Default configuration (makeDefaultConfig).
 */
import { useState } from "react";
import Wallet from "sats-connect";
import { Account, expose, mount } from "./kit";

let set: (a: string) => void = () => undefined;
expose({ library: "sats-connect 4.2.1 (@sats-connect/ui selector)", config: "default selector config" }, { disconnect: async () => (await Wallet.disconnect(), set("")) });

function App() {
  const [address, setAddress] = useState("");
  set = setAddress;
  const go = async () => {
    const r = await Wallet.request("getAccounts", { purposes: ["payment"] } as never);
    if (r.status === "success") setAddress((r.result as { address: string }[])[0]?.address ?? "");
  };
  return (
    <>
      <button type="button" onClick={() => void go()}>
        Connect wallet
      </button>
      <Account address={address} />
    </>
  );
}

mount(<App />);
