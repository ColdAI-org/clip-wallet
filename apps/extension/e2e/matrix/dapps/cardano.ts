/**
 * Cardano (preprod): CIP-30 discovery (a window.cardano entry with name/apiVersion/enable, as every CIP-30 dapp and
 * connector library looks it up), signData (CIP-8 COSE_Sign1; verified in the test with the Cardano Foundation's
 * @cardano-foundation/cardano-verify-datasignature, which needs Node streams), and a 1 ADA self-transfer built from
 * the wallet's own getUtxos with cborg, signed with signTx and sent with submitTx.
 */
import { decode, encode } from "cborg";
import { bech32 } from "@scure/base";
import { MESSAGE, NeedsFunds, expose, fromHex, hex, waitFor } from "../dapp-kit";

type Cip30 = Record<string, (...a: any[]) => Promise<any>>;
let api: Cip30;
let address = "";
let addrHex = "";

const clip = () => {
  const c = (window as unknown as { cardano?: Record<string, { name?: string; apiVersion?: string; enable?: unknown }> }).cardano ?? {};
  return Object.values(c).find((w) => w?.name === "Clip Wallet" && typeof w.enable === "function" && typeof w.apiVersion === "string") as { enable(): Promise<Cip30> } | undefined;
};
const toBech32 = (h: string) => {
  const bytes = fromHex(h);
  const prefix = (bytes[0]! & 0x0f) === 1 ? "addr" : "addr_test";
  return bech32.encode(prefix, bech32.toWords(bytes), 1000);
};
/** Koios sends no CORS headers: the page reaches it through its backend (matrix.spec.ts serves this proxy). */
const KOIOS = `${location.origin}/proxy/koios-preprod`;
const coinOf = (v: unknown): bigint => (Array.isArray(v) ? BigInt(v[0] as number) : BigInt(v as number));

expose({
  info: {
    dapp: "CIP-30 window.cardano + cborg tx building in a local page, preprod; signData verified with @cardano-foundation/cardano-verify-datasignature",
    why: "CIP-30 has no single example dapp; these are the standard dapp-side calls (Mesh/Lucid wrap the same API) and the Cardano Foundation's verifier",
  },
  steps: {
    connect: async () => {
      api = await (await waitFor(clip, "Clip Wallet (CIP-30)")).enable();
      const used: string[] = await api.getUsedAddresses!();
      const unused: string[] = await api.getUnusedAddresses!();
      addrHex = used[0] ?? unused[0] ?? (await api.getChangeAddress!());
      address = toBech32(addrHex);
      return { address, networkId: await api.getNetworkId!() };
    },
    sign: async () => {
      const r = (await api.signData!(addrHex, hex(new TextEncoder().encode(MESSAGE)))) as { signature: string; key: string };
      return { valid: false, how: "cip8", verify: { kind: "cip8", signature: r.signature, key: r.key, message: MESSAGE, address } };
    },
    send: async () => {
      const utxos = ((await api.getUtxos!()) ?? []) as string[];
      if (!utxos.length) throw new NeedsFunds("No UTXOs: a Cardano transaction can't be built until the address holds ADA.");
      const inputs: [Uint8Array, number][] = [];
      let total = 0n;
      for (const u of utxos) {
        const [inp, out] = decode(fromHex(u), { useMaps: true }) as [[Uint8Array, number], unknown];
        inputs.push(inp);
        const value = out instanceof Map ? out.get(1) : (out as unknown[])[1];
        total += coinOf(value);
      }
      const params = await (await fetch(`${KOIOS}/cli_protocol_params`)).json();
      const tip = (await (await fetch(`${KOIOS}/tip`)).json())[0];
      const me = fromHex(addrHex);
      const body = (fee: bigint) => {
        const change = total - 1_000_000n - fee;
        const outputs: [Uint8Array, bigint][] = change >= 1_000_000n ? [[me, 1_000_000n], [me, change]] : [[me, total - fee]];
        return encode(new Map<number, unknown>([[0, inputs], [1, outputs], [2, fee], [3, tip.abs_slot + 3600]]));
      };
      const tx = (b: Uint8Array, w: Uint8Array) => new Uint8Array([0x84, ...b, ...w, 0xf5, 0xf6]);
      let fee = 200_000n;
      for (let i = 0; i < 2; i++) fee = BigInt(params.txFeePerByte) * BigInt(tx(body(fee), new Uint8Array(110)).length) + BigInt(params.txFeeFixed) + 1_000n;
      const b = body(fee);
      const witnessHex: string = await api.signTx!(hex(tx(b, new Uint8Array([0xa0]))), false);
      const id: string = await api.submitTx!(hex(tx(b, fromHex(witnessHex))));
      return { id };
    },
  },
});
