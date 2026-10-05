/**
 * Cardano Foundation cardano-connect-with-wallet (stock ConnectWalletButton + useCardano), preprod
 * (limitNetwork TESTNET). Stock: default props, so the dropdown shows the library's default `supportedWallets`.
 * ?variant=clip: the same button with Clip's CIP-30 key ("clipwallet") added to `supportedWallets`, the one prop a
 * dapp sets to show another wallet.
 */
import { ConnectWalletButton, useCardano } from "@cardano-foundation/cardano-connect-with-wallet";
// TESTNET of the core package (a transitive dependency): the string "testnet".
const TESTNET = "testnet" as never;
import { Account, expose, mount } from "./kit";
import { withClip } from "./variant";

let disconnect: () => void = () => undefined;
expose(
  { library: "@cardano-foundation/cardano-connect-with-wallet 0.2.22", config: withClip ? 'limitNetwork TESTNET, supportedWallets: [...defaults, "clipwallet"]' : "limitNetwork TESTNET, default supportedWallets" },
  { disconnect: () => disconnect() },
);

const DEFAULTS = ["Flint", "Nami", "Eternl", "Yoroi", "Typhon", "NuFi", "Lace", "Gero", "Begin", "Vespr"];

function App() {
  const c = useCardano({ limitNetwork: TESTNET });
  disconnect = c.disconnect;
  return (
    <>
      <ConnectWalletButton limitNetwork={TESTNET} {...(withClip ? { supportedWallets: [...DEFAULTS, "clipwallet"] } : {})} />
      <Account address={c.isConnected ? (c.usedAddresses[0] ?? c.unusedAddresses[0] ?? "") : ""} />
      <p id="stake">{c.stakeAddress ?? ""}</p>
    </>
  );
}

mount(<App />);
