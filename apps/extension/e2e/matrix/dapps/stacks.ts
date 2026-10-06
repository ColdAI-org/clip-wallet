/**
 * Stacks (testnet): @stacks/connect v8 `request()` (SIP-030) against the wallet it finds through WBIP-004
 * (`window.wbip_providers`, the registry Connect's own wallet picker reads): getAddresses, stx_signMessage verified with
 * @stacks/encryption verifyMessageSignatureRsv (and the address re-derived from the returned key), and a 1 µSTX
 * stx_transferStx that the wallet builds, signs and broadcasts. Stacks nodes refuse a transfer to the sender itself
 * (mempool rejection TransferRecipientIsSender), so the µSTX goes to the testnet boot address ST000…2AMW42H.
 * Unfunded: the wallet still decodes and signs (broadcast: false), then NeedsFunds.
 */
import { request } from "@stacks/connect";
import { verifyMessageSignatureRsv } from "@stacks/encryption";
import { getAddressFromPublicKey } from "@stacks/transactions";
import { MESSAGE, NeedsFunds, expose, waitFor } from "../dapp-kit";

const HIRO = "https://api.testnet.hiro.so";
/** Testnet boot address (the boot contracts' deployer): nobody's account, any µSTX sent there just stays. */
const SINK = "ST000000000000000000002AMW42H";
type Provider = Parameters<typeof request>[0] extends infer O ? (O extends { provider?: infer P } ? P : never) : never;
let provider: Provider;
let address = "";
let publicKey = "";

/** @stacks/connect-ui `getProviderFromId`: the WBIP-004 id is the provider's path on window. */
const fromId = (id: string) => id.split(".").reduce<any>((o, k) => o?.[k], window);

expose({
  info: {
    dapp: "@stacks/connect 8 request() (SIP-030) + WBIP-004 discovery + @stacks/encryption in a local page, testnet",
    why: "Connect's request() is what Stacks dapps call (the picker modal lists wbip_providers; the page picks Clip's entry instead of clicking the modal)",
  },
  steps: {
    connect: async () => {
      const entry = await waitFor(
        () => ((window as unknown as { wbip_providers?: { id: string; name: string }[] }).wbip_providers ?? []).find((p) => p.name === "Clip Wallet"),
        "Clip Wallet in window.wbip_providers",
      );
      provider = fromId(entry.id);
      if (!provider) throw new Error(`${entry.id} not on window`);
      const r = await request({ provider, enableLocalStorage: false }, "getAddresses", { network: "testnet" });
      const stx = r.addresses.find((a) => a.address.startsWith("ST"));
      if (!stx) throw new Error(`no testnet STX address in ${JSON.stringify(r.addresses)}`);
      address = stx.address;
      publicKey = stx.publicKey;
      return { address, publicKey, providerId: entry.id };
    },
    sign: async () => {
      const r = await request({ provider, enableLocalStorage: false }, "stx_signMessage", { message: MESSAGE });
      const valid = verifyMessageSignatureRsv({ message: MESSAGE, signature: r.signature, publicKey: r.publicKey }) && getAddressFromPublicKey(r.publicKey, "testnet") === address;
      return { valid, how: "@stacks/encryption verifyMessageSignatureRsv (\\x17Stacks Signed Message prefix) + getAddressFromPublicKey === connected address" };
    },
    send: async () => {
      const bal = await fetch(`${HIRO}/extended/v1/address/${address}/stx`).then((x) => (x.ok ? (x.json() as Promise<{ balance?: string }>) : { balance: "0" }));
      const funded = BigInt(bal.balance ?? "0") > 10_000n;
      const r = await request({ provider, enableLocalStorage: false }, "stx_transferStx", { recipient: SINK, amount: "1", memo: "clip matrix", network: "testnet", ...(funded ? {} : { broadcast: false }) } as never);
      if (!funded) throw new NeedsFunds("signed, but the account has no testnet STX");
      if (!r.txid) throw new Error(`no txid in ${JSON.stringify(r)}`);
      return { id: r.txid, publicKey };
    },
  },
});
