/**
 * Cosmos (Osmosis testnet, osmo-test-5): the Keplr API as a Keplr dapp calls it, on Clip's own global
 * (window.clipwallet.cosmos): enable + getOfflineSigner, whose getAccounts() cosmjs reads; ADR-36 signArbitrary
 * verified the way Keplr's verifyADR36Amino does it (Keplr makeADR36AminoSignDoc rebuilt with @cosmjs/amino
 * makeSignDoc + serializeSignDoc, sha256, @cosmjs/crypto Secp256k1.verifySignature, signer = pubkeyToAddress);
 * and a 1-uosmo MsgSend to yourself with @cosmjs/stargate SigningStargateClient.signAndBroadcast (SIGN_MODE_DIRECT
 * through the offline signer). @keplr-wallet/cosmos itself isn't bundled: its tiny-secp256k1 dependency needs a
 * native build the workspace doesn't allow.
 */
import { makeSignDoc, pubkeyToAddress, serializeSignDoc } from "@cosmjs/amino";
import { Secp256k1, Secp256k1Signature, sha256 } from "@cosmjs/crypto";
import { fromBase64, toBase64, toUtf8 } from "@cosmjs/encoding";
import { GasPrice, SigningStargateClient, assertIsDeliverTxSuccess } from "@cosmjs/stargate";
import { MESSAGE, NeedsFunds, expose, waitFor } from "../dapp-kit";

const CHAIN_ID = "osmo-test-5";
const RPC = "https://rpc.osmotest5.osmosis.zone";
const REST = "https://lcd.osmotest5.osmosis.zone";

interface KeplrLike {
  enable(chainIds: string | string[]): Promise<void>;
  getOfflineSigner(chainId: string): { getAccounts(): Promise<{ address: string; algo: string; pubkey: Uint8Array }[]> } & Parameters<typeof SigningStargateClient.connectWithSigner>[1];
  signArbitrary(chainId: string, signer: string, data: string): Promise<{ pub_key: { type: string; value: string }; signature: string }>;
}

const provider = () => waitFor(() => (window as unknown as { clipwallet?: { cosmos?: KeplrLike } }).clipwallet?.cosmos, "window.clipwallet.cosmos");
let address = "";

expose({
  info: { dapp: "Keplr API on window.clipwallet.cosmos + @cosmjs/stargate SigningStargateClient in a local page, osmo-test-5", why: "Osmosis dapps talk to Keplr's API through cosmjs; the hosted Osmosis frontend only knows wallet-specific globals" },
  steps: {
    connect: async () => {
      const k = await provider();
      await k.enable(CHAIN_ID);
      const accounts = await k.getOfflineSigner(CHAIN_ID).getAccounts();
      address = accounts[0]!.address;
      return { address, algo: accounts[0]!.algo, accounts: accounts.length };
    },
    sign: async () => {
      const k = await provider();
      const sig = await k.signArbitrary(CHAIN_ID, address, MESSAGE);
      const doc = makeSignDoc([{ type: "sign/MsgSignData", value: { signer: address, data: toBase64(toUtf8(MESSAGE)) } }], { gas: "0", amount: [] }, "", "", 0, 0);
      const signerOk = pubkeyToAddress(sig.pub_key, "osmo") === address;
      const valid = signerOk && (await Secp256k1.verifySignature(Secp256k1Signature.fromFixedLength(fromBase64(sig.signature)), sha256(serializeSignDoc(doc)), fromBase64(sig.pub_key.value)));
      return { valid, how: "ADR-36 amino doc (Keplr makeADR36AminoSignDoc) via @cosmjs/amino, sha256, @cosmjs/crypto Secp256k1.verifySignature" };
    },
    send: async () => {
      const k = await provider();
      const res = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${address}`);
      if (res.status === 404) throw new NeedsFunds("the account doesn't exist on osmo-test-5 yet");
      // Osmosis x/txfees: the EIP-1559 base fee, with headroom, as the Osmosis frontend does.
      const base = (await (await fetch(`${REST}/osmosis/txfees/v1beta1/cur_eip_base_fee`)).json()) as { base_fee?: string };
      const price = Math.max(0.025, Number(base.base_fee ?? "0.025") * 1.5);
      const client = await SigningStargateClient.connectWithSigner(RPC, k.getOfflineSigner(CHAIN_ID), { gasPrice: GasPrice.fromString(`${price.toFixed(6)}uosmo`) });
      const r = await client.signAndBroadcast(address, [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: address, toAddress: address, amount: [{ denom: "uosmo", amount: "1" }] } }], "auto", "Clip Wallet dapp matrix");
      assertIsDeliverTxSuccess(r);
      return { id: r.transactionHash };
    },
  },
});
