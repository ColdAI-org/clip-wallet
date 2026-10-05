/**
 * Stellar Wallets Kit 2 (stock createButton + auth modal), testnet. Stock: defaultModules().
 * ?variant=clip: defaultModules() plus @clip-wallet/kit-modules/stellar's ClipWalletModule, the documented way a wallet
 * joins the kit.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { KitEventType, Networks } from "@creit.tech/stellar-wallets-kit/types";
import { ClipWalletModule } from "@clip-wallet/kit-modules/stellar";
import { useEffect, useRef, useState } from "react";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

StellarWalletsKit.init({ modules: withClip ? [...defaultModules(), new ClipWalletModule() as never] : defaultModules(), network: Networks.TESTNET });
expose(
  { library: "@creit.tech/stellar-wallets-kit 2.7.0", config: withClip ? "modules: defaultModules() + ClipWalletModule, TESTNET" : "modules: defaultModules(), TESTNET" },
  { disconnect: () => StellarWalletsKit.disconnect() },
);

function App() {
  const [address, set] = useState("");
  const button = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void StellarWalletsKit.createButton(button.current!);
    const off = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (e) => set(e.payload.address ?? ""));
    const off2 = StellarWalletsKit.on(KitEventType.DISCONNECT, () => set(""));
    return () => (off(), off2());
  }, []);
  return (
    <>
      <div ref={button} />
      <Account address={address} />
    </>
  );
}

mount(<App />);
