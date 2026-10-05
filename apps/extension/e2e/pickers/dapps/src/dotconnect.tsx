/**
 * DOT Connect (ReactiveDOT's stock <dc-connection-button> / connection dialog), the documented vanilla setup:
 * registerDotConnect({ wallets: [new InjectedWalletProvider()] }). It lists every window.injectedWeb3 extension; known
 * wallets get a name and logo from DOT Connect's own wallet list.
 */
import { registerDotConnect } from "dot-connect";
import { InjectedWalletProvider } from "@reactive-dot/core/wallets.js";
// The page reads the same stores the dialog uses (not in dot-connect's exports map, so by path).
import { accounts$, connectedWallets$ } from "../node_modules/dot-connect/build/stores.js";
import { useEffect, useState } from "react";
import { Account, expose, mount } from "./kit";

registerDotConnect({ wallets: [new InjectedWalletProvider()] });
let wallets: { disconnect(): Promise<void> | void }[] = [];
expose({ library: "dot-connect 0.31.0 (@reactive-dot/core 0.72.0)", config: "wallets: [new InjectedWalletProvider()]" }, { disconnect: () => Promise.all(wallets.map((w) => w.disconnect())) });

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "dc-connection-button": Record<string, unknown>;
    }
  }
}

function App() {
  const [address, set] = useState("");
  useEffect(() => {
    const a = (accounts$ as unknown as { subscribe(f: (v: { address: string }[]) => void): { unsubscribe(): void } }).subscribe((v) => set(v[0]?.address ?? ""));
    const b = (connectedWallets$ as unknown as { subscribe(f: (v: typeof wallets) => void): { unsubscribe(): void } }).subscribe((v) => (wallets = v));
    return () => (a.unsubscribe(), b.unsubscribe());
  }, []);
  return (
    <>
      <dc-connection-button />
      <Account address={address} />
    </>
  );
}

mount(<App />);
