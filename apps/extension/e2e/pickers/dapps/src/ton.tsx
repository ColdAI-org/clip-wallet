/**
 * TON Connect UI 3 (stock TonConnectUI button + modal), the documented setup: manifestUrl and buttonRootId.
 * Stock: the official wallets list only. ?variant=clip: walletsListConfiguration.includeWallets with the entry a dapp
 * can add for a wallet that isn't listed yet (Clip's draft wallets-list entry, docs/listings/ton-connect.md; the
 * image is the icon the extension announces). TON Connect UI restores the connection on load (restoreConnection).
 */
import { TonConnectUI } from "@tonconnect/ui";
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";
import { useEffect, useState } from "react";

// The button's root exists before TonConnectUI is constructed (it looks the element up immediately).
const root = document.createElement("div");
root.id = "ton-connect";
document.getElementById("root")!.before(root);
const icon = (window as unknown as { clipwallet?: { info?: { icon?: string } } }).clipwallet?.info?.icon ?? "";
const ui = new TonConnectUI({
  manifestUrl: `${location.origin}/tonconnect-manifest.json`,
  buttonRootId: "ton-connect",
  ...(withClip
    ? { walletsListConfiguration: { includeWallets: [{ appName: "clipwallet", name: "Clip Wallet", imageUrl: icon, aboutUrl: "https://coldai.org/clip-wallet", jsBridgeKey: "clipwallet", platforms: ["chrome"] }] } }
    : {}),
} as never);
expose({ library: "@tonconnect/ui 3.0.2", config: withClip ? "includeWallets: [Clip Wallet, jsBridgeKey clipwallet]" : "official wallets list" }, { disconnect: () => ui.disconnect() });

function App() {
  const [address, set] = useState("");
  useEffect(() => ui.onStatusChange((w) => set(w?.account.address ?? "")), []);
  return (
    <>
      <Account address={address} />
    </>
  );
}

mount(<App />);
