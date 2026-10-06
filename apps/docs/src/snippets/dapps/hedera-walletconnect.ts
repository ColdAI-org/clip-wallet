// Hedera's native API over WalletConnect (the HashConnect v3 path). DAppConnector finds Clip Wallet as an
// extension ("hedera-extension-query") when the wallet was built with a WalletConnect project id.
import { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent } from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hiero-ledger/sdk";

export async function connectHedera() {
  const connector = new DAppConnector(
    { name: "Example app", description: "Example app", url: "https://example.app", icons: ["https://example.app/icon.png"] },
    LedgerId.TESTNET,
    "YOUR_REOWN_PROJECT_ID",
    Object.values(HederaJsonRpcMethod),
    [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
    [HederaChainId.Testnet],
  );
  await connector.init({ logger: "error" });
  const clip = connector.extensions.find((e) => e.name === "Clip Wallet" && e.available);
  if (clip) await connector.connectExtension(clip.id);
  else await connector.openModal(); // QR code for the phone app, or any other wallet
  return connector.signers[0]?.getAccountId().toString(); // "0.0.x"
}
