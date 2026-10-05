/**
 * Substrate (Westend): @polkadot/extension-dapp discovery (web3Enable / web3Accounts over window.injectedWeb3, as
 * polkadot.js apps and every Polkadot SDK dapp do), signRaw verified with @polkadot/util-crypto signatureVerify
 * (<Bytes> wrapping, as signRaw signs it), and balances.transferKeepAlive(1 planck) to yourself built and sent with
 * @polkadot/api using the extension's signer (signPayload).
 */
import { web3Accounts, web3Enable, web3FromSource } from "@polkadot/extension-dapp";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { signatureVerify, cryptoWaitReady } from "@polkadot/util-crypto";
import { stringToHex, u8aWrapBytes } from "@polkadot/util";
import { MESSAGE, expose } from "../dapp-kit";

const RPC = "wss://westend-rpc.polkadot.io";
let address = "";
let source = "";

expose({
  info: { dapp: "@polkadot/extension-dapp + @polkadot/api in a local page, Westend", why: "the same libraries polkadot.js apps uses; apps' UI is too large to drive reliably (live run: see the doc)" },
  steps: {
    connect: async () => {
      const exts = await web3Enable("Clip dapp matrix");
      const clip = exts.find((e) => e.name === "clip-wallet");
      if (!clip) throw new Error(`clip-wallet not in injectedWeb3 (${exts.map((e) => e.name).join(", ")})`);
      const accounts = await web3Accounts({ extensions: ["clip-wallet"], ss58Format: 42 });
      address = accounts[0]!.address;
      source = accounts[0]!.meta.source;
      return { address, source };
    },
    sign: async () => {
      await cryptoWaitReady();
      const injector = await web3FromSource(source);
      const data = stringToHex(MESSAGE);
      const { signature } = await injector.signer.signRaw!({ address, data, type: "bytes" });
      const ok = signatureVerify(u8aWrapBytes(MESSAGE), signature, address).isValid;
      return { valid: ok, how: "@polkadot/util-crypto signatureVerify over <Bytes>-wrapped message" };
    },
    send: async () => {
      const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
      const injector = await web3FromSource(source);
      const id = await new Promise<string>((resolve, reject) => {
        api.tx.balances!
          .transferKeepAlive!(address, 1)
          .signAndSend(address, { signer: injector.signer }, ({ status, dispatchError, txHash }) => {
            if (dispatchError) reject(new Error(dispatchError.toString()));
            else if (status.isInBlock) resolve(status.asInBlock.toHex());
            void txHash;
          })
          .catch(reject);
      });
      await api.disconnect();
      return { id };
    },
  },
});
