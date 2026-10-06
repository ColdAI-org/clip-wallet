/**
 * TRON (Nile): discovery over TIP-6963 and the TIP-1193 provider it announces, as a TRON dapp written against the
 * standards does it; TronWeb 6 for everything else.
 *  - connect: `TIP6963:requestProvider` → pick Clip's announcement by rdns → `eth_requestAccounts` (TIP-1102) on Nile
 *    (`wallet_switchEthereumChain`, TIP-3326, if the provider starts elsewhere).
 *  - sign: `provider.tronWeb.trx.signMessageV2` (TIP-104), checked with TronWeb's static `Trx.verifyMessageV2`, which
 *    recovers the signer's address.
 *  - send: a 1-sun TRX transfer built with TronWeb's transactionBuilder.sendTrx (no key), signed with
 *    `provider.tronWeb.trx.sign` and broadcast with TronWeb. TRON refuses transfers to yourself ("Cannot transfer TRX
 *    to yourself"), so it goes to the zero "black hole" address, which exists on Nile (no account-opening fee).
 * No @tronweb3/tronwallet-adapters: none of its adapters connects a generic TIP-6963 wallet (TronLinkAdapter and
 * TokenPocketAdapter listen to TIP-6963 but take only their own wallet's announcement, `info.name === "TronLink"` / …).
 */
import { TronWeb, Trx } from "tronweb";
import { MESSAGE, NeedsFunds, expose, waitFor } from "../dapp-kit";

const NILE = "https://nile.trongrid.io";
const NILE_CHAIN_ID = "0xcd8690dc";
const BLACK_HOLE = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const RDNS = "org.coldai.clipwallet";

interface Tip1193 {
  request(a: { method: string; params?: unknown }): Promise<unknown>;
  tronWeb: { trx: { sign(tx: unknown): Promise<{ txID: string; signature: string[] }>; signMessageV2(m: string): Promise<string> } };
}
interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Tip1193;
}

const tronWeb = new TronWeb({ fullHost: NILE });
const announced: Announced[] = [];
window.addEventListener("TIP6963:announceProvider", (e) => announced.push((e as CustomEvent<Announced>).detail));
window.dispatchEvent(new Event("TIP6963:requestProvider"));

let provider: Tip1193;
let address = "";

expose({
  info: {
    dapp: "TIP-6963 discovery + TIP-1193 provider + TronWeb 6 in a local page, Nile",
    why: "TIP-6963/TIP-1193 is the TRON standard for injected wallets; tronwallet-adapters has no adapter for a generic TIP-6963 wallet",
  },
  steps: {
    connect: async () => {
      const d = await waitFor(() => announced.find((a) => a.info.rdns === RDNS), "Clip Wallet (TIP-6963)");
      provider = d.provider;
      if ((await provider.request({ method: "eth_chainId" })) !== NILE_CHAIN_ID) {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NILE_CHAIN_ID }] });
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      address = accounts[0]!;
      return { address, chainId: await provider.request({ method: "eth_chainId" }), name: d.info.name };
    },
    sign: async () => {
      const signature = await provider.tronWeb.trx.signMessageV2(MESSAGE);
      return { valid: Trx.verifyMessageV2(MESSAGE, signature) === address, how: "TronWeb Trx.verifyMessageV2 (TIP-104 signMessageV2)" };
    },
    send: async () => {
      // java-tron can't build a transaction for an account that doesn't exist yet.
      const account = (await tronWeb.trx.getAccount(address)) as { address?: string };
      if (!account.address) throw new NeedsFunds("the account doesn't exist on Nile yet (receive TRX first)");
      const tx = await tronWeb.transactionBuilder.sendTrx(BLACK_HOLE, 1, address);
      const signed = await provider.tronWeb.trx.sign(tx);
      const r = (await tronWeb.trx.sendRawTransaction(signed as never)) as { result?: boolean; txid?: string; code?: string; message?: string };
      if (!r.result) {
        const why = r.message && /^[0-9a-f]+$/i.test(r.message) ? new TextDecoder().decode(Uint8Array.from(r.message.match(/../g)!.map((h) => parseInt(h, 16)))) : r.message;
        if (/balance is not sufficient|account resource insufficient/i.test(why ?? "")) throw new NeedsFunds(`Nile refused: ${why}`);
        throw new Error(`Nile refused: ${r.code ?? ""} ${why ?? ""}`.trim());
      }
      return { id: r.txid ?? signed.txID };
    },
  },
});
