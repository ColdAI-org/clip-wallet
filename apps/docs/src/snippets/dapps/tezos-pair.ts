// Until Clip Wallet is in Beacon's extension list, Beacon's modal shows it but can't pair with it. This pairs
// directly, the way the modal's "Use Extension" button does for listed wallets. Remove it once Clip is listed.
import { BeaconEvent, DAppClient, ExtensionMessageTarget, NetworkType, PostMessageTransport } from "@airgap/beacon-dapp";

export const client = new DAppClient({
  name: "Example app",
  network: { type: NetworkType.SHADOWNET },
  eventHandlers: {
    [BeaconEvent.PAIR_INIT]: {
      handler: async (data: { postmessagePeerInfo: Promise<string> }) => {
        const extensions = await PostMessageTransport.getAvailableExtensions();
        const clip = extensions.find((e) => e.name === "Clip Wallet");
        if (!clip) return; // not installed: Beacon's modal carries on as usual
        window.postMessage({ target: ExtensionMessageTarget.EXTENSION, payload: await data.postmessagePeerInfo, targetId: clip.id }, location.origin);
      },
    },
  },
});

export async function connectTezos() {
  const { address, publicKey } = await client.requestPermissions();
  return { address, publicKey };
}
