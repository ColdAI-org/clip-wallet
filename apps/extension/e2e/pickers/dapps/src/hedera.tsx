/**
 * Hedera WalletConnect (@hashgraph/hedera-wallet-connect DAppConnector), testnet: init() runs extension discovery
 * (hedera-extension-query) and the page lists `dAppConnector.extensions` as the HashConnect/DAppConnector UIs do, plus
 * the stock WalletConnect modal (openModal). Needs a real WalletConnect project id (__PICKER_WC_PROJECT_ID__).
 */
import { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent } from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hiero-ledger/sdk";
import { useEffect, useState } from "react";
import { Account, expose, mount } from "./kit";

declare const __PICKER_WC_PROJECT_ID__: string;
const connector = new DAppConnector(
  { name: "Clip picker matrix", description: "Clip picker matrix", url: location.origin, icons: [] },
  LedgerId.TESTNET,
  __PICKER_WC_PROJECT_ID__,
  Object.values(HederaJsonRpcMethod),
  [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
  [HederaChainId.Testnet],
);
const ready = connector.init({ logger: "error" });
let set: (a: string) => void = () => undefined;
expose({ library: "@hashgraph/hedera-wallet-connect 2.1.3 DAppConnector", config: "testnet, extension discovery" }, { disconnect: async () => (await connector.disconnectAll(), set("")) });

function App() {
  const [address, setAddress] = useState("");
  const [exts, setExts] = useState<{ id: string; name?: string; icon?: string; available: boolean }[]>([]);
  set = setAddress;
  useEffect(() => {
    const t = setInterval(() => setExts([...(connector.extensions as never as typeof exts)]), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <ul id="extensions">
        {exts.filter((e) => e.available).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => void ready.then(() => connector.connectExtension(e.id)).then((s) => setAddress(String(s.namespaces?.hedera?.accounts?.[0] ?? "").split(":").pop() ?? ""))}>
              <img src={e.icon} alt="" width={32} height={32} /> {e.name}
            </button>
          </li>
        ))}
      </ul>
      <Account address={address} />
    </>
  );
}

mount(<App />);
