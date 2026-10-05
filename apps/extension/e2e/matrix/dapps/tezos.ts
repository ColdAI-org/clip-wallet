/**
 * Tezos (shadownet): Beacon (@airgap/beacon-dapp DAppClient), which finds browser-extension wallets by its
 * postMessage ping (PostMessageTransport.getAvailableExtensions) and pairs over postMessage. Beacon's own modal lists
 * Clip but its tile does nothing for a Chromium extension that isn't in Beacon's built-in list (UI 4.8.0 only offers
 * "Use Extension" for listed or Firefox ids), so this page answers PAIR_INIT itself and sends the same pairing
 * message that modal's "Use Extension" button sends. Then requestPermissions on shadownet, requestSignPayload of a
 * Micheline-encoded "Tezos Signed Message" verified with @taquito/utils verifySignature, and requestOperation of a
 * 1-mutez transaction to yourself.
 */
import { BeaconEvent, DAppClient, ExtensionMessageTarget, NetworkType, PostMessageTransport, SigningType, TezosOperationType } from "@airgap/beacon-dapp";
import { verifySignature } from "@taquito/utils";
import { MESSAGE, expose, hex } from "../dapp-kit";

let client: DAppClient;
let address = "";
let publicKey = "";

/** The Micheline string encoding Tezos wallets expect for sign-in messages: 05 01 <len:4> <utf8>. */
const micheline = (text: string) => {
  const b = new TextEncoder().encode(text);
  return `0501${b.length.toString(16).padStart(8, "0")}${hex(b)}`;
};

expose({
  info: { dapp: "@airgap/beacon-dapp DAppClient (Beacon pairing modal, postMessage transport) + @taquito/utils in a local page, shadownet", why: "Beacon is how every Tezos dapp (and Taquito's BeaconWallet) reaches an extension; a local page pins shadownet" },
  steps: {
    connect: async () => {
      client = new DAppClient({
        name: "Clip dapp matrix",
        network: { type: NetworkType.SHADOWNET },
        preferredNetwork: NetworkType.SHADOWNET,
        eventHandlers: {
          [BeaconEvent.PAIR_INIT]: {
            handler: async (data: { postmessagePeerInfo: Promise<string> }) => {
              const exts = await PostMessageTransport.getAvailableExtensions();
              const clip = exts.find((e) => e.name === "Clip Wallet");
              if (!clip) throw new Error(`Beacon found no Clip Wallet extension (${exts.map((e) => e.name).join(", ")})`);
              window.postMessage({ target: ExtensionMessageTarget.EXTENSION, payload: await data.postmessagePeerInfo, targetId: clip.id }, location.origin);
            },
          },
        },
      } as never);
      const r = await client.requestPermissions();
      address = r.address;
      publicKey = r.publicKey ?? "";
      return { address, network: r.network?.type };
    },
    sign: async () => {
      const payload = micheline(`Tezos Signed Message: ${location.host} ${new Date().toISOString()} ${MESSAGE}`);
      const r = await client.requestSignPayload({ signingType: SigningType.MICHELINE, payload });
      return { valid: verifySignature(payload, publicKey, r.signature), how: "@taquito/utils verifySignature (Micheline payload)" };
    },
    send: async () => {
      const r = await client.requestOperation({ operationDetails: [{ kind: TezosOperationType.TRANSACTION, destination: address, amount: "1" }] });
      return { id: r.transactionHash };
    },
  },
});
