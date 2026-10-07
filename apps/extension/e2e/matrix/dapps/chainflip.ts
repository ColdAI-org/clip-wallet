/**
 * Chainflip State Chain (Perseverance testnet): the discovery and signing path lp.chainflip.io uses
 * (@polkadot/extension-dapp over window.injectedWeb3, addresses re-encoded to ss58 2112 "cF…", signer.signRaw /
 * signPayload). L2 is a signRaw verified with @polkadot/util-crypto signatureVerify. Chainflip has no plain FLIP
 * transfer, so L3 sends the cheapest state-changing call an LP portal starts with, liquidityProvider.registerLpAccount,
 * built with @polkadot/api and signed through the extension; every Chainflip call needs FLIP for its fee (NeedsFunds
 * until the account is funded from Sepolia tFLIP).
 */
import { web3Accounts, web3Enable, web3FromSource } from "@polkadot/extension-dapp";
import { ApiPromise, WsProvider } from "@polkadot/api";
import { cryptoWaitReady, encodeAddress, signatureVerify } from "@polkadot/util-crypto";
import { stringToHex, u8aWrapBytes } from "@polkadot/util";
import { MESSAGE, NeedsFunds, expose } from "../dapp-kit";

const RPC = "wss://perseverance.chainflip.xyz";
let address = "";
let source = "";

expose({
  info: { dapp: "@polkadot/extension-dapp + @polkadot/api in a local page, Chainflip Perseverance", why: "what lp.chainflip.io uses to reach Polkadot-style wallets; the portal itself needs a funded LP account" },
  steps: {
    connect: async () => {
      const exts = await web3Enable("Clip dapp matrix");
      const clip = exts.find((e) => e.name === "clip-wallet");
      if (!clip) throw new Error(`clip-wallet not in injectedWeb3 (${exts.map((e) => e.name).join(", ")})`);
      const accounts = await web3Accounts({ extensions: ["clip-wallet"] });
      source = accounts[0]!.meta.source;
      address = encodeAddress(accounts[0]!.address, 2112);
      return { address, source };
    },
    sign: async () => {
      await cryptoWaitReady();
      const injector = await web3FromSource(source);
      const { signature } = await injector.signer.signRaw!({ address, data: stringToHex(MESSAGE), type: "bytes" });
      return { valid: signatureVerify(u8aWrapBytes(MESSAGE), signature, address).isValid, how: "@polkadot/util-crypto signatureVerify over <Bytes>-wrapped message" };
    },
    send: async () => {
      const api = await ApiPromise.create({ provider: new WsProvider(RPC), noInitWarn: true });
      const flip = (await api.query.flip!.account!(address)) as unknown as { balance: { toBigInt(): bigint } };
      const injector = await web3FromSource(source);
      const tx = api.tx.liquidityProvider!.registerLpAccount!();
      if (flip.balance.toBigInt() === 0n) {
        // Still let the wallet decode and sign it (the approval is L4), then stop before broadcasting.
        await tx.signAsync(address, { signer: injector.signer });
        await api.disconnect();
        throw new NeedsFunds("signed, but the account has no FLIP for the fee (fund it from Sepolia tFLIP)");
      }
      const id = await new Promise<string>((resolve, reject) => {
        tx.signAndSend(address, { signer: injector.signer }, ({ status, dispatchError }) => {
          if (dispatchError) reject(new Error(dispatchError.toString()));
          else if (status.isInBlock) resolve(status.asInBlock.toHex());
        }).catch(reject);
      });
      await api.disconnect();
      return { id };
    },
  },
});
