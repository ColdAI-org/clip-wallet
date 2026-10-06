/**
 * MultiversX (devnet): @multiversx/sdk-dapp 5.7.3 driven headless (no unlock panel), the way an sdk-dapp dapp logs in
 * once the user picked a provider.
 *  - connect: `initApp({ dAppConfig: { environment: "devnet", nativeAuth: true } })`, which merges
 *    `window.multiversx.providers` into `ProviderFactory.customProviders` (sdk-dapp's UNDOCUMENTED custom-provider hook:
 *    1Mask adds Clip's own entry there, type "clipwallet"), then `ProviderFactory.create({ type: "clipwallet" })` and
 *    `login()`: sdk-dapp asks for a native-auth login token signature (address + token, MessageComputer).
 *  - sign: `signMessage(new Message({ data }))` through sdk-dapp's DappProvider, checked with sdk-dapp's own
 *    `verifyMessage` (MessageComputer + UserVerifier).
 *  - send: a 1-attoEGLD transfer to yourself built with sdk-core 15, signed through DappProvider.signTransactions (sdk-dapp
 *    sets the nonce) and sent to the devnet gateway's /transaction/send.
 * The page fails at connect if Clip's entry isn't in the custom-provider list: dapps that replace `window.multiversx`
 * (MultiversX's template dapp does) never see it.
 */
import { Address, Message, MessageComputer, Transaction } from "@multiversx/sdk-core";
import type { initApp as InitApp } from "@multiversx/sdk-dapp/out/methods/initApp/initApp";
import type { verifyMessage as VerifyMessage } from "@multiversx/sdk-dapp/out/providers/DappProvider/helpers/signMessage/verifyMessage";
import type { ProviderFactory as PF } from "@multiversx/sdk-dapp/out/providers/ProviderFactory";
// sdk-dapp 5 has no package "exports"/"main": bundlers need the .mjs files, TypeScript finds the types next to them
// without the extension (imported as types above).
// @ts-expect-error untyped .mjs path
import { initApp as initAppImpl } from "@multiversx/sdk-dapp/out/methods/initApp/initApp.mjs";
// @ts-expect-error untyped .mjs path
import { verifyMessage as verifyMessageImpl } from "@multiversx/sdk-dapp/out/providers/DappProvider/helpers/signMessage/verifyMessage.mjs";
// @ts-expect-error untyped .mjs path
import { ProviderFactory as ProviderFactoryImpl } from "@multiversx/sdk-dapp/out/providers/ProviderFactory.mjs";
import { MESSAGE, NeedsFunds, expose } from "../dapp-kit";

const initApp = initAppImpl as typeof InitApp;
const verifyMessage = verifyMessageImpl as typeof VerifyMessage;
const ProviderFactory = ProviderFactoryImpl as typeof PF;

const GATEWAY = "https://devnet-gateway.multiversx.com";
const TYPE = "clipwallet";

type DappProvider = Awaited<ReturnType<typeof ProviderFactory.create>>;
let provider: DappProvider;
let address = "";

expose({
  info: {
    dapp: "@multiversx/sdk-dapp 5.7.3 initApp + ProviderFactory (custom provider from window.multiversx.providers), native auth, devnet",
    why: "sdk-dapp is how MultiversX dapps connect wallets; it has no wallet discovery, so Clip lists itself through the undocumented window.multiversx.providers hook",
  },
  steps: {
    connect: async () => {
      await initApp({ dAppConfig: { environment: "devnet", nativeAuth: true } } as Parameters<typeof initApp>[0]);
      const entry = (ProviderFactory.customProviders as { type: string; name: string }[]).find((p) => p.type === TYPE);
      if (!entry) throw new Error("Clip Wallet isn't in sdk-dapp's custom providers (window.multiversx.providers)");
      provider = await ProviderFactory.create({ type: TYPE });
      const login = await provider.login();
      if (!login?.address || !login.signature) throw new Error("login returned no native-auth signature");
      address = login.address;
      return { address, name: entry.name, nativeAuthSignature: login.signature.slice(0, 16) };
    },
    sign: async () => {
      const signed = await provider.signMessage(new Message({ address: Address.newFromBech32(address), data: new TextEncoder().encode(MESSAGE) }));
      if (!signed) throw new Error("no signed message");
      const r = await verifyMessage(JSON.stringify(new MessageComputer().packMessage(signed)));
      return { valid: r.isVerified && r.address === address && r.message === MESSAGE, how: "sdk-dapp verifyMessage (MessageComputer + UserVerifier)" };
    },
    send: async () => {
      const acct = (await (await fetch(`${GATEWAY}/address/${address}`)).json()) as { data?: { account?: { balance?: string } } };
      if (BigInt(acct.data?.account?.balance ?? "0") < 100_000_000_000_000n) throw new NeedsFunds("the account has no devnet EGLD for the fee (devnet wallet faucet)");
      const me = Address.newFromBech32(address);
      const tx = new Transaction({ sender: me, receiver: me, value: 1n, gasLimit: 50_000n, gasPrice: 1_000_000_000n, chainID: "D", version: 2 });
      const [signed] = await provider.signTransactions([tx]);
      if (!signed) throw new Error("no signed transaction");
      const r = (await (
        await fetch(`${GATEWAY}/transaction/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed.toPlainObject()) })
      ).json()) as { data?: { txHash?: string }; error?: string };
      if (!r.data?.txHash) throw new Error(`devnet refused: ${r.error ?? "no hash"}`);
      return { id: r.data.txHash };
    },
  },
});
